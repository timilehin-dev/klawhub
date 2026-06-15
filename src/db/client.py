"""
Asyncpg connection pool for KlawHub.

The pool is created once at process startup (via `init_db_pool()`)
and shared across all DB operations. This avoids the per-query TCP
connection overhead and prevents exhausting Supabase's connection limit.
"""
import asyncpg
import logging
from typing import Optional
from src.config import settings

logger = logging.getLogger(__name__)

# Module-level pool instance
_pool: Optional[asyncpg.Pool] = None


async def init_db_pool() -> asyncpg.Pool:
    """
    Create the asyncpg connection pool.
    Call this once during application startup (e.g., FastAPI lifespan handler).
    """
    global _pool
    if _pool is not None:
        return _pool

    _pool = await asyncpg.create_pool(
        dsn=settings.DATABASE_URL,
        min_size=2,
        max_size=10,
        command_timeout=30,
        max_inactive_connection_lifetime=300,
    )
    logger.info("asyncpg connection pool initialized (min=2, max=10)")
    return _pool


async def close_db_pool() -> None:
    """Gracefully close the pool on application shutdown."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        logger.info("asyncpg connection pool closed.")


def get_pool() -> asyncpg.Pool:
    """
    Returns the active pool. Raises if `init_db_pool()` was never called.
    """
    if _pool is None:
        raise RuntimeError(
            "DB pool is not initialized. Call `await init_db_pool()` at startup."
        )
    return _pool


async def ensure_pool() -> asyncpg.Pool:
    """
    Lazily initialize the pool if it has not been created yet.
    Safe to call multiple times — subsequent calls are no-ops.
    """
    global _pool
    if _pool is None:
        await init_db_pool()
    return _pool
