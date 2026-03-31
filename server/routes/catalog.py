from fastapi import APIRouter, HTTPException, Query
from server.config import get_workspace_client
from server.db import db

router = APIRouter(tags=["catalog"])


@router.get("/catalog-search")
async def search_catalog(q: str = Query(..., min_length=1)):
    """Search by three-level namespace or plain table name."""
    try:
        w = get_workspace_client()
        parts = [p.strip() for p in q.split(".")]
        results = []

        if len(parts) == 1:
            prefix = parts[0].lower()

            # Try cached table search first (fast)
            try:
                pool = await db.get_pool()
                if pool and len(prefix) >= 2:
                    rows = await pool.fetch(
                        "SELECT full_name, table_name, catalog_name, schema_name, table_type, comment "
                        "FROM catalog_tables "
                        "WHERE table_name ILIKE $1 OR full_name ILIKE $1 OR comment ILIKE $1 "
                        "ORDER BY table_name LIMIT 50",
                        f"%{prefix}%",
                    )
                    for r in rows:
                        results.append({
                            "type": "table",
                            "name": r["table_name"],
                            "full_name": r["full_name"],
                            "catalog": r["catalog_name"],
                            "schema": r["schema_name"],
                            "table_type": r["table_type"] or "",
                            "comment": r["comment"] or "",
                        })
                    if results:
                        return {"results": results, "query": q}
            except Exception:
                pass

            # Fallback: filter catalogs by name
            for c in w.catalogs.list():
                if prefix in c.name.lower():
                    results.append({
                        "type": "catalog",
                        "name": c.name,
                        "full_name": c.name,
                    })
                if len(results) >= 50:
                    break

        elif len(parts) == 2:
            # catalog.schema — list matching schemas
            catalog, schema_prefix = parts[0], parts[1].lower()
            try:
                for s in w.schemas.list(catalog_name=catalog):
                    if schema_prefix in s.name.lower():
                        results.append({
                            "type": "schema",
                            "name": s.name,
                            "full_name": s.full_name,
                            "catalog": catalog,
                        })
                    if len(results) >= 50:
                        break
            except Exception:
                pass

        elif len(parts) >= 3:
            # catalog.schema.table — list matching tables
            catalog, schema, table_prefix = parts[0], parts[1], ".".join(parts[2:]).lower()
            try:
                for t in w.tables.list(
                    catalog_name=catalog, schema_name=schema
                ):
                    if table_prefix in t.name.lower():
                        results.append({
                            "type": "table",
                            "name": t.name,
                            "full_name": t.full_name,
                            "catalog": catalog,
                            "schema": schema,
                            "table_type": str(t.table_type) if t.table_type else "",
                            "comment": t.comment or "",
                            "columns": [
                                {
                                    "name": col.name,
                                    "type": str(col.type_text) if col.type_text else "",
                                    "comment": col.comment or "",
                                }
                                for col in (t.columns or [])
                            ],
                        })
                    if len(results) >= 50:
                        break
            except Exception:
                pass

        return {"results": results, "query": q}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/catalogs")
async def list_catalogs():
    try:
        w = get_workspace_client()
        catalogs = []
        for c in w.catalogs.list(max_results=500):
            catalogs.append({
                "name": c.name,
                "comment": c.comment or "",
                "owner": c.owner or "",
            })
        # Sort alphabetically for consistent display
        catalogs.sort(key=lambda x: x["name"].lower())
        return {"catalogs": catalogs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/catalogs/{catalog_name}/schemas")
async def list_schemas(catalog_name: str):
    try:
        w = get_workspace_client()
        schemas = []
        for s in w.schemas.list(catalog_name=catalog_name):
            schemas.append({
                "name": s.name,
                "full_name": s.full_name,
                "comment": s.comment or "",
            })
        return {"schemas": schemas}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/catalogs/{catalog_name}/schemas/{schema_name}/tables")
async def list_tables(catalog_name: str, schema_name: str):
    try:
        w = get_workspace_client()
        tables = []
        for t in w.tables.list(
            catalog_name=catalog_name, schema_name=schema_name
        ):
            tables.append({
                "name": t.name,
                "full_name": t.full_name,
                "table_type": str(t.table_type) if t.table_type else "",
                "comment": t.comment or "",
                "columns": [
                    {
                        "name": col.name,
                        "type": str(col.type_text) if col.type_text else "",
                        "comment": col.comment or "",
                    }
                    for col in (t.columns or [])
                ],
            })
        return {"tables": tables}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
