"""Applies the SQL files in app/migrations once each, at startup, so schema updates ship with the code."""
import logging
from pathlib import Path

import psycopg

from .config import get_settings

log = logging.getLogger("trustai")
MIGRATIONS = Path(__file__).parent / "migrations"


async def run() -> None:
    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        return
    async with await psycopg.AsyncConnection.connect(get_settings().database_url, autocommit=True,
                                                     prepare_threshold=None, connect_timeout=15) as conn:
        await conn.execute("select pg_advisory_lock(7731001)")
        try:
            await conn.execute("create table if not exists schema_migrations "
                               "(name text primary key, applied_at timestamptz not null default now())")
            await conn.execute("alter table schema_migrations enable row level security")
            cur = await conn.execute("select name from schema_migrations")
            done = {r[0] for r in await cur.fetchall()}
            for f in files:
                if f.name in done:
                    continue
                log.info("Applying migration %s", f.name)
                async with conn.transaction():
                    await conn.execute(f.read_text())
                    await conn.execute("insert into schema_migrations (name) values (%s)", (f.name,))
        finally:
            await conn.execute("select pg_advisory_unlock(7731001)")
