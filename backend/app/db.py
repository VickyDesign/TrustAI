"""Thin async Postgres layer: a connection pool and three helpers that return dicts."""
from contextlib import asynccontextmanager
from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from .config import get_settings

_pool: AsyncConnectionPool | None = None


async def open_pool() -> None:
    global _pool
    if _pool is None:
        _pool = AsyncConnectionPool(
            get_settings().database_url,
            min_size=1,
            max_size=10,
            open=False,
            # Supabase's transaction pooler does not support prepared statements.
            kwargs={"row_factory": dict_row, "prepare_threshold": None},
        )
        await _pool.open()


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def connection():
    if _pool is None:
        await open_pool()
    assert _pool is not None
    async with _pool.connection() as conn:
        yield conn


async def fetch(sql: str, *args: Any) -> list[dict]:
    async with connection() as conn:
        cur = await conn.execute(sql, args)
        return await cur.fetchall() if cur.description else []


async def fetchrow(sql: str, *args: Any) -> dict | None:
    async with connection() as conn:
        cur = await conn.execute(sql, args)
        return await cur.fetchone() if cur.description else None


async def execute(sql: str, *args: Any) -> None:
    async with connection() as conn:
        await conn.execute(sql, args)


def jsonb(value: Any) -> Jsonb:
    return Jsonb(value)
