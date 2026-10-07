"""Helpers shared by routers: loading agents within the caller's workspace, serialization, activity."""
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from . import db
from .auth import Ctx
from .security import decrypt, mask

PUBLIC_AGENT_FIELDS = [
    "id", "org_id", "name", "slug", "team", "purpose", "audience", "owner_user_id", "owner_name",
    "protocol", "endpoint_url", "auth_type", "auth_header", "request_template", "response_key",
    "timeout_s", "max_retries", "data_sources", "tools", "status", "onboarding_step", "risk_tier",
    "risk_assessment", "last_test", "version", "rollout", "deployed_at", "created_at", "updated_at",
]


def clean(value: Any) -> Any:
    """Make DB values JSON friendly."""
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value]
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def public_agent(row: dict) -> dict:
    out = {k: row.get(k) for k in PUBLIC_AGENT_FIELDS}
    out["auth_secret_hint"] = mask(decrypt(row.get("auth_secret_enc"))) if row.get("auth_type") != "oauth2" else (
        "Client credentials saved" if row.get("auth_secret_enc") else None)
    return clean(out)


async def get_agent(ctx: Ctx, agent_id: str) -> dict:
    try:
        UUID(agent_id)
    except ValueError:
        raise HTTPException(404, "Agent not found")
    row = await db.fetchrow("select * from agents where id = %s and org_id = %s", agent_id, ctx.org_id)
    if not row:
        raise HTTPException(404, "Agent not found")
    return row


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s[:48] or "agent"


async def unique_slug(org_id: str, name: str, exclude_id: str | None = None) -> str:
    base = slugify(name)
    slug, n = base, 2
    while await db.fetchrow("select 1 from agents where org_id=%s and slug=%s and id is distinct from %s",
                            org_id, slug, exclude_id):
        slug = f"{base}-{n}"
        n += 1
    return slug


async def log_activity(ctx: Ctx, agent_id: str | None, kind: str, message: str, data: dict | None = None) -> None:
    await db.execute(
        "insert into activity (org_id, agent_id, actor_id, actor_name, kind, message, data) values (%s,%s,%s,%s,%s,%s,%s)",
        ctx.org_id, agent_id, ctx.user.id, ctx.user.name, kind, message, db.jsonb(data or {}),
    )
