"""
Embedding generation using Databricks Foundation Model API.

Uses the Databricks SDK serving_endpoints.query() to generate
1024-dimensional embeddings via the BGE-large model.
"""

import asyncio
from functools import partial
from typing import List
from server.config import get_workspace_client

EMBEDDING_MODEL = "databricks-bge-large-en"


def _get_embedding_sync(text: str, model: str) -> List[float]:
    """Synchronous embedding call (runs in thread pool)."""
    w = get_workspace_client()
    response = w.serving_endpoints.query(name=model, input=text)
    return response.data[0].embedding


async def get_embedding(text: str, model: str = EMBEDDING_MODEL) -> List[float]:
    """Generate a vector embedding for the given text.

    Runs the SDK call in a thread pool to avoid blocking the async event loop.

    Args:
        text: Input text to embed.
        model: Databricks serving endpoint name for the embedding model.

    Returns:
        List of floats (1024 dimensions for BGE-large).
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_get_embedding_sync, text, model))
