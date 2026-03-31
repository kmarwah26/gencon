import uuid
import json
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from server.db import db

router = APIRouter(tags=["chat_history"])

TABLE = "chat_history"

CREATE_TABLE_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    sql_text TEXT,
    query_result JSONB,
    description TEXT,
    status TEXT,
    user_question TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_history_room_user ON {TABLE} (room_id, user_id, created_at);
"""

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
        print(f"[chat_history] Failed to create table: {e}")


class SaveMessageRequest(BaseModel):
    room_id: str
    user_id: str
    role: str
    content: str
    sql_text: str | None = None
    query_result: dict | None = None
    description: str | None = None
    status: str | None = None
    user_question: str | None = None


class SaveMessagesRequest(BaseModel):
    room_id: str
    user_id: str
    messages: list[SaveMessageRequest]


@router.get("/chat-history/{room_id}")
async def get_chat_history(room_id: str, user_id: str):
    await _ensure_table()
    pool = await db.get_pool()
    if not pool:
        return {"messages": [], "db_available": False}
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                f"""SELECT id, role, content, sql_text, query_result,
                           description, status, user_question, created_at
                    FROM {TABLE}
                    WHERE room_id = $1 AND user_id = $2
                    ORDER BY created_at ASC""",
                room_id, user_id,
            )
            return {
                "messages": [
                    {
                        "id": r["id"],
                        "role": r["role"],
                        "content": r["content"],
                        "sql": r["sql_text"] or "",
                        "queryResult": json.loads(r["query_result"]) if r["query_result"] else None,
                        "description": r["description"] or "",
                        "status": r["status"] or "",
                        "userQuestion": r["user_question"] or "",
                        "created_at": r["created_at"].isoformat(),
                    }
                    for r in rows
                ],
                "db_available": True,
            }
    except Exception as e:
        print(f"[chat_history] get error: {e}")
        return {"messages": [], "db_available": False}


@router.post("/chat-history")
async def save_message(req: SaveMessageRequest):
    await _ensure_table()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        mid = uuid.uuid4().hex
        qr_json = json.dumps(req.query_result) if req.query_result else None
        async with pool.acquire() as conn:
            await conn.execute(
                f"""INSERT INTO {TABLE}
                    (id, room_id, user_id, role, content, sql_text, query_result,
                     description, status, user_question, created_at)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)""",
                mid, req.room_id, req.user_id, req.role, req.content,
                req.sql_text, qr_json,
                req.description, req.status, req.user_question,
                datetime.now(timezone.utc),
            )
        return {"id": mid, "saved": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/chat-history/{room_id}")
async def clear_chat_history(room_id: str, user_id: str):
    await _ensure_table()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                f"DELETE FROM {TABLE} WHERE room_id = $1 AND user_id = $2",
                room_id, user_id,
            )
        return {"cleared": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
