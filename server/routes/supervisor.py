import json
import re
import asyncio
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from server.config import get_workspace_host, get_auth_headers, get_workspace_client
from server.db import db
from server.routes.filters import _current_user_email


def sanitize_agent_name(title: str) -> str:
    """Turn a Genie room title into a valid tool/agent name.

    The model tool-call API requires names to match ^[a-zA-Z0-9_-]{1,128}$, so any
    character outside [a-z0-9_-] must be replaced — not just spaces and slashes.
    Room titles like "Fintech AI - Credit [Lucas]" contain brackets, parens, dots,
    apostrophes, accents, etc. that otherwise trigger a 400 BAD_REQUEST on the
    tools.N.custom.name field. Collapse runs of replacements, trim stray dashes,
    cap length, and never return empty.
    """
    name = re.sub(r"[^a-z0-9_-]+", "-", (title or "").lower())
    name = re.sub(r"-{2,}", "-", name).strip("-")[:30].strip("-")
    return name or "agent"

# Lazy-load the langchain stack — its transitive MCP deps occasionally break
# on Apps redeploys (mcp / langchain-mcp-adapters version skew). Importing at
# function-call time keeps the rest of the app available even when the supervisor
# can't load.
ChatDatabricks = None  # type: ignore
GenieAgent = None  # type: ignore
create_supervisor = None  # type: ignore


def _ensure_langchain_imports():
    """Lazily import the supervisor stack; raise a clean 503 if unavailable."""
    global ChatDatabricks, GenieAgent, create_supervisor
    if ChatDatabricks is not None and GenieAgent is not None and create_supervisor is not None:
        return
    try:
        from databricks_langchain import ChatDatabricks as _Chat  # noqa: WPS433
        from databricks_langchain.genie import GenieAgent as _Genie  # noqa: WPS433
        from langgraph_supervisor import create_supervisor as _CreateSupervisor  # noqa: WPS433
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Supervisor stack unavailable due to dependency issue: {e}. "
                   f"Other features still work; please rebuild the app deps to fix.",
        )
    ChatDatabricks = _Chat
    GenieAgent = _Genie
    create_supervisor = _CreateSupervisor

router = APIRouter(tags=["supervisor"])

LLM_ENDPOINT = "databricks-claude-sonnet-4-5"

# Per-user "Ask Everything" supervisor setup: which rooms the agent can route to and
# free-text instructions/context. One config row per user (keyed by email). room_ids is
# stored as a JSON array string for portability (no asyncpg array/JSONB codec needed).
CONFIG_TABLE = "genco_supervisor_config"

CONFIG_TABLE_SQL = f"""
CREATE TABLE IF NOT EXISTS {CONFIG_TABLE} (
    user_email TEXT PRIMARY KEY,
    room_ids TEXT NOT NULL DEFAULT '[]',
    instructions TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

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
        _config_table_ready = True
    except Exception as e:
        print(f"[supervisor] Failed to create config table: {e}")


class SupervisorAskRequest(BaseModel):
    question: str
    room_ids: list[str]
    room_descriptions: list[dict]  # [{id, title, description}]
    instructions: str | None = None  # user-provided context to guide routing + answers
    conversation_state: dict | None = None
    recursion_limit: int = 25


class SupervisorConfig(BaseModel):
    room_ids: list[str] = []
    instructions: str | None = None


class RoutingReasoning(BaseModel):
    """Structured reasoning about the routing decision."""
    selected_room: str  # title of the selected room
    reasoning: str      # why this room was chosen
    confidence: str     # high, medium, low
    considered: list[dict]  # [{room_title, relevance_note}] for all rooms


# ── Build a supervisor graph for the selected rooms ──


def _build_supervisor(rooms: list[dict], instructions: str | None = None, client=None):
    """Create a langgraph supervisor with GenieAgent subagents for each room.

    `client` is the per-user OBO WorkspaceClient. Passing it makes each GenieAgent
    run its Genie query as the logged-in user, so their own Unity Catalog grants
    apply. Without it, GenieAgent falls back to the app's service-principal identity,
    which typically lacks SELECT on the underlying tables — producing a permission
    error even when the user themselves has access.
    """
    _ensure_langchain_imports()
    llm = ChatDatabricks(endpoint=LLM_ENDPOINT)

    agents = []
    agent_descriptions = ""
    for room in rooms:
        name = sanitize_agent_name(room["title"])
        desc = room.get("description") or room["title"]
        genie = GenieAgent(
            genie_space_id=room["id"],
            genie_agent_name=name,
            description=desc,
            client=client,
        )
        genie.name = name
        agents.append(genie)
        agent_descriptions += f"- {name}: {desc}\n"

    # User-provided context/instructions guide BOTH routing and final synthesis.
    user_context = ""
    if instructions and instructions.strip():
        user_context = (
            "Context and instructions from the user — apply these when deciding which "
            "agent to route to and when writing the final answer:\n"
            f"{instructions.strip()}\n\n"
        )

    prompt = (
        "You are a supervisor agent that routes user questions to the most relevant "
        "data agent. Each agent is backed by a Databricks Genie room specialized in "
        "a specific data domain.\n\n"
        f"Available agents:\n{agent_descriptions}\n"
        f"{user_context}"
        "Route the question to the single best agent. If the question spans multiple "
        "domains, pick the most relevant one first. Always delegate — never try to "
        "answer directly.\n\n"
        "IMPORTANT: After delegating to an agent and receiving its response, immediately "
        "synthesize the final answer. Do NOT retry or delegate again — even if the agent "
        "says the question is not relevant. Just relay what the agent said.\n\n"
        "Always start your final response with:\n"
        "[Answered by AGENT_NAME_HERE] — then provide the answer or the agent's response."
    )

    supervisor = create_supervisor(
        agents=agents,
        model=llm,
        prompt=prompt,
        add_handoff_messages=False,
        output_mode="full_history",
    ).compile()

    return supervisor


def _extract_answered_by(answer: str, rooms: list[dict]) -> tuple[str, str | None]:
    """Extract [Answered by AGENT] tag from the answer and return (clean_answer, matched_room_title)."""
    import re
    answer = answer.strip()
    match = re.match(r'\[Answered by\s+(.+?)\]\s*[—\-–]?\s*', answer, re.IGNORECASE)
    if not match:
        return answer, None

    agent_name = match.group(1).strip().lower()
    clean_answer = answer[match.end():].strip()

    # Match agent name to room
    for r in rooms:
        sanitized = sanitize_agent_name(r["title"])
        title_lower = r["title"].lower()
        if agent_name in (sanitized, title_lower) or sanitized in agent_name or title_lower in agent_name:
            return clean_answer, r["title"]

    return clean_answer, None


def _extract_results(events_history: list, rooms: list[dict]) -> list[dict]:
    """Extract per-room results from the supervisor's message history."""
    # Build multiple lookup keys per room (exact name, lowered, stripped)
    room_map: dict[str, dict] = {}
    for r in rooms:
        sanitized = sanitize_agent_name(r["title"])
        room_map[sanitized] = r
        room_map[r["title"].lower()] = r
        room_map[r["title"]] = r
        # Also map by room id
        room_map[r["id"]] = r

    results = []
    seen_room_ids = set()
    for msg in events_history:
        name = getattr(msg, "name", None) or ""
        content = getattr(msg, "content", "")
        role = getattr(msg, "type", "") or ""

        # Try matching by name directly, or lowered
        room = room_map.get(name) or room_map.get(name.lower())

        # Skip non-room messages (user, supervisor AI messages)
        if not room:
            continue
        if room["id"] in seen_room_ids:
            continue
        seen_room_ids.add(room["id"])

        text = content if isinstance(content, str) else json.dumps(content)
        results.append({
            "room_id": room["id"],
            "room_title": room["title"],
            "room_description": room.get("description", ""),
            "status": "COMPLETED",
            "text": text,
            "query": "",
            "description": "",
            "query_result": None,
        })
    return results


def _infer_routed_room(events_history: list, rooms: list[dict]) -> dict | None:
    """Infer which room was routed to from tool calls or handoff messages."""
    sanitized_to_room = {}
    for r in rooms:
        sanitized = sanitize_agent_name(r["title"])
        sanitized_to_room[sanitized] = r

    for msg in events_history:
        # Check for tool_calls that reference an agent name
        tool_calls = getattr(msg, "tool_calls", None) or []
        for tc in tool_calls:
            fn_name = tc.get("name", "") if isinstance(tc, dict) else getattr(tc, "name", "")
            # langgraph handoff tool calls often use "transfer_to_<agent>"
            for prefix in ("transfer_to_", "transfer_"):
                if fn_name.startswith(prefix):
                    agent_name = fn_name[len(prefix):]
                    if agent_name in sanitized_to_room:
                        return sanitized_to_room[agent_name]

        # Check content for agent name mentions
        content = getattr(msg, "content", "")
        if isinstance(content, str):
            for sname, room in sanitized_to_room.items():
                if sname in content.lower():
                    return room
    return None


# ── Main endpoint ──


@router.post("/supervisor/ask")
async def supervisor_ask(req: SupervisorAskRequest, request: Request):
    if not req.room_ids or not req.room_descriptions:
        raise HTTPException(status_code=400, detail="At least one room must be selected")

    try:
        # Run Genie queries as the logged-in user (OBO) so their own UC grants apply,
        # instead of the app service principal which usually can't SELECT the tables.
        obo_client = get_workspace_client(request)
        supervisor = _build_supervisor(req.room_descriptions, req.instructions, client=obo_client)

        # Run the supervisor graph (synchronous langgraph, run in thread)
        limit = max(5, min(req.recursion_limit, 100))
        config = {"recursion_limit": limit}
        try:
            result = await asyncio.to_thread(
                supervisor.invoke,
                {"messages": [{"role": "user", "content": req.question}]},
                config,
            )
        except Exception as graph_err:
            if "recursion" in str(graph_err).lower():
                # Return a helpful message instead of crashing
                return {
                    "answer": (
                        f"The supervisor reached the recursion limit ({limit} steps) before "
                        f"completing. This can happen when the question doesn't match any room's "
                        f"domain well. Try increasing the limit or rephrasing your question."
                    ),
                    "routed_to": [{
                        "room_id": r["id"],
                        "room_title": r["title"],
                        "room_description": r.get("description", ""),
                        "status": "TIMEOUT",
                        "text": "",
                        "query": "",
                        "description": "",
                        "query_result": None,
                    } for r in req.room_descriptions],
                    "routing_reasoning": f"Recursion limit of {limit} reached. The supervisor could not resolve a final answer within the allowed steps.",
                    "room_descriptions": [
                        {"id": r["id"], "title": r["title"], "description": r.get("description", "")}
                        for r in req.room_descriptions
                    ],
                    "recursion_limit_used": limit,
                    "conversation_state": {},
                }
            raise

        messages = result.get("messages", [])

        # The last message from the supervisor is the final answer
        raw_answer = ""
        if messages:
            last = messages[-1]
            raw_answer = last.content if isinstance(last.content, str) else json.dumps(last.content)

        # Parse [Answered by ...] tag from supervisor response
        answer, answered_by_title = _extract_answered_by(raw_answer, req.room_descriptions)

        # Extract per-room routing details from message history
        routed_to = _extract_results(messages, req.room_descriptions)

        # Fallback: if name matching failed, infer from tool calls / content
        if not routed_to:
            inferred = _infer_routed_room(messages, req.room_descriptions)
            if inferred:
                answered_by_title = answered_by_title or inferred["title"]

        # Build routed_to from the answered_by room, or fall back to all rooms
        if not routed_to:
            if answered_by_title:
                # Mark the specific room that answered
                for r in req.room_descriptions:
                    routed_to.append({
                        "room_id": r["id"],
                        "room_title": r["title"],
                        "room_description": r.get("description", ""),
                        "status": "COMPLETED" if r["title"] == answered_by_title else "SKIPPED",
                        "text": answer if r["title"] == answered_by_title else "",
                        "query": "",
                        "description": "",
                        "query_result": None,
                    })
            else:
                # Last resort: mark all rooms as considered
                routed_to = [{
                    "room_id": r["id"],
                    "room_title": r["title"],
                    "room_description": r.get("description", ""),
                    "status": "COMPLETED",
                    "text": "",
                    "query": "",
                    "description": "",
                    "query_result": None,
                } for r in req.room_descriptions]

        # Build routing reasoning from the answered_by info
        routing_reasoning = None
        if answered_by_title:
            matched_room = next((r for r in req.room_descriptions if r["title"] == answered_by_title), None)
            if matched_room:
                desc = matched_room.get("description", "")
                other_rooms = [r["title"] for r in req.room_descriptions if r["title"] != answered_by_title]
                reasoning = f"This question was routed to \"{answered_by_title}\""
                if desc:
                    reasoning += f" because this room specializes in: {desc[:150]}"
                if other_rooms:
                    reasoning += f". Other available rooms ({', '.join(other_rooms)}) were considered but deemed less relevant."
                routing_reasoning = reasoning

        # Log message types for debugging
        msg_debug = [
            {"type": getattr(m, "type", "?"), "name": getattr(m, "name", ""),
             "has_tool_calls": bool(getattr(m, "tool_calls", None)),
             "content_preview": str(getattr(m, "content", ""))[:100]}
            for m in messages
        ]

        return {
            "answer": answer,
            "routed_to": routed_to,
            "routing_reasoning": routing_reasoning,
            "room_descriptions": [
                {"id": r["id"], "title": r["title"], "description": r.get("description", "")}
                for r in req.room_descriptions
            ],
            "message_debug": msg_debug,
            "recursion_limit_used": limit,
            "conversation_state": {},
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Persisted per-user supervisor setup (selected rooms + instructions) ──


@router.get("/supervisor/config")
async def get_supervisor_config(request: Request):
    """Return the current user's saved supervisor setup (rooms + instructions)."""
    await _ensure_config_table()
    pool = await db.get_pool()
    if not pool:
        return {"room_ids": [], "instructions": "", "db_available": False}
    user_email = _current_user_email(request).lower()
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                f"SELECT room_ids, instructions FROM {CONFIG_TABLE} WHERE user_email = $1",
                user_email,
            )
        if not row:
            return {"room_ids": [], "instructions": "", "db_available": True}
        try:
            room_ids = json.loads(row["room_ids"]) if row["room_ids"] else []
        except Exception:
            room_ids = []
        return {"room_ids": room_ids, "instructions": row["instructions"] or "", "db_available": True}
    except Exception as e:
        print(f"[supervisor] config load error: {e}")
        return {"room_ids": [], "instructions": "", "db_available": False}


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
                f"""INSERT INTO {CONFIG_TABLE} (user_email, room_ids, instructions, updated_at)
                    VALUES ($1, $2, $3, NOW())
                    ON CONFLICT (user_email) DO UPDATE
                    SET room_ids = EXCLUDED.room_ids,
                        instructions = EXCLUDED.instructions,
                        updated_at = NOW()""",
                user_email, json.dumps(cfg.room_ids or []), (cfg.instructions or "").strip(),
            )
        return {"saved": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
