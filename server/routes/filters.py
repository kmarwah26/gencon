"""
Row-level filter configuration per Genie room.

Two tables in Lakebase:
- room_filter_columns: which columns a room can be filtered on (configured by room owner)
- user_filter_values: per-user allowed values for each filter column in a room

Default access posture: if a room has any filter columns configured, a user with
no mapping is denied. The owner must explicitly grant access.
"""

from datetime import datetime, timezone
import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from server.config import get_workspace_client, get_workspace_host, get_auth_headers, IS_DATABRICKS_APP
from server.db import db

router = APIRouter(tags=["filters"])

COLUMNS_TABLE = "room_filter_columns"
VALUES_TABLE = "user_filter_values"

CREATE_TABLES_SQL = f"""
CREATE TABLE IF NOT EXISTS {COLUMNS_TABLE} (
    room_id TEXT NOT NULL,
    column_name TEXT NOT NULL,
    label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, column_name)
);

CREATE TABLE IF NOT EXISTS {VALUES_TABLE} (
    user_email TEXT NOT NULL,
    room_id TEXT NOT NULL,
    column_name TEXT NOT NULL,
    allowed_values TEXT[] NOT NULL DEFAULT '{{}}',
    principal_type TEXT NOT NULL DEFAULT 'user',
    display_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_email, room_id, column_name)
);

-- Migration for existing installs
ALTER TABLE {VALUES_TABLE} ADD COLUMN IF NOT EXISTS principal_type TEXT NOT NULL DEFAULT 'user';
ALTER TABLE {VALUES_TABLE} ADD COLUMN IF NOT EXISTS display_name TEXT;

CREATE INDEX IF NOT EXISTS idx_ufv_room ON {VALUES_TABLE} (room_id, user_email);
"""

_table_ready = False


async def _ensure_tables():
    global _table_ready
    if _table_ready:
        return
    pool = await db.get_pool()
    if not pool:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(CREATE_TABLES_SQL)
        _table_ready = True
    except Exception as e:
        print(f"[filters] Failed to create tables: {e}")


def _current_user_email(request: Request) -> str:
    """Extract the logged-in user's email from request (Databricks Apps header or SDK)."""
    if IS_DATABRICKS_APP:
        return request.headers.get("X-Forwarded-Email", "") or request.headers.get("X-Forwarded-Preferred-Username", "")
    try:
        return get_workspace_client().current_user.me().user_name or ""
    except Exception:
        return ""


def _user_groups(request, user_email: str) -> list[str]:
    """Return display names of groups the current user belongs to.

    Uses the user's OBO client when available so the result reflects the
    logged-in user's group membership (not the service principal's). Falls back
    to []. Group names are matched case-insensitively in compute_scope.
    """
    try:
        w = get_workspace_client(request)
        me = w.current_user.me()
        return [g.display for g in (me.groups or []) if g.display]
    except Exception as e:
        print(f"[filters] _user_groups error: {e}")
        return []


async def compute_scope(request, room_id: str, user_email: str) -> dict:
    """Return the effective filter scope for a user in a room.

    Merges direct user mappings with group mappings (any group the user belongs to).
    The union of allowed values across all matching rows is returned per column.
    """
    await _ensure_tables()
    pool = await db.get_pool()
    if not pool:
        return {"has_columns": False, "blocked": False, "values": {}, "columns": []}
    try:
        async with pool.acquire() as conn:
            cols = await conn.fetch(
                f"SELECT column_name, label FROM {COLUMNS_TABLE} WHERE room_id = $1 ORDER BY column_name",
                room_id,
            )
            columns = [{"column_name": r["column_name"], "label": r["label"] or r["column_name"]} for r in cols]
            if not columns:
                return {"has_columns": False, "blocked": False, "values": {}, "columns": []}
            if not user_email:
                return {"has_columns": True, "blocked": True, "values": {}, "columns": columns}

            user_groups = _user_groups(request, user_email)
            # Match user row + any group rows the user belongs to (case-insensitive on name)
            rows = await conn.fetch(
                f"SELECT column_name, allowed_values, principal_type, user_email AS principal "
                f"FROM {VALUES_TABLE} WHERE room_id = $1 AND ("
                f"  (principal_type = 'user' AND user_email = $2) OR "
                f"  (principal_type = 'group' AND LOWER(user_email) = ANY($3::text[]))"
                f")",
                room_id, user_email, [g.lower() for g in user_groups],
            )
            merged: dict[str, set[str]] = {}
            for r in rows:
                col = r["column_name"]
                vals = list(r["allowed_values"] or [])
                merged.setdefault(col, set()).update(vals)
            values = {col: sorted(vs) for col, vs in merged.items()}
            blocked = not values or all(not v for v in values.values())
            return {"has_columns": True, "blocked": blocked, "values": values, "columns": columns}
    except Exception as e:
        print(f"[filters] compute_scope error: {e}")
        return {"has_columns": False, "blocked": False, "values": {}, "columns": []}


def format_constraint_prefix(values: dict) -> str:
    """Format the scope dict as an English constraint that Genie can follow."""
    if not values:
        return ""
    parts = []
    for col, vals in values.items():
        if not vals:
            continue
        quoted = ", ".join(f"'{v}'" for v in vals)
        parts.append(f"{col} IN ({quoted})")
    if not parts:
        return ""
    return (
        "[Row-level filter — REQUIRED] "
        "Restrict every answer and SQL query strictly to rows where: "
        + " AND ".join(parts)
        + ". Do not return data outside this scope.\n\nQuestion: "
    )


# ── Filter columns CRUD ──


class AddColumnRequest(BaseModel):
    column_name: str
    label: str | None = None


@router.get("/filters/{room_id}/columns")
async def list_filter_columns(room_id: str):
    await _ensure_tables()
    pool = await db.get_pool()
    if not pool:
        return {"columns": [], "db_available": False}
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                f"SELECT column_name, label, created_at FROM {COLUMNS_TABLE} WHERE room_id = $1 ORDER BY column_name",
                room_id,
            )
            return {
                "columns": [
                    {
                        "column_name": r["column_name"],
                        "label": r["label"] or r["column_name"],
                        "created_at": r["created_at"].isoformat(),
                    }
                    for r in rows
                ],
                "db_available": True,
            }
    except Exception as e:
        print(f"[filters] list columns error: {e}")
        return {"columns": [], "db_available": False}


@router.post("/filters/{room_id}/columns")
async def add_filter_column(room_id: str, req: AddColumnRequest):
    await _ensure_tables()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    col = req.column_name.strip()
    if not col:
        raise HTTPException(status_code=400, detail="column_name is required")
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                f"INSERT INTO {COLUMNS_TABLE} (room_id, column_name, label) VALUES ($1, $2, $3) "
                f"ON CONFLICT (room_id, column_name) DO UPDATE SET label = EXCLUDED.label",
                room_id, col, (req.label or "").strip() or None,
            )
        return {"added": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/filters/{room_id}/columns/{column_name}")
async def remove_filter_column(room_id: str, column_name: str):
    await _ensure_tables()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                f"DELETE FROM {COLUMNS_TABLE} WHERE room_id = $1 AND column_name = $2",
                room_id, column_name,
            )
            # Cascade: drop matching value rows too
            await conn.execute(
                f"DELETE FROM {VALUES_TABLE} WHERE room_id = $1 AND column_name = $2",
                room_id, column_name,
            )
        return {"deleted": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── User mappings ──


class UpsertUserFilterRequest(BaseModel):
    column_name: str
    allowed_values: list[str]
    principal_type: str = "user"   # "user" or "group"
    display_name: str | None = None


@router.get("/filters/{room_id}/users")
async def list_user_filters(room_id: str):
    """List all principal → (column → values) mappings for the room (owner view)."""
    await _ensure_tables()
    pool = await db.get_pool()
    if not pool:
        return {"users": [], "db_available": False}
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                f"SELECT user_email, column_name, allowed_values, principal_type, display_name, updated_at "
                f"FROM {VALUES_TABLE} WHERE room_id = $1 ORDER BY principal_type DESC, user_email, column_name",
                room_id,
            )
            users: dict[str, dict] = {}
            for r in rows:
                u = r["user_email"]
                if u not in users:
                    users[u] = {
                        "user_email": u,
                        "principal_type": r["principal_type"] or "user",
                        "display_name": r["display_name"] or u,
                        "filters": {},
                        "updated_at": r["updated_at"].isoformat(),
                    }
                users[u]["filters"][r["column_name"]] = list(r["allowed_values"] or [])
                if r["updated_at"].isoformat() > users[u]["updated_at"]:
                    users[u]["updated_at"] = r["updated_at"].isoformat()
            return {"users": list(users.values()), "db_available": True}
    except Exception as e:
        print(f"[filters] list users error: {e}")
        return {"users": [], "db_available": False}


@router.put("/filters/{room_id}/users/{user_email}")
async def upsert_user_filter(room_id: str, user_email: str, req: UpsertUserFilterRequest):
    await _ensure_tables()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    col = req.column_name.strip()
    if not col:
        raise HTTPException(status_code=400, detail="column_name is required")
    if req.principal_type not in ("user", "group"):
        raise HTTPException(status_code=400, detail="principal_type must be 'user' or 'group'")
    cleaned = [v.strip() for v in (req.allowed_values or []) if v and v.strip()]
    # Users are stored lowercase (email); groups keep their original casing for display
    pid = user_email.lower() if req.principal_type == "user" else user_email
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                f"INSERT INTO {VALUES_TABLE} (user_email, room_id, column_name, allowed_values, principal_type, display_name, updated_at) "
                f"VALUES ($1, $2, $3, $4, $5, $6, $7) "
                f"ON CONFLICT (user_email, room_id, column_name) DO UPDATE "
                f"SET allowed_values = EXCLUDED.allowed_values, principal_type = EXCLUDED.principal_type, "
                f"    display_name = COALESCE(EXCLUDED.display_name, {VALUES_TABLE}.display_name), "
                f"    updated_at = EXCLUDED.updated_at",
                pid, room_id, col, cleaned, req.principal_type, req.display_name, datetime.now(timezone.utc),
            )
        return {"saved": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/filters/{room_id}/users/{user_email}")
async def delete_user_filter(room_id: str, user_email: str):
    await _ensure_tables()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                f"DELETE FROM {VALUES_TABLE} WHERE room_id = $1 AND user_email = $2",
                room_id, user_email.lower(),
            )
        return {"deleted": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Current-user scope (for chat UI) ──


@router.get("/filters/{room_id}/scope")
async def get_filter_scope(room_id: str, request: Request):
    user_email = _current_user_email(request).lower()
    scope = await compute_scope(request, room_id, user_email)
    return {"user_email": user_email, **scope}


# ── Available columns from the room's selected tables ──


def _columns_from_tables(request, tables: list[str]) -> list[dict]:
    """Look up the union of columns across the given Unity Catalog tables (as the user)."""
    if not tables:
        return []
    w = get_workspace_client(request)
    column_to_meta: dict[str, dict] = {}
    for full_name in tables:
        try:
            t = w.tables.get(full_name)
            for c in (t.columns or []):
                if not c.name:
                    continue
                meta = column_to_meta.setdefault(c.name, {
                    "name": c.name,
                    "type": str(c.type_text) if c.type_text else "",
                    "tables": [],
                })
                meta["tables"].append(full_name)
        except Exception as e:
            print(f"[filters] available-columns failed for {full_name}: {e}")
    return sorted(column_to_meta.values(), key=lambda x: x["name"].lower())


@router.get("/filters/{room_id}/available-columns")
async def list_available_columns(room_id: str, request: Request):
    """Return the unique column names across the room's selected tables."""
    host, headers = get_workspace_host(), get_auth_headers(request)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{host}/api/2.0/genie/spaces/{room_id}",
                headers=headers,
                params={"include_serialized_space": "true"},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    import json as _json
    tables: list[str] = []
    try:
        space = _json.loads(data.get("serialized_space", "") or "{}")
        for t in space.get("data_sources", {}).get("tables", []) or []:
            ident = t.get("identifier")
            if ident:
                tables.append(ident)
    except Exception:
        pass

    return {"columns": _columns_from_tables(request, tables), "tables": tables}


class ColumnsFromTablesRequest(BaseModel):
    table_identifiers: list[str]


@router.post("/filters/columns-from-tables")
async def columns_from_tables(req: ColumnsFromTablesRequest, request: Request):
    """Same as available-columns, but for tables not yet associated with a room (CreateRoom flow)."""
    return {"columns": _columns_from_tables(request, req.table_identifiers), "tables": req.table_identifiers}


# ── Workspace users + groups search ──


@router.get("/principals")
async def search_principals(request: Request, q: str = "", limit: int = 20):
    """Search workspace users + groups by name/email. Returns combined list with type tag."""
    q = (q or "").strip()
    results: list[dict] = []
    w = get_workspace_client(request)

    # SCIM filter — match on userName, emails, or displayName (StartsWith for fast prefix)
    user_filter = None
    group_filter = None
    if q:
        # Lowercase + escape quotes; SCIM uses double-quote string literals
        safe = q.replace('"', '\\"')
        user_filter = f'userName co "{safe}" or displayName co "{safe}" or emails.value co "{safe}"'
        group_filter = f'displayName co "{safe}"'

    try:
        for u in w.users.list(filter=user_filter, count=max(min(limit, 50), 5)):
            if not u.active:
                continue
            email = ""
            if u.emails:
                primary = next((e.value for e in u.emails if e.primary), None)
                email = primary or (u.emails[0].value if u.emails else "")
            results.append({
                "type": "user",
                "id": email or u.user_name or "",
                "display_name": u.display_name or u.user_name or email,
                "user_name": u.user_name or "",
                "email": email,
            })
            if len(results) >= limit:
                break
    except Exception as e:
        print(f"[filters] users search error: {e}")

    if len(results) < limit:
        try:
            for g in w.groups.list(filter=group_filter, count=max(min(limit - len(results), 50), 5)):
                results.append({
                    "type": "group",
                    "id": g.display_name or "",
                    "display_name": g.display_name or "",
                    "member_count": len(g.members or []),
                })
                if len(results) >= limit:
                    break
        except Exception as e:
            print(f"[filters] groups search error: {e}")

    # Sort: users first, then groups, both alphabetically
    results.sort(key=lambda r: (0 if r["type"] == "user" else 1, r["display_name"].lower()))
    return {"principals": results[:limit]}
