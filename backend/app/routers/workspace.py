"""The signed-in user, their workspace, members and roles, and gateway keys."""
import secrets

from fastapi import APIRouter, Depends, HTTPException

from .. import db
from ..auth import Ctx, User, current_ctx, current_user
from ..common import clean
from ..config import get_settings
from ..schemas import JoinIn, KeyIn, OrgIn, RoleIn
from ..security import new_gateway_key

router = APIRouter(tags=["workspace"])


@router.get("/me")
async def me(ctx: Ctx = Depends(current_ctx)):
    org = await db.fetchrow("select id, name, settings from organizations where id = %s", ctx.org_id)
    s = get_settings()
    if org and not ctx.is_admin:
        org = {**org, "settings": {k: v for k, v in (org["settings"] or {}).items() if k != "join_code"}}
    return clean({
        "user": {"id": ctx.user.id, "email": ctx.user.email, "name": ctx.user.name},
        "org": org, "role": ctx.role,
        "gateway_url": s.api_base_url + "/v1/agents",
        "llm_enabled": s.llm_enabled,
    })


@router.patch("/org")
async def update_org(body: OrgIn, ctx: Ctx = Depends(current_ctx)):
    if not ctx.is_admin:
        raise HTTPException(403, "Only an admin can change workspace settings")
    if body.name:
        await db.execute("update organizations set name=%s where id=%s", body.name, ctx.org_id)
    if body.allow_self_approval is not None:
        await db.execute(
            "update organizations set settings = settings || jsonb_build_object('allow_self_approval', %s::boolean) where id=%s",
            body.allow_self_approval, ctx.org_id)
    return await me(ctx)


@router.get("/members")
async def members(ctx: Ctx = Depends(current_ctx)):
    rows = await db.fetch(
        "select user_id, email, display_name, role, created_at from members where org_id=%s order by created_at",
        ctx.org_id)
    return clean(rows)


@router.patch("/members/{user_id}")
async def set_role(user_id: str, body: RoleIn, ctx: Ctx = Depends(current_ctx)):
    if not ctx.is_admin:
        raise HTTPException(403, "Only an admin can change roles")
    if user_id == ctx.user.id and body.role != "admin":
        admins = await db.fetchrow("select count(*) as n from members where org_id=%s and role='admin'", ctx.org_id)
        if admins and admins["n"] <= 1:
            raise HTTPException(409, "Make someone else an admin first")
    await db.execute("update members set role=%s where org_id=%s and user_id=%s", body.role, ctx.org_id, user_id)
    return await members(ctx)


@router.post("/invite-code")
async def invite_code(ctx: Ctx = Depends(current_ctx)):
    """Create (or rotate) the code teammates enter to join this workspace."""
    if not ctx.is_admin:
        raise HTTPException(403, "Only an admin can invite people")
    code = secrets.token_urlsafe(9)
    await db.execute(
        "update organizations set settings = settings || jsonb_build_object('join_code', %s::text) where id=%s",
        code, ctx.org_id)
    return {"code": code}


@router.post("/join")
async def join(body: JoinIn, user: User = Depends(current_user)):
    org = await db.fetchrow("select id, name from organizations where settings->>'join_code' = %s", body.code)
    if not org:
        raise HTTPException(404, "That invite code isn't valid. Ask your admin for a new one.")
    # Remove the empty workspace created automatically at first sign-in.
    own = await db.fetch(
        """select o.id from organizations o join members m on m.org_id = o.id
           where m.user_id = %s and o.id <> %s
             and (select count(*) from members x where x.org_id = o.id) = 1
             and not exists (select 1 from agents a where a.org_id = o.id)""",
        user.id, org["id"])
    for o in own:
        await db.execute("delete from organizations where id = %s", o["id"])
    await db.execute(
        """insert into members (org_id, user_id, email, display_name, role) values (%s,%s,%s,%s,'member')
           on conflict (org_id, user_id) do nothing""",
        org["id"], user.id, user.email, user.name)
    return clean({"org": org})


@router.get("/keys")
async def list_keys(ctx: Ctx = Depends(current_ctx)):
    return clean(await db.fetch(
        "select id, name, prefix, created_at, last_used_at, revoked_at from gateway_keys where org_id=%s order by created_at desc",
        ctx.org_id))


@router.post("/keys", status_code=201)
async def create_key(body: KeyIn, ctx: Ctx = Depends(current_ctx)):
    if not ctx.is_admin:
        raise HTTPException(403, "Only an admin can create gateway keys")
    raw, prefix, hashed = new_gateway_key()
    row = await db.fetchrow(
        "insert into gateway_keys (org_id, name, prefix, key_hash, created_by) values (%s,%s,%s,%s,%s) returning id, name, prefix, created_at",
        ctx.org_id, body.name, prefix, hashed, ctx.user.id)
    out = clean(row)
    out["key"] = raw  # shown once
    return out


@router.delete("/keys/{key_id}", status_code=204)
async def revoke_key(key_id: str, ctx: Ctx = Depends(current_ctx)):
    if not ctx.is_admin:
        raise HTTPException(403, "Only an admin can revoke gateway keys")
    await db.execute("update gateway_keys set revoked_at=now() where id=%s and org_id=%s", key_id, ctx.org_id)
