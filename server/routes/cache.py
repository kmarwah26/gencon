import json
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from server.config import get_workspace_client, get_workspace_host, get_auth_headers
from server.db import db
import httpx

router = APIRouter(tags=["cache"])

GENIE_PREFIX = "/api/2.0/genie/spaces"


# ── Schema bootstrap ──


CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS genie_rooms (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    creator_id TEXT NOT NULL DEFAULT '',
    creator_name TEXT NOT NULL DEFAULT '',
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalog_tables (
    full_name TEXT PRIMARY KEY,
    catalog_name TEXT NOT NULL DEFAULT '',
    schema_name TEXT NOT NULL DEFAULT '',
    table_name TEXT NOT NULL DEFAULT '',
    table_type TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    columns_json TEXT NOT NULL DEFAULT '[]',
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_catalog ON catalog_tables (catalog_name);
CREATE INDEX IF NOT EXISTS idx_ct_schema ON catalog_tables (catalog_name, schema_name);
CREATE INDEX IF NOT EXISTS idx_ct_search ON catalog_tables USING gin (
    to_tsvector('simple', table_name || ' ' || catalog_name || ' ' || schema_name || ' ' || comment)
);
"""


@router.post("/cache/init")
async def init_cache():
    """Create cache tables if they don't exist."""
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with pool.acquire() as conn:
        await conn.execute(CREATE_TABLES_SQL)
    return {"status": "ok", "message": "Cache tables created"}


# ── Sync Genie Rooms ──


@router.post("/cache/sync-rooms")
async def sync_rooms():
    """Fetch all Genie rooms from the API and upsert into cache."""
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")

    host = get_workspace_host()
    headers = get_auth_headers()
    now = datetime.now(timezone.utc)

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{host}{GENIE_PREFIX}", headers=headers)
            resp.raise_for_status()
            data = resp.json()

        spaces = data.get("spaces", data.get("genie_spaces", []))
        count = 0
        async with pool.acquire() as conn:
            for s in spaces:
                rid = s.get("space_id", s.get("id", ""))
                if not rid:
                    continue
                await conn.execute(
                    """
                    INSERT INTO genie_rooms (id, title, description, creator_id, creator_name, synced_at)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (id) DO UPDATE SET
                        title = EXCLUDED.title,
                        description = EXCLUDED.description,
                        creator_id = EXCLUDED.creator_id,
                        creator_name = EXCLUDED.creator_name,
                        synced_at = EXCLUDED.synced_at
                    """,
                    rid,
                    s.get("title", s.get("name", "Untitled")),
                    s.get("description", ""),
                    s.get("creator_id", ""),
                    s.get("creator_name", ""),
                    now,
                )
                count += 1

        return {"status": "ok", "rooms_synced": count}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Sync Catalog Tables ──


@router.post("/cache/sync-tables")
async def sync_tables():
    """Walk all catalogs → schemas → tables and upsert into cache."""
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")

    w = get_workspace_client()
    now = datetime.now(timezone.utc)
    total = 0

    try:
        catalogs = list(w.catalogs.list())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list catalogs: {e}")

    for cat in catalogs:
        try:
            schemas = list(w.schemas.list(catalog_name=cat.name))
        except Exception:
            continue

        for sch in schemas:
            try:
                tables = list(w.tables.list(catalog_name=cat.name, schema_name=sch.name))
            except Exception:
                continue

            rows = []
            for t in tables:
                cols = [
                    {
                        "name": c.name,
                        "type": str(c.type_text) if c.type_text else "",
                        "comment": c.comment or "",
                    }
                    for c in (t.columns or [])
                ]
                rows.append((
                    t.full_name or f"{cat.name}.{sch.name}.{t.name}",
                    cat.name,
                    sch.name,
                    t.name,
                    str(t.table_type) if t.table_type else "",
                    t.comment or "",
                    json.dumps(cols),
                    now,
                ))

            if rows:
                async with pool.acquire() as conn:
                    await conn.executemany(
                        """
                        INSERT INTO catalog_tables
                            (full_name, catalog_name, schema_name, table_name, table_type, comment, columns_json, synced_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        ON CONFLICT (full_name) DO UPDATE SET
                            catalog_name = EXCLUDED.catalog_name,
                            schema_name = EXCLUDED.schema_name,
                            table_name = EXCLUDED.table_name,
                            table_type = EXCLUDED.table_type,
                            comment = EXCLUDED.comment,
                            columns_json = EXCLUDED.columns_json,
                            synced_at = EXCLUDED.synced_at
                        """,
                        rows,
                    )
                total += len(rows)

    return {"status": "ok", "tables_synced": total}


# ── Cached reads ──


@router.get("/cache/rooms")
async def cached_rooms():
    """Read rooms from cache (fast)."""
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, title, description, creator_id, creator_name FROM genie_rooms ORDER BY title"
        )

    return {
        "rooms": [
            {
                "id": r["id"],
                "title": r["title"],
                "description": r["description"],
                "creator_id": r["creator_id"],
                "creator_name": r["creator_name"],
            }
            for r in rows
        ]
    }


@router.get("/cache/tables")
async def cached_tables(
    catalog: str | None = None,
    schema: str | None = None,
    q: str | None = None,
    limit: int = 200,
):
    """Read tables from cache with optional filtering."""
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")

    conditions = []
    params = []
    idx = 1

    if catalog:
        conditions.append(f"catalog_name = ${idx}")
        params.append(catalog)
        idx += 1
    if schema:
        conditions.append(f"schema_name = ${idx}")
        params.append(schema)
        idx += 1
    if q:
        # Full-text search or ILIKE fallback
        conditions.append(
            f"(table_name ILIKE ${idx} OR full_name ILIKE ${idx} OR comment ILIKE ${idx})"
        )
        params.append(f"%{q}%")
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.append(limit)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT full_name, catalog_name, schema_name, table_name,
                   table_type, comment, columns_json
            FROM catalog_tables
            {where}
            ORDER BY full_name
            LIMIT ${idx}
            """,
            *params,
        )

    return {
        "tables": [
            {
                "full_name": r["full_name"],
                "name": r["table_name"],
                "catalog": r["catalog_name"],
                "schema": r["schema_name"],
                "table_type": r["table_type"],
                "comment": r["comment"],
                "columns": json.loads(r["columns_json"]),
            }
            for r in rows
        ]
    }


@router.get("/cache/catalogs")
async def cached_catalogs():
    """Get distinct catalog names from cache."""
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT catalog_name FROM catalog_tables ORDER BY catalog_name"
        )

    return {"catalogs": [r["catalog_name"] for r in rows]}


@router.get("/cache/schemas")
async def cached_schemas(catalog: str):
    """Get distinct schemas in a catalog from cache."""
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT schema_name FROM catalog_tables WHERE catalog_name = $1 ORDER BY schema_name",
            catalog,
        )

    return {"schemas": [r["schema_name"] for r in rows]}


@router.get("/cache/status")
async def cache_status():
    """Get cache stats."""
    pool = await db.get_pool()
    if not pool:
        return {"available": False}

    async with pool.acquire() as conn:
        room_count = await conn.fetchval("SELECT COUNT(*) FROM genie_rooms")
        table_count = await conn.fetchval("SELECT COUNT(*) FROM catalog_tables")
        last_room_sync = await conn.fetchval("SELECT MAX(synced_at) FROM genie_rooms")
        last_table_sync = await conn.fetchval("SELECT MAX(synced_at) FROM catalog_tables")

    return {
        "available": True,
        "rooms": room_count,
        "tables": table_count,
        "last_room_sync": str(last_room_sync) if last_room_sync else None,
        "last_table_sync": str(last_table_sync) if last_table_sync else None,
    }
