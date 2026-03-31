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
        "answer directly."
    )

    supervisor = create_supervisor(
        agents=agents,
        model=llm,
        prompt=prompt,
        add_handoff_messages=False,
        output_mode="full_history",
    ).compile()

    return supervisor


def _extract_results(events_history: list, rooms: list[dict]) -> list[dict]:
    """Extract per-room results from the supervisor's message history."""
    room_map = {
        r["title"].lower().replace(" ", "-").replace("/", "-")[:30]: r
        for r in rooms
    }

    results = []
    for msg in events_history:
        name = getattr(msg, "name", None) or ""
        content = getattr(msg, "content", "")
        if name in room_map:
            room = room_map[name]
            # Try to extract SQL and structured result from content
            text = content if isinstance(content, str) else json.dumps(content)
            results.append({
                "room_id": room["id"],
                "room_title": room["title"],
                "status": "COMPLETED",
                "text": text,
                "query": "",
                "description": "",
                "query_result": None,
            })
    return results


# ── Main endpoint ──


@router.post("/supervisor/ask")
async def supervisor_ask(req: SupervisorAskRequest):
    if not req.room_ids or not req.room_descriptions:
        raise HTTPException(status_code=400, detail="At least one room must be selected")

    try:
        supervisor = _build_supervisor(req.room_descriptions)

        # Run the supervisor graph (synchronous langgraph, run in thread)
        result = await asyncio.to_thread(
            supervisor.invoke,
            {"messages": [{"role": "user", "content": req.question}]},
        )

        messages = result.get("messages", [])

        # The last message from the supervisor is the final answer
        answer = ""
        if messages:
            last = messages[-1]
            answer = last.content if isinstance(last.content, str) else json.dumps(last.content)

        # Extract per-room routing details
        routed_to = _extract_results(messages, req.room_descriptions)

        return {
            "answer": answer,
            "routed_to": routed_to,
            "conversation_state": {},
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
