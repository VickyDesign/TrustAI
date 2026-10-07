"""Policies: reusable guardrails, evaluation pass marks and approval rules, plus the risk questionnaire."""
from fastapi import APIRouter, Depends, HTTPException

from .. import db, policy, questionnaire
from ..auth import Ctx, current_ctx
from ..common import clean, log_activity
from ..schemas import PolicyIn

router = APIRouter(tags=["policies"])


def _admin(ctx: Ctx) -> None:
    if not ctx.is_admin:
        raise HTTPException(403, "Only an admin can change policies")


async def _get(ctx: Ctx, policy_id: str) -> dict:
    try:
        row = await db.fetchrow("select * from policies where id=%s and org_id=%s", policy_id, ctx.org_id)
    except Exception:  # noqa: BLE001  (malformed uuid)
        row = None
    if not row:
        raise HTTPException(404, "Policy not found")
    return row


async def _with_usage(ctx: Ctx, rows: list[dict]) -> list[dict]:
    counts = {str(r["policy_id"]): r["n"] for r in await db.fetch(
        "select policy_id, count(*) as n from agents where org_id=%s group by policy_id", ctx.org_id)}
    out = []
    for r in rows:
        n = counts.get(str(r["id"]), 0) + (counts.get("None", 0) if r["is_default"] else 0)
        out.append({**clean(r), "rules": policy.normalize(r.get("rules")), "agent_count": n})
    return out


@router.get("/policies")
async def list_policies(ctx: Ctx = Depends(current_ctx)):
    await policy.ensure_default(ctx.org_id)
    rows = await db.fetch("select * from policies where org_id=%s order by is_default desc, name", ctx.org_id)
    return await _with_usage(ctx, rows)


@router.get("/policies/{policy_id}")
async def read_policy(policy_id: str, ctx: Ctx = Depends(current_ctx)):
    return (await _with_usage(ctx, [await _get(ctx, policy_id)]))[0]


@router.post("/policies", status_code=201)
async def create_policy(body: PolicyIn, ctx: Ctx = Depends(current_ctx)):
    _admin(ctx)
    if not body.name:
        raise HTTPException(422, "Give the policy a name")
    await policy.ensure_default(ctx.org_id)
    row = await db.fetchrow(
        "insert into policies (org_id, name, description, rules, created_by) values (%s,%s,%s,%s,%s) returning *",
        ctx.org_id, body.name.strip(), (body.description or "").strip() or None,
        db.jsonb(policy.normalize(body.rules)), ctx.user.id)
    assert row
    await log_activity(ctx, None, "policy", f"Created the policy {row['name']}")
    return (await _with_usage(ctx, [row]))[0]


@router.patch("/policies/{policy_id}")
async def update_policy(policy_id: str, body: PolicyIn, ctx: Ctx = Depends(current_ctx)):
    _admin(ctx)
    row = await _get(ctx, policy_id)
    data = body.model_dump(exclude_unset=True)
    sets, vals = [], []
    if "name" in data and data["name"]:
        sets.append("name=%s"); vals.append(data["name"].strip())
    if "description" in data:
        sets.append("description=%s"); vals.append((data["description"] or "").strip() or None)
    if "rules" in data and data["rules"] is not None:
        sets.append("rules=%s"); vals.append(db.jsonb(policy.normalize(data["rules"])))
    if sets:
        await db.execute(f"update policies set {', '.join(sets)}, updated_at=now() where id=%s", *vals, policy_id)
        await log_activity(ctx, None, "policy", f"Updated the policy {data.get('name') or row['name']}")
    return await read_policy(policy_id, ctx)


@router.post("/policies/{policy_id}/default")
async def make_default(policy_id: str, ctx: Ctx = Depends(current_ctx)):
    _admin(ctx)
    await _get(ctx, policy_id)
    await db.execute("update policies set is_default = (id = %s) where org_id=%s", policy_id, ctx.org_id)
    return await list_policies(ctx)


@router.delete("/policies/{policy_id}", status_code=204)
async def delete_policy(policy_id: str, ctx: Ctx = Depends(current_ctx)):
    _admin(ctx)
    row = await _get(ctx, policy_id)
    if row["is_default"]:
        raise HTTPException(409, "Make another policy the default before deleting this one")
    await db.execute("delete from policies where id=%s", policy_id)  # agents fall back to the default
    await log_activity(ctx, None, "policy", f"Deleted the policy {row['name']}")


@router.get("/questionnaire")
async def risk_questionnaire(ctx: Ctx = Depends(current_ctx)):
    return questionnaire.QUESTIONS
