"""
Lakeview dashboards orchestrated from chat.

One dashboard per Genie room. Chat users click "Save to dashboard" on an
assistant response → if no dashboard exists for the room, a new Lakeview
dashboard is created; otherwise we append a table widget to the existing one.

Stored locally: a mapping (room_id → dashboard_id, owner, parent_path).
Real dashboard lives in Lakeview; we open it via the workspace UI.
"""

import json
import uuid
from datetime import datetime, timezone
import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from server.config import get_workspace_host, get_auth_headers, get_user_auth_headers, get_workspace_client, IS_DATABRICKS_APP
from server.db import db
from server.routes.filters import _current_user_email

router = APIRouter(tags=["dashboards"])

# NB: renamed from `room_dashboards` because that pre-existing table had ownership
# issues — the app's service principal couldn't SELECT/INSERT against it. Using a
# fresh name lets the SP own the table from creation.
TABLE = "genco_dashboards"

CREATE_TABLE_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    dashboard_id TEXT NOT NULL,
    name TEXT,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    parent_path TEXT,
    owner TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dashboards_room ON {TABLE} (room_id);

-- Migrate older schema: drop unique constraint, add new columns
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = '{TABLE}' AND constraint_type = 'UNIQUE'
    ) THEN
        EXECUTE 'ALTER TABLE {TABLE} DROP CONSTRAINT IF EXISTS ' || (
            SELECT constraint_name FROM information_schema.table_constraints
            WHERE table_name = '{TABLE}' AND constraint_type = 'UNIQUE' LIMIT 1
        );
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;
"""

LAKEVIEW_PREFIX = "/api/2.0/lakeview/dashboards"

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
        print(f"[dashboards] Failed to create table: {e}")


# Lakeview dashboards always run as the service principal. The Lakeview API
# requires the `sql.dashboards` OAuth scope, which can't be granted to an
# existing user's OBO token without an account-console consent reset (the
# platform won't re-prompt for a delta scope). The SP's own token isn't
# downscoped, so it can create/publish/share dashboards. Everything else in the
# app stays on-behalf-of-user; this one path is the documented exception.
def _client(request: Request | None = None) -> tuple[str, dict]:
    return get_workspace_host(), get_auth_headers()


def _user_client(request: Request) -> tuple[str, dict, str]:
    """Lakeview writes run as the service principal (see module note above)."""
    return get_workspace_host(), get_auth_headers(), "service principal"


async def _get_room_warehouse(room_id: str, request: Request | None = None) -> str:
    host, headers = _client(request)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{host}/api/2.0/genie/spaces/{room_id}", headers=headers)
        resp.raise_for_status()
        return resp.json().get("warehouse_id", "") or ""


def _user_home(user_email: str) -> str:
    """Lakeview parent_path must be under /Workspace; default to user's home."""
    if user_email:
        return f"/Workspace/Users/{user_email}"
    return "/Workspace/Shared"


_TYPE_MAP = {
    "string": "string", "varchar": "string", "char": "string",
    "int": "integer", "integer": "integer", "bigint": "integer", "long": "integer", "smallint": "integer",
    "double": "decimal", "float": "decimal", "decimal": "decimal", "numeric": "decimal",
    "boolean": "boolean", "bool": "boolean",
    "date": "date",
    "timestamp": "datetime", "timestamp_ntz": "datetime", "datetime": "datetime",
}


def _lakeview_type(sql_type: str | None) -> str:
    if not sql_type:
        return "string"
    base = sql_type.strip().lower().split("(")[0].strip()
    return _TYPE_MAP.get(base, "string")


# Map frontend chart-type IDs to Lakeview widgetType
_CHART_TYPE_MAP = {
    "barV": "bar",
    "barH": "bar",
    "line": "line",
    "area": "area",
    "stacked": "bar",
    "pie": "pie",
    "scatter": "scatter",
    "table": "table",
}


def _build_table_widget(widget_id: str, dataset_name: str, columns: list[dict]) -> dict:
    """Default — a table view showing all columns."""
    fields = [{"name": c["name"], "expression": f"`{c['name']}`"} for c in columns]
    encoded = [
        {"fieldName": c["name"], "displayName": c["name"], "type": _lakeview_type(c.get("type"))}
        for c in columns
    ]
    return {
        "widget": {
            "name": widget_id,
            "queries": [{
                "name": f"q_{widget_id}",
                "query": {
                    "datasetName": dataset_name,
                    "fields": fields,
                    "disaggregated": True,
                },
            }],
            "spec": {
                "version": 3,
                "widgetType": "table",
                "encodings": {"columns": encoded},
            },
        },
        "position": {"x": 0, "y": 0, "width": 6, "height": 6},
    }


def _build_chart_widget(widget_id: str, dataset_name: str, chart_hint: dict, columns: list[dict]) -> dict:
    """Build a non-table Lakeview widget that mirrors the chart the user picked in chat.

    chart_hint = {widget_type: str, label_column: str|None, value_columns: list[str]}
    Falls back to a table widget if anything is missing or unmappable.
    """
    raw_type = (chart_hint or {}).get("widget_type") or "table"
    lakeview_type = _CHART_TYPE_MAP.get(raw_type, "table")
    label_col = (chart_hint or {}).get("label_column")
    value_cols = (chart_hint or {}).get("value_columns") or []

    # Fall back to table when we don't have enough info or for unmappable types
    if lakeview_type == "table" or not value_cols:
        return _build_table_widget(widget_id, dataset_name, columns)

    col_by_name = {c["name"]: c for c in columns}

    # Build query fields — include label + values
    fields = []
    if label_col and label_col in col_by_name:
        fields.append({"name": label_col, "expression": f"`{label_col}`"})
    for v in value_cols:
        if v in col_by_name:
            fields.append({"name": v, "expression": f"`{v}`"})

    if not fields:
        return _build_table_widget(widget_id, dataset_name, columns)

    primary_value = value_cols[0]

    # Build encodings per chart type
    if lakeview_type == "pie":
        encodings = {
            "angle": {"fieldName": primary_value, "displayName": primary_value, "type": _lakeview_type(col_by_name.get(primary_value, {}).get("type"))},
        }
        if label_col:
            encodings["color"] = {"fieldName": label_col, "displayName": label_col, "type": "string"}
    elif lakeview_type == "scatter":
        # Need x (label or first numeric) and y (primary value)
        x_field = label_col if label_col and label_col in col_by_name else (value_cols[1] if len(value_cols) > 1 else primary_value)
        encodings = {
            "x": {"fieldName": x_field, "displayName": x_field, "type": _lakeview_type(col_by_name.get(x_field, {}).get("type"))},
            "y": {"fieldName": primary_value, "displayName": primary_value, "type": _lakeview_type(col_by_name.get(primary_value, {}).get("type"))},
        }
    else:
        # bar / line / area — x is label, y is the (first) numeric series
        x_field = label_col or primary_value
        encodings = {
            "x": {"fieldName": x_field, "displayName": x_field, "type": _lakeview_type(col_by_name.get(x_field, {}).get("type"))},
            "y": {"fieldName": primary_value, "displayName": primary_value, "type": _lakeview_type(col_by_name.get(primary_value, {}).get("type"))},
        }

    spec: dict = {
        "version": 3,
        "widgetType": lakeview_type,
        "encodings": encodings,
    }
    # Stacked bar hint
    if raw_type == "stacked":
        spec["stack"] = "stack"
    # Horizontal bar hint
    if raw_type == "barH":
        spec["orientation"] = "horizontal"

    return {
        "widget": {
            "name": widget_id,
            "queries": [{
                "name": f"q_{widget_id}",
                "query": {
                    "datasetName": dataset_name,
                    "fields": fields,
                    "disaggregated": True,
                },
            }],
            "spec": spec,
        },
        "position": {"x": 0, "y": 0, "width": 6, "height": 6},
    }


def _next_y(existing_widgets: list[dict]) -> int:
    """Compute Y coordinate so a new widget stacks below existing ones."""
    bottom = 0
    for w in existing_widgets:
        pos = w.get("position", {})
        y = pos.get("y", 0) + pos.get("height", 0)
        if y > bottom:
            bottom = y
    return bottom


def _make_widget(widget_id: str, dataset_name: str, columns: list[dict], chart_hint: dict | None) -> dict:
    if chart_hint:
        return _build_chart_widget(widget_id, dataset_name, chart_hint, columns)
    return _build_table_widget(widget_id, dataset_name, columns)


def _build_initial_dashboard(dataset_name: str, dataset_display: str, sql: str, columns: list[dict], chart_hint: dict | None = None) -> str:
    widget_id = f"w_{uuid.uuid4().hex[:8]}"
    widget = _make_widget(widget_id, dataset_name, columns, chart_hint)
    spec = {
        "datasets": [{
            "name": dataset_name,
            "displayName": dataset_display,
            "queryLines": [sql],
        }],
        "pages": [{
            "name": "main",
            "displayName": "Overview",
            "layout": [widget],
        }],
    }
    return json.dumps(spec)


def _append_widget(serialized: str, dataset_name: str, dataset_display: str, sql: str, columns: list[dict], chart_hint: dict | None = None) -> str:
    spec = json.loads(serialized) if serialized else {}
    spec.setdefault("datasets", []).append({
        "name": dataset_name,
        "displayName": dataset_display,
        "queryLines": [sql],
    })
    pages = spec.setdefault("pages", [{"name": "main", "displayName": "Overview", "layout": []}])
    page = pages[0]
    layout = page.setdefault("layout", [])
    widget_id = f"w_{uuid.uuid4().hex[:8]}"
    widget = _make_widget(widget_id, dataset_name, columns, chart_hint)
    widget["position"]["y"] = _next_y(layout)
    layout.append(widget)
    return json.dumps(spec)


def _columns_from_query_result(qr: dict | None) -> list[dict]:
    """Extract [{name, type}] from a Genie query_result manifest. Falls back to col_0..N."""
    if not qr:
        return [{"name": "value", "type": "string"}]
    manifest = qr.get("manifest", {}) or {}
    schema = manifest.get("schema", {}) or {}
    cols = schema.get("columns", []) or []
    extracted = []
    for c in cols:
        name = c.get("name")
        if not name:
            continue
        # Genie/SQL-statement API uses `type_text` (e.g. "BIGINT", "STRING")
        type_text = c.get("type_text") or c.get("type_name") or c.get("type") or ""
        extracted.append({"name": name, "type": type_text})
    if extracted:
        return extracted
    rows = qr.get("result", {}).get("data_array", []) or []
    if rows and rows[0]:
        return [{"name": f"col_{i}", "type": "string"} for i in range(len(rows[0]))]
    return [{"name": "value", "type": "string"}]


class SaveWidgetRequest(BaseModel):
    room_id: str
    name: str
    sql: str
    columns: list[dict] | None = None  # optional explicit [{name, type}]
    query_result: dict | None = None  # optional Genie query_result for column inference
    dashboard_id: str | None = None   # optional explicit target; else use room default
    chart_hint: dict | None = None    # optional {widget_type, label_column, value_columns}


class ShareRequest(BaseModel):
    user_emails: list[str]


class NewDashboardRequest(BaseModel):
    room_id: str
    name: str | None = None


def _dashboard_url(host: str, dashboard_id: str) -> str:
    return f"{host}/dashboardsv3/{dashboard_id}"


def _embed_url(host: str, dashboard_id: str) -> str:
    """URL for embedding a published AI/BI dashboard in an iframe.

    Requires the dashboard to be published and the app's domain to be on the
    workspace's approved-domains list for dashboard embedding.
    """
    return f"{host}/embed/dashboardsv3/{dashboard_id}"


async def _publish_lakeview(host: str, headers: dict, dashboard_id: str, warehouse_id: str) -> bool:
    """Publish a Lakeview dashboard so it can be viewed/embedded. Best-effort.

    Publishes with viewer credentials (embed_credentials=False) so each viewer's
    own Unity Catalog permissions apply — consistent with this app's OBO posture.
    Returns True on success, False otherwise (never raises).
    """
    if not warehouse_id:
        return False
    body = {"warehouse_id": warehouse_id, "embed_credentials": False}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{host}{LAKEVIEW_PREFIX}/{dashboard_id}/published",
                headers=headers, json=body,
            )
            resp.raise_for_status()
            return True
    except Exception as e:
        print(f"[dashboards] publish failed for {dashboard_id}: {e}")
        return False


def _row_to_dashboard(row, host: str) -> dict:
    return {
        "id": row["id"],
        "dashboard_id": row["dashboard_id"],
        "name": row["name"] or "Dashboard",
        "is_default": row["is_default"],
        "parent_path": row["parent_path"] or "",
        "owner": row["owner"] or "",
        "created_at": row["created_at"].isoformat(),
        "url": _dashboard_url(host, row["dashboard_id"]),
        "embed_url": _embed_url(host, row["dashboard_id"]),
    }


async def _get_default_dashboard(conn, room_id: str):
    """Return the room's default dashboard row, or None."""
    row = await conn.fetchrow(
        f"SELECT id, dashboard_id, name, is_default, parent_path, owner, created_at "
        f"FROM {TABLE} WHERE room_id = $1 AND is_default = TRUE LIMIT 1",
        room_id,
    )
    if row:
        return row
    # Fall back to most recent
    return await conn.fetchrow(
        f"SELECT id, dashboard_id, name, is_default, parent_path, owner, created_at "
        f"FROM {TABLE} WHERE room_id = $1 ORDER BY created_at DESC LIMIT 1",
        room_id,
    )


async def _create_lakeview(host: str, headers: dict, display_name: str, warehouse_id: str,
                           parent_path: str, serialized: str, auth_mode: str = "") -> tuple[str, str]:
    """Create a Lakeview dashboard. Falls back to /Workspace/Shared if user's home dir is inaccessible.

    Returns (dashboard_id, parent_path_actually_used).
    """
    candidates = [parent_path]
    if parent_path != "/Workspace/Shared":
        candidates.append("/Workspace/Shared")

    last_err = None
    async with httpx.AsyncClient(timeout=30) as client:
        for path in candidates:
            body = {
                "display_name": display_name,
                "warehouse_id": warehouse_id,
                "parent_path": path,
                "serialized_dashboard": serialized,
            }
            try:
                resp = await client.post(f"{host}{LAKEVIEW_PREFIX}", headers=headers, json=body)
                resp.raise_for_status()
                return resp.json().get("dashboard_id", ""), path
            except httpx.HTTPStatusError as e:
                last_err = e
                # Only fall back on permission/not-found errors
                if e.response.status_code not in (403, 404):
                    break
                print(f"[dashboards] create failed at {path}: {e.response.status_code} {e.response.text[:200]}")

    prefix = f"[{auth_mode}] " if auth_mode else ""
    if last_err is not None:
        raise HTTPException(
            status_code=last_err.response.status_code,
            detail=f"{prefix}Lakeview create failed (tried {', '.join(candidates)}): {last_err.response.text}",
        )
    raise HTTPException(status_code=500, detail=f"{prefix}Lakeview create failed for unknown reason")


@router.get("/dashboards/{room_id}")
async def list_room_dashboards(room_id: str):
    """List all dashboards for a room."""
    await _ensure_table()
    pool = await db.get_pool()
    if not pool:
        return {"dashboards": [], "default_id": None, "db_available": False}
    try:
        host = get_workspace_host()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                f"SELECT id, dashboard_id, name, is_default, parent_path, owner, created_at "
                f"FROM {TABLE} WHERE room_id = $1 ORDER BY is_default DESC, created_at DESC",
                room_id,
            )
            dashboards = [_row_to_dashboard(r, host) for r in rows]
            default = next((d for d in dashboards if d["is_default"]), dashboards[0] if dashboards else None)
            return {
                "dashboards": dashboards,
                "default_id": default["id"] if default else None,
                "db_available": True,
            }
    except Exception as e:
        print(f"[dashboards] list error: {e}")
        return {"dashboards": [], "default_id": None, "db_available": False}


@router.post("/dashboards/new")
async def new_dashboard(req: NewDashboardRequest, request: Request):
    """Create a fresh empty Lakeview dashboard for the room. Set as default if it's the first."""
    await _ensure_table()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")

    user_email = _current_user_email(request).lower()
    host, headers, _auth_mode = _user_client(request)

    warehouse_id = await _get_room_warehouse(req.room_id, request)
    if not warehouse_id:
        raise HTTPException(status_code=400, detail="Room has no warehouse — set one on the Genie room first")

    parent_path = _user_home(user_email)
    display_name = (req.name or "").strip() or f"Genco — room {req.room_id[:8]}"
    # Seed with a stub dataset so the dashboard isn't completely empty
    seed_spec = {
        "datasets": [],
        "pages": [{"name": "main", "displayName": "Overview", "layout": []}],
    }
    dashboard_id, actual_path = await _create_lakeview(host, headers, display_name, warehouse_id,
                                                       parent_path, json.dumps(seed_spec), auth_mode=_auth_mode)
    if not dashboard_id:
        raise HTTPException(status_code=500, detail="Lakeview create returned no id")

    # Publish so it can be viewed/embedded in-app (best-effort).
    await _publish_lakeview(host, headers, dashboard_id, warehouse_id)

    try:
        async with pool.acquire() as conn:
            existing_count = await conn.fetchval(
                f"SELECT COUNT(*) FROM {TABLE} WHERE room_id = $1", req.room_id,
            )
            is_default = (existing_count == 0)
            local_id = uuid.uuid4().hex
            await conn.execute(
                f"INSERT INTO {TABLE} (id, room_id, dashboard_id, name, is_default, parent_path, owner) "
                f"VALUES ($1, $2, $3, $4, $5, $6, $7)",
                local_id, req.room_id, dashboard_id, display_name, is_default, actual_path, user_email,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Saved Lakeview dashboard but failed to record locally: {e}")

    return {
        "id": local_id,
        "dashboard_id": dashboard_id,
        "name": display_name,
        "is_default": is_default,
        "url": _dashboard_url(host, dashboard_id),
        "embed_url": _embed_url(host, dashboard_id),
    }


@router.post("/dashboards/{local_id}/set-default")
async def set_default_dashboard(local_id: str):
    """Mark this dashboard as the room's default, unsetting any other."""
    await _ensure_table()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                f"SELECT room_id FROM {TABLE} WHERE id = $1", local_id,
            )
            if not row:
                raise HTTPException(status_code=404, detail="Dashboard not found")
            async with conn.transaction():
                await conn.execute(
                    f"UPDATE {TABLE} SET is_default = FALSE WHERE room_id = $1", row["room_id"],
                )
                await conn.execute(
                    f"UPDATE {TABLE} SET is_default = TRUE WHERE id = $1", local_id,
                )
        return {"set_default": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/dashboards/save-widget")
async def save_widget(req: SaveWidgetRequest, request: Request):
    """Append a table widget to the room's default dashboard (or specified one). Creates default if missing."""
    await _ensure_table()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")

    user_email = _current_user_email(request).lower()
    columns = req.columns or _columns_from_query_result(req.query_result)
    dataset_name = f"ds_{uuid.uuid4().hex[:8]}"
    dataset_display = req.name[:60] if req.name else "Untitled"

    host, headers, auth_mode = _user_client(request)

    # Find target dashboard
    try:
        async with pool.acquire() as conn:
            if req.dashboard_id:
                row = await conn.fetchrow(
                    f"SELECT id, dashboard_id, parent_path, owner FROM {TABLE} WHERE dashboard_id = $1 AND room_id = $2",
                    req.dashboard_id, req.room_id,
                )
            else:
                row = await _get_default_dashboard(conn, req.room_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    async with httpx.AsyncClient(timeout=30) as client:
        if row:
            # Append to existing
            try:
                get_resp = await client.get(f"{host}{LAKEVIEW_PREFIX}/{row['dashboard_id']}", headers=headers)
                get_resp.raise_for_status()
                current = get_resp.json()
            except httpx.HTTPStatusError as e:
                raise HTTPException(status_code=e.response.status_code, detail=f"[{auth_mode}] Failed to load dashboard: {e.response.text}")

            etag = current.get("etag", "")
            new_serialized = _append_widget(
                current.get("serialized_dashboard", ""),
                dataset_name, dataset_display, req.sql, columns,
                chart_hint=req.chart_hint,
            )
            patch_body = {"serialized_dashboard": new_serialized, "etag": etag}
            try:
                patch_resp = await client.patch(
                    f"{host}{LAKEVIEW_PREFIX}/{row['dashboard_id']}",
                    headers=headers, json=patch_body,
                )
                patch_resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                raise HTTPException(status_code=e.response.status_code, detail=f"[{auth_mode}] Failed to update dashboard: {e.response.text}")
            dashboard_id = row["dashboard_id"]
            created_new = False
        else:
            # No dashboard yet — create the room's first
            warehouse_id = await _get_room_warehouse(req.room_id, request)
            if not warehouse_id:
                raise HTTPException(status_code=400, detail="Room has no warehouse — set one on the Genie room first")
            parent_path = _user_home(user_email)
            serialized = _build_initial_dashboard(dataset_name, dataset_display, req.sql, columns, chart_hint=req.chart_hint)
            display_name = f"Genco — room {req.room_id[:8]}"
            dashboard_id, actual_path = await _create_lakeview(host, headers, display_name, warehouse_id, parent_path, serialized, auth_mode=auth_mode)
            if not dashboard_id:
                raise HTTPException(status_code=500, detail="Lakeview create returned no id")
            try:
                async with pool.acquire() as conn:
                    await conn.execute(
                        f"INSERT INTO {TABLE} (id, room_id, dashboard_id, name, is_default, parent_path, owner) "
                        f"VALUES ($1, $2, $3, $4, TRUE, $5, $6)",
                        uuid.uuid4().hex, req.room_id, dashboard_id, display_name, actual_path, user_email,
                    )
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Saved Lakeview dashboard but failed to record locally: {e}")
            created_new = True

    # Re-publish so the in-app embed reflects the latest widget (best-effort).
    try:
        pub_wh = await _get_room_warehouse(req.room_id, request)
        await _publish_lakeview(host, headers, dashboard_id, pub_wh)
    except Exception:
        pass

    return {
        "dashboard_id": dashboard_id,
        "url": _dashboard_url(host, dashboard_id),
        "embed_url": _embed_url(host, dashboard_id),
        "created": created_new,
    }


@router.post("/dashboards/{dashboard_id}/share")
async def share_dashboard(dashboard_id: str, req: ShareRequest, request: Request):
    """Grant CAN_READ permission on the Lakeview dashboard to the given users."""
    host, headers = _client(request)
    emails = [e.strip().lower() for e in req.user_emails if e and "@" in e]
    if not emails:
        raise HTTPException(status_code=400, detail="No valid emails provided")

    acl = [{"user_name": e, "permission_level": "CAN_READ"} for e in emails]
    body = {"access_control_list": acl}

    # Lakeview dashboards use the dashboards-v3 permissions endpoint
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.patch(
                f"{host}/api/2.0/permissions/dashboards/{dashboard_id}",
                headers=headers,
                json=body,
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=f"Permission set failed: {e.response.text}")

    return {"shared_with": emails, "shared": True}


@router.post("/dashboards/{dashboard_id}/publish")
async def publish_dashboard(dashboard_id: str, request: Request):
    """Publish a dashboard so it can be viewed/embedded in-app.

    Used by the in-app Dashboard tab to ensure older dashboards (created before
    auto-publish) are published. Resolves the room's warehouse from the local
    mapping. Returns the embed URL.
    """
    await _ensure_table()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")

    host, headers, _auth_mode = _user_client(request)
    try:
        async with pool.acquire() as conn:
            room_id = await conn.fetchval(
                f"SELECT room_id FROM {TABLE} WHERE dashboard_id = $1 LIMIT 1", dashboard_id,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    if not room_id:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    warehouse_id = await _get_room_warehouse(room_id, request)
    if not warehouse_id:
        raise HTTPException(status_code=400, detail="Room has no warehouse configured")

    published = await _publish_lakeview(host, headers, dashboard_id, warehouse_id)
    return {
        "published": published,
        "embed_url": _embed_url(host, dashboard_id),
        "url": _dashboard_url(host, dashboard_id),
    }
