"""
Semantic Cache using Databricks Lakebase with pgvector and Databricks embeddings.

Adapted for async usage with asyncpg, scoped per Genie room.
Matches queries based on meaning using vector cosine similarity.
"""

import json
from typing import Optional, Dict, Any, List, Tuple

from server.db import db
from server.semantic_cache.embeddings import get_embedding
from server.semantic_cache.setup import ensure_semantic_cache_table

DEFAULT_SIMILARITY_THRESHOLD = 0.80


class SemanticCache:
    """Async semantic cache backed by Lakebase pgvector, scoped per room."""

    def __init__(self, similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD):
        self.similarity_threshold = similarity_threshold

    async def set(
        self,
        room_id: str,
        query: str,
        response: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[int]:
        """Add a cache entry for a room.

        Returns the cache entry id, or None if DB is unavailable.
        """
        await ensure_semantic_cache_table()
        pool = await db.get_pool()
        if not pool:
            return None

        embedding = get_embedding(query)
        metadata_json = json.dumps(metadata or {})

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO semantic_cache
                    (room_id, query_text, query_embedding, response, metadata)
                VALUES ($1, $2, $3::vector, $4, $5::jsonb)
                RETURNING id
                """,
                room_id,
                query,
                str(embedding),
                response,
                metadata_json,
            )
            return row["id"] if row else None

    async def get(
        self,
        room_id: str,
        query: str,
        return_metadata: bool = False,
    ) -> Optional[str | Tuple[str, float, Dict[str, Any]]]:
        """Retrieve a cached response if a semantically similar query exists.

        Args:
            room_id: Scope the lookup to this Genie room.
            query: The user's question.
            return_metadata: If True, return (response, similarity, metadata).

        Returns:
            Cached response string (or tuple), or None on cache miss.
        """
        await ensure_semantic_cache_table()
        pool = await db.get_pool()
        if not pool:
            return None

        embedding = get_embedding(query)
        emb_str = str(embedding)

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    id,
                    query_text,
                    response,
                    metadata,
                    1 - (query_embedding <=> $1::vector) AS similarity
                FROM semantic_cache
                WHERE room_id = $2
                  AND query_embedding IS NOT NULL
                ORDER BY query_embedding <=> $1::vector
                LIMIT 1
                """,
                emb_str,
                room_id,
            )

            if row:
                similarity = float(row["similarity"])
                meta = json.loads(row["metadata"]) if row["metadata"] else {}

                if similarity >= self.similarity_threshold:
                    # Cache hit — update hit count
                    await conn.execute(
                        """
                        UPDATE semantic_cache
                        SET hit_count = hit_count + 1,
                            last_accessed_at = NOW()
                        WHERE id = $1
                        """,
                        row["id"],
                    )
                    if return_metadata:
                        return (row["response"], similarity, meta, True)
                    return row["response"]
                else:
                    # Cache miss — but return closest match info if requested
                    if return_metadata:
                        return (None, similarity, {}, False)

            return None

    async def search(
        self,
        room_id: str,
        query: str,
        top_k: int = 5,
        min_similarity: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        """Search for similar cached queries in a room."""
        await ensure_semantic_cache_table()
        pool = await db.get_pool()
        if not pool:
            return []

        embedding = get_embedding(query)
        emb_str = str(embedding)
        threshold = min_similarity if min_similarity is not None else self.similarity_threshold

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    id,
                    query_text,
                    response,
                    metadata,
                    hit_count,
                    created_at,
                    last_accessed_at,
                    1 - (query_embedding <=> $1::vector) AS similarity
                FROM semantic_cache
                WHERE room_id = $2
                  AND query_embedding IS NOT NULL
                  AND 1 - (query_embedding <=> $1::vector) >= $3
                ORDER BY query_embedding <=> $1::vector
                LIMIT $4
                """,
                emb_str,
                room_id,
                threshold,
                top_k,
            )

            return [
                {
                    "id": r["id"],
                    "query_text": r["query_text"],
                    "response": r["response"],
                    "metadata": json.loads(r["metadata"]) if r["metadata"] else {},
                    "similarity": float(r["similarity"]),
                    "hit_count": r["hit_count"],
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                    "last_accessed_at": r["last_accessed_at"].isoformat() if r["last_accessed_at"] else None,
                }
                for r in rows
            ]

    async def delete(self, cache_id: int) -> bool:
        """Delete a cache entry by ID."""
        pool = await db.get_pool()
        if not pool:
            return False
        async with pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM semantic_cache WHERE id = $1", cache_id
            )
            return result == "DELETE 1"

    async def clear(self, room_id: str) -> int:
        """Clear all cache entries for a room."""
        pool = await db.get_pool()
        if not pool:
            return 0
        async with pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM semantic_cache WHERE room_id = $1", room_id
            )
            # result is like "DELETE 5"
            return int(result.split()[-1])

    async def stats(self, room_id: Optional[str] = None) -> Dict[str, Any]:
        """Get cache statistics, optionally scoped to a room."""
        pool = await db.get_pool()
        if not pool:
            return {"total_entries": 0, "total_hits": 0, "avg_hits_per_entry": 0}

        async with pool.acquire() as conn:
            if room_id:
                row = await conn.fetchrow(
                    """
                    SELECT
                        COUNT(*) as total_entries,
                        COALESCE(SUM(hit_count), 0) as total_hits,
                        COALESCE(AVG(hit_count), 0) as avg_hits_per_entry,
                        MIN(created_at) as oldest_entry,
                        MAX(last_accessed_at) as most_recent_access
                    FROM semantic_cache
                    WHERE room_id = $1
                    """,
                    room_id,
                )
            else:
                row = await conn.fetchrow(
                    """
                    SELECT
                        COUNT(*) as total_entries,
                        COALESCE(SUM(hit_count), 0) as total_hits,
                        COALESCE(AVG(hit_count), 0) as avg_hits_per_entry,
                        MIN(created_at) as oldest_entry,
                        MAX(last_accessed_at) as most_recent_access
                    FROM semantic_cache
                    """
                )

            return {
                "total_entries": row["total_entries"],
                "total_hits": row["total_hits"],
                "avg_hits_per_entry": float(row["avg_hits_per_entry"]),
                "oldest_entry": row["oldest_entry"].isoformat() if row["oldest_entry"] else None,
                "most_recent_access": row["most_recent_access"].isoformat() if row["most_recent_access"] else None,
            }


# Module-level singleton
semantic_cache = SemanticCache()
