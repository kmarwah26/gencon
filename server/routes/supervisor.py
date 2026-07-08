"""Ask Everything — query a Databricks Agent Bricks Multi-Agent Supervisor.

The app no longer orchestrates its own multi-agent supervisor (the old in-app
langgraph + GenieAgent stack was fragile: MCP/langchain version skew 503'd it on
redeploys, and it defaulted to the service-principal identity). Instead we query an
Agent Bricks Multi-Agent Supervisor that the customer builds in the workspace. It is
deployed as a serving endpoint, routes across Genie-space subagents, and enforces the
caller's own Unity Catalog permissions — so passing the logged-in user's OBO token
means Genie subagents run with that user's grants.
"""

import json
import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from server.config import get_workspace_host, get_auth_headers
from server.db import db
from server.routes.filters import _current_user_email

router = APIRouter(tags=["supervisor"])

# Per-user "Ask Everything" setup: which supervisor serving endpoint to query and
# optional free-text context prepended to the question. One row per user (by email).
CONFIG_TABLE = "genco_supervisor_config"

CONFIG_TABLE_SQL = f"""
CREATE TABLE IF NOT EXISTS {CONFIG_TABLE} (
    user_email TEXT PRIMARY KEY,
    endpoint_name TEXT,
    instructions TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

# The table previously stored a `room_ids` column for the in-app supervisor. Add the
# `endpoint_name` column on existing deployments where the table predates this change.
CONFIG_TABLE_MIGRATE_SQL = (
    f"ALTER TABLE {CONFIG_TABLE} ADD COLUMN IF NOT EXISTS endpoint_name TEXT"
)

_config_table_ready = False


async def _ensure_config_table():
    global _config_table_ready
    if _config_table_ready:
        return
    pool = await db.get_pool()
    if not pool:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(CONFIG_TABLE_SQL)
            await conn.execute(CONFIG_TABLE_MIGRATE_SQL)
        _config_table_ready = True
    except Exception as e:
        print(f"[supervisor] Failed to create/migrate config table: {e}")


class SupervisorConfig(BaseModel):
    endpoint_name: str | None = None
    instructions: str | None = None


class SupervisorAskRequest(BaseModel):
    question: str
    endpoint_name: str | None = None  # falls back to the user's saved config
    instructions: str | None = None   # optional context prepended to the question


# ── Discover candidate supervisor serving endpoints ──


@router.get("/supervisor/endpoints")
async def list_supervisor_endpoints(request: Request):
    """List serving endpoints the user can pick as their supervisor.

    Databricks doesn't expose a reliable "this endpoint is a supervisor" marker on the
    serving-endpoints side, so we return the queryable endpoints and let the user choose
    the one their admin created. Uses a raw REST call (like server/routes/genie.py) under
    the user's OBO token rather than the SDK — the pinned SDK's dataclass can fail to
    parse newer serving-endpoint response fields, and REST just returns the JSON.
    """
    host = get_workspace_host().rstrip("/")
    headers = get_auth_headers(request)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{host}/api/2.0/serving-endpoints", headers=headers)
            resp.raise_for_status()
            data = resp.json()
        endpoints = [
            {"name": e.get("name", ""), "state": (e.get("state") or {}).get("ready", "")}
            for e in data.get("endpoints", [])
            if e.get("name")
        ]
        endpoints.sort(key=lambda x: x["name"].lower())
        return {"endpoints": endpoints}
    except httpx.HTTPStatusError as e:
        detail = e.response.text if e.response else str(e)
        raise HTTPException(status_code=e.response.status_code, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Supervisor details: subagents (Genie spaces) + instructions ──


@router.get("/supervisor/endpoints/{endpoint_name}/details")
async def get_supervisor_details(endpoint_name: str, request: Request):
    """Return the supervisor's description/instructions and its Genie subagents.

    Uses the Agent Bricks supervisor-agents REST API (2.1). We map the serving
    endpoint the user picked back to its supervisor by matching `endpoint_name` in the
    list, then read the agent metadata and its tools. This is preview API surface not
    yet in the pinned SDK, so we call it over raw REST under the user's OBO token.
    Returns empty details (not an error) when the endpoint isn't a managed supervisor,
    so the UI can simply show nothing extra.
    """
    host = get_workspace_host().rstrip("/")
    # The supervisor-agents (Agent Bricks) API has no user-authorization OBO scope in the
    # app's scope set, so the forwarded user token 403s on it. Reading the MAS *definition*
    # (name, instructions, subagent list) is non-sensitive workspace metadata, so we read
    # it with the service principal. The actual query (/invocations) and the per-user Genie
    # title lookup below still run under the user's OBO token.
    sp_headers = get_auth_headers()          # service principal
    obo_headers = get_auth_headers(request)  # logged-in user
    empty = {"is_supervisor": False, "display_name": "", "description": "",
             "instructions": "", "genie_spaces": []}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # 1. Find the supervisor whose endpoint matches the selected one.
            agent = None
            page_token = None
            for _ in range(20):
                params = {"page_token": page_token} if page_token else {}
                r = await client.get(f"{host}/api/2.1/supervisor-agents", headers=sp_headers, params=params)
                if r.status_code in (403, 404):
                    # TEMP DEBUG: surface why the SP read failed
                    return {**empty, "_debug": {"status": r.status_code, "body": r.text[:300]}}
                r.raise_for_status()
                data = r.json()
                for a in data.get("supervisor_agents", []):
                    if a.get("endpoint_name") == endpoint_name:
                        agent = a
                        break
                page_token = data.get("next_page_token")
                if agent or not page_token:
                    break
            if not agent:
                return empty

            sid = agent.get("supervisor_agent_id") or ""
            result = {
                "is_supervisor": True,
                "display_name": agent.get("display_name", ""),
                "description": agent.get("description", ""),
                "instructions": agent.get("instructions", ""),
                "genie_spaces": [],
            }

            # 2. List tools; keep the Genie-space subagents.
            tools = []
            page_token = None
            for _ in range(20):
                params = {"page_token": page_token} if page_token else {}
                tr = await client.get(f"{host}/api/2.1/supervisor-agents/{sid}/tools",
                                      headers=sp_headers, params=params)
                tr.raise_for_status()
                tdata = tr.json()
                tools.extend(tdata.get("tools", []) or [])
                page_token = tdata.get("next_page_token")
                if not page_token:
                    break

            for t in tools:
                if t.get("tool_type") != "genie_space":
                    continue
                gs = t.get("genie_space") or {}
                space_id = gs.get("space_id") or gs.get("id") or ""
                title = ""
                # Best-effort: resolve the space's title for a friendlier label. Use the
                # user's OBO token so it respects their Genie visibility; fall back to SP.
                for h in (obo_headers, sp_headers):
                    try:
                        sr = await client.get(f"{host}/api/2.0/genie/spaces/{space_id}", headers=h)
                        if sr.status_code == 200:
                            title = sr.json().get("title", "")
                            break
                    except Exception:
                        pass
                result["genie_spaces"].append({
                    "id": space_id,
                    "title": title or space_id,
                    "description": t.get("description", ""),
                })
            return result
    except httpx.HTTPStatusError as e:
        # Don't hard-fail the panel — surface a soft signal instead.
        if e.response is not None and e.response.status_code in (403, 404):
            return empty
        detail = e.response.text if e.response else str(e)
        raise HTTPException(status_code=e.response.status_code, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Ask the supervisor ──


def _extract_answer(data: dict) -> str:
    """Pull the final assistant text from a serving-endpoint response.

    Handles both agent schemas: ChatAgent ({"messages":[...]}) and ResponsesAgent
    ({"output":[...]}), plus OpenAI chat-completions ({"choices":[...]}). Falls back to
    the raw JSON so the user sees *something* rather than an empty bubble.
    """
    # ChatAgent: messages array, last assistant message wins
    msgs = data.get("messages")
    if isinstance(msgs, list) and msgs:
        for m in reversed(msgs):
            if m.get("role") in (None, "assistant") and m.get("content"):
                c = m["content"]
                return c if isinstance(c, str) else json.dumps(c)

    # ResponsesAgent: output items with text
    output = data.get("output")
    if isinstance(output, list) and output:
        texts = []
        for item in output:
            content = item.get("content")
            if isinstance(content, list):
                for part in content:
                    t = part.get("text") or part.get("output_text")
                    if t:
                        texts.append(t)
            elif isinstance(content, str):
                texts.append(content)
        if texts:
            return "\n".join(texts)
    if isinstance(data.get("output_text"), str):
        return data["output_text"]

    # OpenAI chat-completions
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        msg = choices[0].get("message", {})
        if msg.get("content"):
            return msg["content"]

    return json.dumps(data)


@router.post("/supervisor/ask")
async def supervisor_ask(req: SupervisorAskRequest, request: Request):
    endpoint = req.endpoint_name
    instructions = req.instructions

    # Fall back to the user's saved config for anything not supplied on the request.
    if not endpoint or instructions is None:
        cfg = await _load_config(request)
        endpoint = endpoint or cfg.get("endpoint_name")
        if instructions is None:
            instructions = cfg.get("instructions")

    if not endpoint:
        raise HTTPException(
            status_code=400,
            detail="No supervisor endpoint selected. Pick an Agent Bricks supervisor "
                   "endpoint in the panel first.",
        )

    content = req.question.strip()
    if instructions and instructions.strip():
        content = f"{instructions.strip()}\n\n{content}"

    host = get_workspace_host().rstrip("/")
    headers = get_auth_headers(request)  # OBO: run as the logged-in user
    url = f"{host}/serving-endpoints/{endpoint}/invocations"

    async with httpx.AsyncClient(timeout=300) as client:
        # Try ChatAgent schema first, fall back to ResponsesAgent on a schema 4xx.
        payloads = [
            {"messages": [{"role": "user", "content": content}]},
            {"input": [{"role": "user", "content": content}]},
        ]
        last_error = None
        for payload in payloads:
            try:
                resp = await client.post(url, headers=headers, json=payload)
                resp.raise_for_status()
                return {"answer": _extract_answer(resp.json()), "endpoint_name": endpoint}
            except httpx.HTTPStatusError as e:
                last_error = e
                # Only retry the alternate schema on a 4xx (bad request shape);
                # a 5xx / auth error won't be fixed by changing the body.
                if e.response is None or e.response.status_code not in (400, 422):
                    detail = e.response.text if e.response else str(e)
                    raise HTTPException(status_code=e.response.status_code, detail=detail)
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))
        # Both schemas rejected as 4xx
        detail = last_error.response.text if last_error and last_error.response else "Bad request"
        raise HTTPException(status_code=400, detail=detail)


# ── Persisted per-user config (selected endpoint + instructions) ──


async def _load_config(request: Request) -> dict:
    await _ensure_config_table()
    pool = await db.get_pool()
    if not pool:
        return {"endpoint_name": None, "instructions": ""}
    user_email = _current_user_email(request).lower()
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                f"SELECT endpoint_name, instructions FROM {CONFIG_TABLE} WHERE user_email = $1",
                user_email,
            )
        if not row:
            return {"endpoint_name": None, "instructions": ""}
        return {"endpoint_name": row["endpoint_name"], "instructions": row["instructions"] or ""}
    except Exception as e:
        print(f"[supervisor] config load error: {e}")
        return {"endpoint_name": None, "instructions": ""}


@router.get("/supervisor/config")
async def get_supervisor_config(request: Request):
    """Return the current user's saved supervisor setup (endpoint + instructions)."""
    pool = await db.get_pool()
    cfg = await _load_config(request)
    return {**cfg, "db_available": pool is not None}


@router.put("/supervisor/config")
async def save_supervisor_config(cfg: SupervisorConfig, request: Request):
    """Upsert the current user's supervisor setup."""
    await _ensure_config_table()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    user_email = _current_user_email(request).lower()
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                f"""INSERT INTO {CONFIG_TABLE} (user_email, endpoint_name, instructions, updated_at)
                    VALUES ($1, $2, $3, NOW())
                    ON CONFLICT (user_email) DO UPDATE
                    SET endpoint_name = EXCLUDED.endpoint_name,
                        instructions = EXCLUDED.instructions,
                        updated_at = NOW()""",
                user_email, (cfg.endpoint_name or None), (cfg.instructions or "").strip(),
            )
        return {"saved": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
