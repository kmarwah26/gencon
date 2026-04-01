import json
import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from databricks_langchain import ChatDatabricks
from databricks_langchain.genie import GenieAgent
from langgraph_supervisor import create_supervisor
from server.config import get_workspace_host, get_auth_headers

router = APIRouter(tags=["supervisor"])

LLM_ENDPOINT = "databricks-claude-sonnet-4-5"


class SupervisorAskRequest(BaseModel):
    question: str
    room_ids: list[str]
    room_descriptions: list[dict]  # [{id, title, description}]
    conversation_state: dict | None = None
    recursion_limit: int = 25


class RoutingReasoning(BaseModel):
    """Structured reasoning about the routing decision."""
    selected_room: str  # title of the selected room
    reasoning: str      # why this room was chosen
    confidence: str     # high, medium, low
    considered: list[dict]  # [{room_title, relevance_note}] for all rooms


# ── Build a supervisor graph for the selected rooms ──


def _build_supervisor(rooms: list[dict]):
    """Create a langgraph supervisor with GenieAgent subagents for each room."""
    llm = ChatDatabricks(endpoint=LLM_ENDPOINT)

    agents = []
    agent_descriptions = ""
    for room in rooms:
        name = room["title"].lower().replace(" ", "-").replace("/", "-")[:30]
        desc = room.get("description") or room["title"]
        genie = GenieAgent(
            genie_space_id=room["id"],
            genie_agent_name=name,
            description=desc,
        )
        genie.name = name
        agents.append(genie)
        agent_descriptions += f"- {name}: {desc}\n"

    prompt = (
        "You are a supervisor agent that routes user questions to the most relevant "
        "data agent. Each agent is backed by a Databricks Genie room specialized in "
        "a specific data domain.\n\n"
        f"Available agents:\n{agent_descriptions}\n"
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
        sanitized = r["title"].lower().replace(" ", "-").replace("/", "-")[:30]
        title_lower = r["title"].lower()
        if agent_name in (sanitized, title_lower) or sanitized in agent_name or title_lower in agent_name:
            return clean_answer, r["title"]

    return clean_answer, None


def _extract_results(events_history: list, rooms: list[dict]) -> list[dict]:
    """Extract per-room results from the supervisor's message history."""
    # Build multiple lookup keys per room (exact name, lowered, stripped)
    room_map: dict[str, dict] = {}
    for r in rooms:
        sanitized = r["title"].lower().replace(" ", "-").replace("/", "-")[:30]
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
        sanitized = r["title"].lower().replace(" ", "-").replace("/", "-")[:30]
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
async def supervisor_ask(req: SupervisorAskRequest):
    if not req.room_ids or not req.room_descriptions:
        raise HTTPException(status_code=400, detail="At least one room must be selected")

    try:
        supervisor = _build_supervisor(req.room_descriptions)

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
