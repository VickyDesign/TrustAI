import asyncio
import logging
from contextlib import asynccontextmanager

import psycopg
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .config import get_settings
from .routers import agents, demo, gateway, metrics, workspace


log = logging.getLogger("plumb")
_db_status: dict = {"ok": False, "database": "checking…"}


def _hint(msg: str) -> str:
    m = msg.lower()
    url = get_settings().database_url
    if ".supabase.co" in url and "pooler" not in url:
        return "This is Supabase's Direct connection, which Render can't reach. Use the Session pooler address instead."
    if "[your-password]" in url.lower():
        return "Replace [YOUR-PASSWORD] in DATABASE_URL with your database password, without the square brackets."
    if "password authentication failed" in m:
        return "The database password in DATABASE_URL is wrong. Reset it in Supabase (Database settings) and update DATABASE_URL."
    if "tenant or user not found" in m:
        return "The user name in DATABASE_URL doesn't match the project. Copy the Session pooler address again from Supabase."
    if "[your-password]" in m or "]@" in m or "resolve host" in m and "@" in m:
        return "The password part of DATABASE_URL is malformed. Paste the password again, without square brackets."
    if "translate host" in m or "name or service not known" in m or "nodename" in m:
        return "The server address in DATABASE_URL has a typo. Copy the Session pooler address again from Supabase."
    if "does not exist" in m and "relation" in m:
        return "Connected, but the tables are missing. Run the setup script in Supabase's SQL Editor."
    return "Check DATABASE_URL in Render: use the Session pooler address with your real database password."


async def _check_database() -> None:
    """Probe the database in the background so /health can answer instantly."""
    global _db_status
    while True:
        try:
            conn = await psycopg.AsyncConnection.connect(get_settings().database_url, connect_timeout=10,
                                                         prepare_threshold=None)
            async with conn:
                await conn.execute("select 1 from organizations limit 1")
            if not _db_status.get("ok"):
                log.info("Database connected")
            _db_status = {"ok": True, "database": "connected"}
            delay = 300
        except Exception as e:  # noqa: BLE001
            msg = (str(e).strip().splitlines() or [type(e).__name__])[0][:300]
            _db_status = {"ok": False, "database": f"not connected: {msg}", "hint": _hint(msg)}
            log.error("Database check failed: %s | %s", msg, _db_status["hint"])
            delay = 20
        await asyncio.sleep(delay)


@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.basicConfig(level=logging.INFO)
    await db.open_pool()
    checker = asyncio.create_task(_check_database())
    yield
    checker.cancel()
    await db.close_pool()


app = FastAPI(title="Trust AI API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_origin_regex=get_settings().cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(workspace.router)
app.include_router(agents.router)
app.include_router(agents.approvals_router)
app.include_router(agents.evaluations_router)
app.include_router(metrics.router)
app.include_router(gateway.router)
app.include_router(demo.router)


@app.get("/health", tags=["health"])
async def health():
    """Answers instantly so the service can go live, and says whether the database is reachable."""
    return _db_status
