import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from server.config import get_workspace_host, get_auth_headers
from server.db import db

router = APIRouter(tags=["catalog"])


async def _uc_get(request: Request, path: str, params: dict) -> dict:
    """Call the Unity Catalog REST API directly under the user's OBO token.

    We use REST instead of the SDK for catalog/schema/table listing because the pinned
    databricks-sdk (0.67.0) can fail to parse responses when include_browse surfaces
    browse-only objects with sparse fields — that manifested as 500s on /schemas. REST
    just returns the JSON. Mirrors the httpx pattern in server/routes/genie.py.
    """
    host = get_workspace_host().rstrip("/")
    headers = get_auth_headers(request)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{host}{path}", headers=headers, params=params)
        resp.raise_for_status()
        return resp.json()


@router.get("/catalog-search")
async def search_catalog(request: Request, q: str = Query(..., min_length=1)):
    """Search by three-level namespace or plain table name."""
    try:
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
            try:
                data = await _uc_get(request, "/api/2.1/unity-catalog/catalogs",
                                     {"include_browse": "true", "max_results": 500})
                for c in data.get("catalogs", []):
                    if c.get("name") and prefix in c["name"].lower():
                        results.append({"type": "catalog", "name": c["name"], "full_name": c["name"]})
                    if len(results) >= 50:
                        break
            except Exception:
                pass

        elif len(parts) == 2:
            # catalog.schema — list matching schemas
            catalog, schema_prefix = parts[0], parts[1].lower()
            try:
                data = await _uc_get(request, "/api/2.1/unity-catalog/schemas",
                                     {"catalog_name": catalog, "include_browse": "true"})
                for s in data.get("schemas", []):
                    if s.get("name") and schema_prefix in s["name"].lower():
                        results.append({
                            "type": "schema",
                            "name": s["name"],
                            "full_name": s.get("full_name", ""),
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
                data = await _uc_get(request, "/api/2.1/unity-catalog/tables",
                                     {"catalog_name": catalog, "schema_name": schema, "include_browse": "true"})
                for t in data.get("tables", []):
                    if t.get("name") and table_prefix in t["name"].lower():
                        results.append({
                            "type": "table",
                            "name": t["name"],
                            "full_name": t.get("full_name", ""),
                            "catalog": catalog,
                            "schema": schema,
                            "table_type": t.get("table_type", ""),
                            "comment": t.get("comment", ""),
                            "columns": [
                                {
                                    "name": col.get("name", ""),
                                    "type": col.get("type_text", ""),
                                    "comment": col.get("comment", ""),
                                }
                                for col in (t.get("columns") or [])
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
async def list_catalogs(request: Request):
    try:
        data = await _uc_get(
            request, "/api/2.1/unity-catalog/catalogs",
            {"include_browse": "true", "max_results": 500},
        )
        catalogs = [
            {"name": c.get("name", ""), "comment": c.get("comment", ""), "owner": c.get("owner", "")}
            for c in data.get("catalogs", []) if c.get("name")
        ]
        catalogs.sort(key=lambda x: x["name"].lower())
        return {"catalogs": catalogs}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/catalogs/{catalog_name}/schemas")
async def list_schemas(catalog_name: str, request: Request):
    try:
        # include_browse surfaces schemas the user has only browse/metadata access to
        # (not just ones they can fully query) — matches Catalog Explorer.
        data = await _uc_get(
            request, "/api/2.1/unity-catalog/schemas",
            {"catalog_name": catalog_name, "include_browse": "true"},
        )
        schemas = [
            {"name": s.get("name", ""), "full_name": s.get("full_name", ""), "comment": s.get("comment", "")}
            for s in data.get("schemas", []) if s.get("name")
        ]
        return {"schemas": schemas}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/catalogs/{catalog_name}/schemas/{schema_name}/tables")
async def list_tables(catalog_name: str, schema_name: str, request: Request):
    try:
        # include_browse is essential under OBO: without it, tables the user has only
        # browse/metadata access to (no SELECT grant yet) are silently omitted, so a
        # schema appears to have no tables. Matches Catalog Explorer.
        data = await _uc_get(
            request, "/api/2.1/unity-catalog/tables",
            {"catalog_name": catalog_name, "schema_name": schema_name, "include_browse": "true"},
        )
        tables = []
        for t in data.get("tables", []):
            if not t.get("name"):
                continue
            tables.append({
                "name": t.get("name", ""),
                "full_name": t.get("full_name", ""),
                "table_type": t.get("table_type", ""),
                "comment": t.get("comment", ""),
                "columns": [
                    {
                        "name": col.get("name", ""),
                        "type": col.get("type_text", ""),
                        "comment": col.get("comment", ""),
                    }
                    for col in (t.get("columns") or [])
                ],
            })
        return {"tables": tables}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
