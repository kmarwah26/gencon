import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from server.db import db

router = APIRouter(tags=["saved_questions"])

TABLE = "saved_questions"

CREATE_TABLE_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    question TEXT NOT NULL,
    sql TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_questions_room ON {TABLE} (room_id, created_at DESC);
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
        print(f"[saved_questions] Failed to create table: {e}")


class SaveQuestionRequest(BaseModel):
    room_id: str
    question: str
    sql: str


@router.get("/saved-questions/{room_id}")
async def list_saved_questions(room_id: str):
    await _ensure_table()
    pool = await db.get_pool()
    if not pool:
        return {"questions": [], "db_available": False}
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                f"SELECT id, question, sql, created_at FROM {TABLE} WHERE room_id = $1 ORDER BY created_at DESC",
                room_id,
            )
            return {
                "questions": [
                    {
                        "id": r["id"],
                        "question": r["question"],
                        "sql": r["sql"],
                        "created_at": r["created_at"].isoformat(),
                    }
                    for r in rows
                ],
                "db_available": True,
            }
    except Exception as e:
        print(f"[saved_questions] list error: {e}")
        return {"questions": [], "db_available": False}


@router.post("/saved-questions")
async def save_question(req: SaveQuestionRequest):
    await _ensure_table()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        qid = uuid.uuid4().hex
        async with pool.acquire() as conn:
            await conn.execute(
                f"INSERT INTO {TABLE} (id, room_id, question, sql, created_at) VALUES ($1, $2, $3, $4, $5)",
                qid, req.room_id, req.question, req.sql,
                datetime.now(timezone.utc),
            )
        return {"id": qid, "saved": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/saved-questions/{question_id}")
async def delete_saved_question(question_id: str):
    await _ensure_table()
    pool = await db.get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        async with pool.acquire() as conn:
            await conn.execute(f"DELETE FROM {TABLE} WHERE id = $1", question_id)
        return {"deleted": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
