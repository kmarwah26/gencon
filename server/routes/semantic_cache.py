"""API routes for the semantic cache feature."""

from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.semantic_cache.cache import semantic_cache
from server.semantic_cache.setup import ensure_semantic_cache_table

router = APIRouter(tags=["semantic_cache"])


class CacheSetRequest(BaseModel):
    room_id: str
    query: str
    response: str
    metadata: Optional[dict] = None


class CacheLookupRequest(BaseModel):
    room_id: str
    query: str


class CacheSearchRequest(BaseModel):
    room_id: str
    query: str
    top_k: int = 5
    min_similarity: Optional[float] = None


@router.post("/semantic-cache/set")
async def cache_set(req: CacheSetRequest):
    """Add a query/response pair to the semantic cache."""
    cache_id = await semantic_cache.set(
        room_id=req.room_id,
        query=req.query,
        response=req.response,
        metadata=req.metadata,
    )
    if cache_id is None:
        raise HTTPException(status_code=503, detail="Database not available")
    return {"id": cache_id, "cached": True}


@router.post("/semantic-cache/lookup")
async def cache_lookup(req: CacheLookupRequest):
    """Look up a semantically similar cached response."""
    result = await semantic_cache.get(
        room_id=req.room_id,
        query=req.query,
        return_metadata=True,
    )
    if result is None:
        return {"hit": False, "response": None, "similarity": 0, "metadata": {}}

    response, similarity, metadata = result
    return {
        "hit": True,
        "response": response,
        "similarity": round(similarity, 4),
        "metadata": metadata,
    }


@router.post("/semantic-cache/search")
async def cache_search(req: CacheSearchRequest):
    """Search for similar cached queries."""
    results = await semantic_cache.search(
        room_id=req.room_id,
        query=req.query,
        top_k=req.top_k,
        min_similarity=req.min_similarity,
    )
    return {"results": results}


@router.get("/semantic-cache/stats")
async def cache_stats(room_id: Optional[str] = None):
    """Get cache statistics."""
    stats = await semantic_cache.stats(room_id=room_id)
    return stats


@router.delete("/semantic-cache/{cache_id}")
async def cache_delete(cache_id: int):
    """Delete a specific cache entry."""
    deleted = await semantic_cache.delete(cache_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Cache entry not found")
    return {"deleted": True}


@router.delete("/semantic-cache/room/{room_id}")
async def cache_clear_room(room_id: str):
    """Clear all cache entries for a room."""
    count = await semantic_cache.clear(room_id)
    return {"cleared": count}


@router.post("/semantic-cache/init")
async def cache_init():
    """Initialize the semantic cache table (pgvector + schema)."""
    ready = await ensure_semantic_cache_table()
    return {"ready": ready}
