"""
Database setup for the semantic cache.

Creates the pgvector extension and semantic_cache table in Lakebase.
Designed to be called once at startup; safe to call multiple times.
"""

from server.db import db

CREATE_EXTENSION_SQL = "CREATE EXTENSION IF NOT EXISTS vector;"

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS semantic_cache (
    id SERIAL PRIMARY KEY,
    room_id TEXT NOT NULL,
    query_text TEXT NOT NULL,
    query_embedding vector(1024),
    response TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    hit_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    last_accessed_at TIMESTAMP DEFAULT NOW()
);
"""

CREATE_INDEXES_SQL = [
    """CREATE INDEX IF NOT EXISTS sc_embedding_idx
       ON semantic_cache USING ivfflat (query_embedding vector_cosine_ops)
       WITH (lists = 100);""",
    """CREATE INDEX IF NOT EXISTS sc_room_idx
       ON semantic_cache (room_id, created_at DESC);""",
    """CREATE INDEX IF NOT EXISTS sc_query_text_idx
       ON semantic_cache USING btree (query_text);""",
]

_ready = False


async def ensure_semantic_cache_table() -> bool:
    """Create the pgvector extension and semantic_cache table if they don't exist.

    Returns:
        True if the table is ready, False if Lakebase is unavailable.
    """
    global _ready
    if _ready:
        return True

    pool = await db.get_pool()
    if not pool:
        return False

    try:
        async with pool.acquire() as conn:
            await conn.execute(CREATE_EXTENSION_SQL)
            await conn.execute(CREATE_TABLE_SQL)
            for idx_sql in CREATE_INDEXES_SQL:
                try:
                    await conn.execute(idx_sql)
                except Exception as e:
                    # IVFFlat index creation may fail if table is empty
                    # (needs at least one row for training); skip and retry later
                    print(f"[semantic_cache] Index creation note: {e}")
        _ready = True
        print("[semantic_cache] Table and indexes ready")
        return True
    except Exception as e:
        print(f"[semantic_cache] Setup failed: {e}")
        return False
