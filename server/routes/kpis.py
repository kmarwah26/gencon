"""
Per-room KPIs.

A KPI is a SQL query that returns a single scalar value. The room owner defines
it once; chat users can execute it on demand. Execution respects the user's
row-level filter scope: the KPI SQL can use the `{filter_clause}` token, which
is replaced with `WHERE col IN (...) AND ...` at execution time. If the room has
filter columns but the KPI SQL has no token, the KPI is rejected — authors must
opt in explicitly.
"""

import asyncio
import uuid
from datetime import datetime, timezone
import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from server.config import get_workspace_host, get_auth_headers
from server.db import db
from server.routes.filters import compute_scope, _current_user_email

router = APIRouter(tags=["kpis"])

TABLE = "room_kpis"

CREATE_TABLE_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    sql TEXT NOT NULL,
    unit TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kpis_room ON {TABLE} (room_id, name);
"""

FILTER_TOKEN = "{filter_clause}"

_table_ready = False


async def _ensure_table():
    global _table_ready
    if _table_ready:
        return
    pool = await db.get_pool()
    if not pool:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(CREATE_TABLE_SQL)
        _table_ready = True
    except Exception as e:
        print(f"[kpis] Failed to create table: {e}")


def _build_filter_clause(scope_values: dict) -> str:
    """Build a 'WHERE col IN (...) AND col2 IN (...)' clause from a scope dict."""
    parts = []
    for col, vals in scope_values.items():
        if not vals:
            continue
        quoted = ", ".join(f"'{v}'" for v in vals)
        parts.append(f"{col} IN ({quoted})")
    return "WHERE " + " AND ".join(parts) if parts else "WHERE 1=1"


class KpiCreateRequest(BaseModel):
    room_id: str
    name: str
    description: str | None = None
    sql: str
    unit: str | None = None


class KpiUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    sql: str | None = None
    unit: str | None = None


@router.get("/kpis/{room_id}")
async def list_kpis(room_id: str):
    await _ensure_table()
    pool = await db.get_pool()
    if not pool:
        return {"kpis": [], "db_available": False}
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                f"SELECT id, name, description, sql, unit, created_at, updated_at "
                f"FROM {TABLE} WHERE room_id = $1 ORDER BY name",
                room_id,
            )
            return {
                "kpis": [
                    {
                        "id": r["id"],
                        "name": r["name"],
                        "description": r["description"] or "",
                        "sql": r["sql"],
                        "unit": r["unit"] or "",
                        "created_at": r["created_at"].isoformat(),
                        "updated_at": r["updated_at"].isoformat(),
                    }
                    for r in rows
                ],
                "db_available": True,
            }
    except Exception as e:
        print(f"[kpis] list error: {e}")
        return {"kpis": [], "db_available": False}


@router.post("/kpis")
async def create_kpi(req: KpiCreateRequest):
    await _ensure_table()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    if not req.name.strip() or not req.sql.strip():
        raise HTTPException(status_code=400, detail="name and sql are required")
    try:
        kid = uuid.uuid4().hex
        async with pool.acquire() as conn:
            await conn.execute(
                f"INSERT INTO {TABLE} (id, room_id, name, description, sql, unit) "
                f"VALUES ($1, $2, $3, $4, $5, $6)",
                kid, req.room_id, req.name.strip(),
                (req.description or "").strip() or None,
                req.sql.strip(),
                (req.unit or "").strip() or None,
            )
        return {"id": kid, "created": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/kpis/{kpi_id}")
async def update_kpi(kpi_id: str, req: KpiUpdateRequest):
    await _ensure_table()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    fields = []
    values: list = []
    if req.name is not None:
        fields.append(f"name = ${len(values) + 1}")
        values.append(req.name.strip())
    if req.description is not None:
        fields.append(f"description = ${len(values) + 1}")
        values.append(req.description.strip() or None)
    if req.sql is not None:
        fields.append(f"sql = ${len(values) + 1}")
        values.append(req.sql.strip())
    if req.unit is not None:
        fields.append(f"unit = ${len(values) + 1}")
        values.append(req.unit.strip() or None)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    fields.append(f"updated_at = ${len(values) + 1}")
    values.append(datetime.now(timezone.utc))
    values.append(kpi_id)
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                f"UPDATE {TABLE} SET {', '.join(fields)} WHERE id = ${len(values)}",
                *values,
            )
        return {"updated": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/kpis/{kpi_id}")
async def delete_kpi(kpi_id: str):
    await _ensure_table()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        async with pool.acquire() as conn:
            await conn.execute(f"DELETE FROM {TABLE} WHERE id = $1", kpi_id)
        return {"deleted": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _get_room_warehouse(request, room_id: str) -> str:
    """Look up the Genie room's warehouse_id (as the user)."""
    host = get_workspace_host()
    headers = get_auth_headers(request)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{host}/api/2.0/genie/spaces/{room_id}", headers=headers)
        resp.raise_for_status()
        return resp.json().get("warehouse_id", "") or ""


async def _execute_sql(request, warehouse_id: str, statement: str, timeout_s: int = 60) -> dict:
    """Run a SQL statement and poll until done (as the user)."""
    host = get_workspace_host()
    headers = get_auth_headers(request)
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.post(
            f"{host}/api/2.0/sql/statements",
            headers=headers,
            json={"warehouse_id": warehouse_id, "statement": statement, "wait_timeout": "30s"},
        )
        resp.raise_for_status()
        data = resp.json()
        stmt_id = data.get("statement_id", "")
        status = data.get("status", {}).get("state", "")
        # Poll if needed
        if status == "PENDING" and stmt_id:
            for _ in range(20):
                await asyncio.sleep(2)
                poll = await client.get(f"{host}/api/2.0/sql/statements/{stmt_id}", headers=headers)
                if poll.status_code == 200:
                    data = poll.json()
                    status = data.get("status", {}).get("state", "")
                    if status in ("SUCCEEDED", "FAILED", "CANCELED", "CLOSED"):
                        break
        return data


@router.post("/kpis/{kpi_id}/execute")
async def execute_kpi(kpi_id: str, request: Request):
    """Run a KPI's SQL, applying the calling user's row-filter scope.

    Returns:
        {value: scalar, unit: str, executed_sql: str, executed_at: iso}
    """
    await _ensure_table()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                f"SELECT id, room_id, name, sql, unit FROM {TABLE} WHERE id = $1",
                kpi_id,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    if not row:
        raise HTTPException(status_code=404, detail="KPI not found")

    room_id = row["room_id"]
    kpi_sql = row["sql"]

    # Apply row-level filter
    user_email = _current_user_email(request).lower()
    scope = await compute_scope(request, room_id, user_email)
    if scope.get("has_columns") and scope.get("blocked"):
        raise HTTPException(status_code=403, detail="No filter scope assigned for this room")

    if scope.get("has_columns") and FILTER_TOKEN not in kpi_sql:
        raise HTTPException(
            status_code=400,
            detail=f"This room has row-level filter columns configured but this KPI's SQL does not include the {FILTER_TOKEN} placeholder. "
                   f"Add {FILTER_TOKEN} where a WHERE clause should be injected (e.g. 'SELECT SUM(x) FROM t {FILTER_TOKEN}').",
        )

    clause = _build_filter_clause(scope.get("values", {})) if scope.get("has_columns") else "WHERE 1=1"
    executed_sql = kpi_sql.replace(FILTER_TOKEN, clause) if FILTER_TOKEN in kpi_sql else kpi_sql

    warehouse_id = await _get_room_warehouse(request, room_id)
    if not warehouse_id:
        raise HTTPException(status_code=400, detail="Room has no warehouse configured")

    try:
        data = await _execute_sql(request, warehouse_id, executed_sql)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    state = data.get("status", {}).get("state", "")
    if state != "SUCCEEDED":
        err = data.get("status", {}).get("error", {}).get("message", state or "execution failed")
        raise HTTPException(status_code=400, detail=err)

    # Extract first row, first column
    result_block = data.get("result", {})
    data_array = result_block.get("data_array", [])
    value = None
    if data_array and data_array[0]:
        value = data_array[0][0]

    return {
        "value": value,
        "unit": row["unit"] or "",
        "executed_sql": executed_sql,
        "executed_at": datetime.now(timezone.utc).isoformat(),
    }
