from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .config import get_settings
from .routers import agents, demo, gateway, metrics, workspace


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.open_pool()
    yield
    await db.close_pool()


app = FastAPI(title="Plumb API", version="1.0.0", lifespan=lifespan)

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
    await db.fetchrow("select 1 as ok")
    return {"ok": True}
