"""Agents: onboarding, connection tests, evaluations, approvals, and deployment."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from .. import db, evaluation, policy, questionnaire
from ..adapters import call_agent
from ..auth import Ctx, current_ctx
from ..common import clean, get_agent, log_activity, public_agent, unique_slug
from ..schemas import AgentIn, DecisionIn, DeployIn, InvokeIn, TestIn
from ..security import encrypt

router = APIRouter(prefix="/agents", tags=["agents"])

CONNECTION_FIELDS = {"protocol", "endpoint_url", "auth_type", "auth_header", "auth_secret",
                     "request_template", "response_key", "data_sources", "tools",
                     "policy_id", "questionnaire", "test_questions"}
LOCKED_STATUSES = {"awaiting_approval", "approved", "live", "paused"}
ROLE_LABEL = {"risk_owner": "Risk owner", "security": "Security", "admin": "Admin"}


@router.get("")
async def list_agents(ctx: Ctx = Depends(current_ctx)):
    rows = await db.fetch(
        """select a.*,
             coalesce(m.requests, 0) as requests_24h, m.success_rate, m.p95_ms
           from agents a
           left join lateral (
             select count(*) as requests,
                    round(100.0 * count(*) filter (where r.status = 'ok')
                          / nullif(count(*) filter (where r.status in ('ok', 'error')), 0), 2) as success_rate,
                    percentile_cont(0.95) within group (order by r.latency_ms) filter (where r.status <> 'blocked') as p95_ms
             from requests r where r.agent_id = a.id and r.started_at > now() - interval '24 hours'
           ) m on true
           where a.org_id = %s order by a.updated_at desc""",
        ctx.org_id,
    )
    out = []
    for r in rows:
        a = public_agent(r)
        a["metrics"] = clean({"requests_24h": r["requests_24h"], "success_rate": r["success_rate"],
                              "p95_ms": r["p95_ms"]})
        out.append(a)
    return out


@router.post("", status_code=201)
async def create_agent(body: AgentIn, ctx: Ctx = Depends(current_ctx)):
    name = body.name or "New agent"
    row = await db.fetchrow(
        """insert into agents (org_id, name, slug, owner_user_id, owner_name, created_by)
           values (%s, %s, %s, %s, %s, %s) returning id""",
        ctx.org_id, name, await unique_slug(ctx.org_id, name), ctx.user.id, ctx.user.name, ctx.user.id,
    )
    assert row
    agent_id = str(row["id"])
    await log_activity(ctx, agent_id, "created", f"Started onboarding {name}" if body.name else "Started onboarding")
    return await update_agent(agent_id, body, ctx)


@router.get("/{agent_id}")
async def read_agent(agent_id: str, ctx: Ctx = Depends(current_ctx)):
    return public_agent(await get_agent(ctx, agent_id))


@router.patch("/{agent_id}")
async def update_agent(agent_id: str, body: AgentIn, ctx: Ctx = Depends(current_ctx)):
    agent = await get_agent(ctx, agent_id)
    data = body.model_dump(exclude_unset=True)
    if agent["status"] in LOCKED_STATUSES and CONNECTION_FIELDS & set(data):
        raise HTTPException(409, "This agent is in release or live, so its connection, data, tools, policy and "
                                 "questions are locked.")
    if data.get("policy_id"):
        if not await db.fetchrow("select 1 from policies where id=%s and org_id=%s", data["policy_id"], ctx.org_id):
            raise HTTPException(404, "That policy doesn't exist in this workspace")
    sets, vals = [], []
    for key, value in data.items():
        if key == "auth_secret":
            if value:
                sets.append("auth_secret_enc = %s")
                vals.append(encrypt(value))
            continue
        if key == "policy_id" and not value:
            value = None
        if key in ("tools", "test_questions"):
            value = db.jsonb(value)
        if key == "questionnaire":
            value = db.jsonb(questionnaire.clean_answers(value))
        if key == "name" and value != agent["name"]:
            sets.append("slug = %s")
            vals.append(await unique_slug(ctx.org_id, value, agent_id))
        if key == "onboarding_step":
            value = max(value, agent["onboarding_step"])
        sets.append(f"{key} = %s")
        vals.append(value)
    if CONNECTION_FIELDS & set(data) and agent["status"] in ("evaluated", "blocked", "rejected"):
        sets.append("status = 'draft'")  # changed after evaluation: evaluate again
    if sets:
        await db.execute(f"update agents set {', '.join(sets)} where id = %s", *vals, agent_id)
    return public_agent(await get_agent(ctx, agent_id))


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(agent_id: str, ctx: Ctx = Depends(current_ctx)):
    agent = await get_agent(ctx, agent_id)
    if agent["status"] in ("live", "paused") and not ctx.is_admin:
        raise HTTPException(403, "Only an admin can delete a deployed agent")
    await db.execute("delete from agents where id = %s", agent_id)


# Connection test -----------------------------------------------------------------

@router.post("/{agent_id}/test")
async def test_connection(agent_id: str, body: TestIn, ctx: Ctx = Depends(current_ctx)):
    agent = await get_agent(ctx, agent_id)
    call = await call_agent(agent, body.message)
    timeout_ms = int(agent["timeout_s"]) * 1000
    auth_failed = call.http_status in (401, 403)
    reached = call.ok or call.http_status is not None
    checks = [
        {"label": "Endpoint reachable", "ok": reached},
        {"label": "Credentials accepted", "ok": reached and not auth_failed},
        {"label": f"Answer found{' at ' + agent['response_key'] if agent.get('response_key') else ''}", "ok": call.ok},
        {"label": f"Answered within the {agent['timeout_s']} s timeout", "ok": call.ok and call.latency_ms <= timeout_ms},
    ]
    result = {
        "ok": call.ok, "latency_ms": call.latency_ms, "http_status": call.http_status,
        "answer": (call.text or "")[:2000] if call.ok else None, "error": call.error,
        "checks": checks, "tested_at": datetime.now(timezone.utc).isoformat(), "message": body.message,
    }
    await db.execute("update agents set last_test = %s where id = %s", db.jsonb(result), agent_id)
    if call.ok:
        await log_activity(ctx, agent_id, "connection", f"Connection test passed in {call.latency_ms} ms")
    return result


# Evaluation ----------------------------------------------------------------------

@router.post("/{agent_id}/evaluations", status_code=202)
async def start_evaluation(agent_id: str, ctx: Ctx = Depends(current_ctx)):
    agent = await get_agent(ctx, agent_id)
    if agent["status"] == "evaluating":
        raise HTTPException(409, "An evaluation is already running")
    if agent["status"] in LOCKED_STATUSES:
        raise HTTPException(409, "Pause the agent before evaluating it again")
    if not (agent.get("last_test") or {}).get("ok"):
        raise HTTPException(400, "Run a successful connection test first")
    run_id = await evaluation.create_run(agent, ctx.user.id)
    await log_activity(ctx, agent_id, "evaluation", "Started an evaluation")
    evaluation.start_in_background(run_id, agent_id)
    return {"run_id": run_id}


@router.get("/{agent_id}/evaluations")
async def list_evaluations(agent_id: str, ctx: Ctx = Depends(current_ctx)):
    await get_agent(ctx, agent_id)
    return clean(await db.fetch(
        "select * from evaluation_runs where agent_id = %s order by created_at desc limit 20", agent_id))


@router.get("/{agent_id}/evaluations/latest")
async def latest_evaluation(agent_id: str, ctx: Ctx = Depends(current_ctx)):
    await get_agent(ctx, agent_id)
    run = await db.fetchrow(
        "select * from evaluation_runs where agent_id = %s order by created_at desc limit 1", agent_id)
    if not run:
        return None
    return await _run_detail(run)


async def _run_detail(run: dict) -> dict:
    results = await db.fetch("select * from evaluation_results where run_id = %s order by position", run["id"])
    out = clean(run)
    out["results"] = clean(results)
    return out


# Approvals -----------------------------------------------------------------------

@router.get("/{agent_id}/approvals")
async def list_approvals(agent_id: str, ctx: Ctx = Depends(current_ctx)):
    await get_agent(ctx, agent_id)
    rows = await db.fetch(
        """select a.*, coalesce(m.display_name, m.email) as requested_by_name
           from approvals a left join members m on m.user_id = a.requested_by and m.org_id = a.org_id
           where a.agent_id = %s order by a.requested_at desc""",
        agent_id,
    )
    approvers = await db.fetch(
        "select user_id, coalesce(display_name, email) as name, role from members where org_id = %s and role in ('admin','risk_owner','security')",
        ctx.org_id,
    )
    return clean({"approvals": rows, "approvers": approvers})


@router.post("/{agent_id}/approvals", status_code=201)
async def request_approval(agent_id: str, ctx: Ctx = Depends(current_ctx)):
    agent = await get_agent(ctx, agent_id)
    if agent["status"] not in ("evaluated", "rejected"):
        raise HTTPException(409, "The agent needs a passing evaluation before it can be approved")
    roles = policy.approvals_for((await policy.for_agent(agent))["rules"], agent["risk_tier"])
    await db.execute("delete from approvals where agent_id = %s and status = 'pending'", agent_id)
    if not roles:
        await db.execute("update agents set status = 'approved', onboarding_step = 5 where id = %s", agent_id)
        await log_activity(ctx, agent_id, "approval", "Tier 1 agent, approved by policy")
    else:
        for role in roles:
            await db.execute(
                "insert into approvals (org_id, agent_id, required_role, requested_by) values (%s,%s,%s,%s)",
                ctx.org_id, agent_id, role, ctx.user.id,
            )
        await db.execute("update agents set status = 'awaiting_approval', onboarding_step = 5 where id = %s", agent_id)
        await log_activity(ctx, agent_id, "approval",
                           f"Requested approval from {' and '.join(ROLE_LABEL[r].lower() for r in roles)}")
    return await list_approvals(agent_id, ctx)


approvals_router = APIRouter(prefix="/approvals", tags=["approvals"])


@approvals_router.get("/inbox")
async def approval_inbox(ctx: Ctx = Depends(current_ctx)):
    rows = await db.fetch(
        """select ap.*, ag.name as agent_name, ag.risk_tier from approvals ap
           join agents ag on ag.id = ap.agent_id
           where ap.org_id = %s and ap.status = 'pending' order by ap.requested_at""",
        ctx.org_id,
    )
    return clean([r for r in rows if ctx.has_role(r["required_role"])])


@approvals_router.post("/{approval_id}/decision")
async def decide(approval_id: str, body: DecisionIn, ctx: Ctx = Depends(current_ctx)):
    ap = await db.fetchrow("select * from approvals where id = %s and org_id = %s", approval_id, ctx.org_id)
    if not ap:
        raise HTTPException(404, "Approval not found")
    if ap["status"] != "pending":
        raise HTTPException(409, "This approval has already been decided")
    if not ctx.has_role(ap["required_role"]):
        raise HTTPException(403, f"Only a {ROLE_LABEL[ap['required_role']].lower()} or an admin can decide this")
    org = await db.fetchrow("select settings from organizations where id = %s", ctx.org_id)
    if str(ap["requested_by"]) == ctx.user.id and not (org or {}).get("settings", {}).get("allow_self_approval", True):
        raise HTTPException(403, "You can't approve a release you requested")
    await db.execute(
        "update approvals set status=%s, decided_by=%s, decided_by_name=%s, comment=%s, decided_at=now() where id=%s",
        body.decision, ctx.user.id, ctx.user.name, body.comment, approval_id,
    )
    agent_id = str(ap["agent_id"])
    if body.decision == "rejected":
        await db.execute("update agents set status = 'rejected' where id = %s", agent_id)
    else:
        pending = await db.fetchrow(
            "select count(*) as n from approvals where agent_id=%s and status='pending'", agent_id)
        if pending and pending["n"] == 0:
            await db.execute("update agents set status = 'approved' where id = %s and status = 'awaiting_approval'", agent_id)
    verb = "Approved" if body.decision == "approved" else "Rejected"
    await log_activity(ctx, agent_id, "approval", f"{verb} as {ROLE_LABEL[ap['required_role']].lower()}",
                       {"comment": body.comment})
    return clean(await db.fetchrow("select * from approvals where id = %s", approval_id))


# Deployment ----------------------------------------------------------------------

@router.post("/{agent_id}/deploy")
async def deploy(agent_id: str, body: DeployIn, ctx: Ctx = Depends(current_ctx)):
    agent = await get_agent(ctx, agent_id)
    if agent["status"] != "approved":
        raise HTTPException(409, "The agent needs every required approval before it can be deployed")
    await db.execute("update deployments set status='superseded' where agent_id=%s and status='active'", agent_id)
    dep = await db.fetchrow(
        """insert into deployments (org_id, agent_id, version, rollout, auto_rollback, alert_channel, created_by)
           values (%s,%s,%s,%s,%s,%s,%s) returning id, created_at""",
        ctx.org_id, agent_id, agent["version"], body.rollout, body.auto_rollback, body.alert_channel, ctx.user.id,
    )
    assert dep
    rollout = {"mode": body.rollout, "auto_rollback": body.auto_rollback, "alert_channel": body.alert_channel,
               "deployment_id": str(dep["id"]), "started_at": dep["created_at"].isoformat()}
    await db.execute("update agents set status='live', deployed_at=now(), rollout=%s where id=%s",
                     db.jsonb(rollout), agent_id)
    await log_activity(ctx, agent_id, "deploy",
                       f"Deployed {agent['version']} to Production, {'gradual rollout' if body.rollout == 'gradual' else 'all traffic'}")
    return public_agent(await get_agent(ctx, agent_id))


@router.post("/{agent_id}/try")
async def try_agent(agent_id: str, body: InvokeIn, ctx: Ctx = Depends(current_ctx)):
    """Send one message through the gateway from the console, without a gateway key."""
    from .gateway import run_through_gateway
    agent = await get_agent(ctx, agent_id)
    try:
        return await run_through_gateway(agent, body)
    except HTTPException as e:
        if e.status_code == 502 and isinstance(e.detail, dict):
            return {"request_id": e.detail.get("request_id"), "output": None, "blocked": False,
                    "error": e.detail.get("error"), "guardrails": [], "latency_ms": None}
        raise


@router.post("/{agent_id}/pause")
async def pause(agent_id: str, ctx: Ctx = Depends(current_ctx)):
    agent = await get_agent(ctx, agent_id)
    if agent["status"] != "live":
        raise HTTPException(409, "Only a live agent can be paused")
    await db.execute("update agents set status='paused' where id=%s", agent_id)
    await log_activity(ctx, agent_id, "pause", "Paused traffic")
    return public_agent(await get_agent(ctx, agent_id))


@router.post("/{agent_id}/resume")
async def resume(agent_id: str, ctx: Ctx = Depends(current_ctx)):
    agent = await get_agent(ctx, agent_id)
    if agent["status"] != "paused":
        raise HTTPException(409, "Only a paused agent can be resumed")
    await db.execute("update agents set status='live' where id=%s", agent_id)
    await log_activity(ctx, agent_id, "resume", "Resumed traffic")
    return public_agent(await get_agent(ctx, agent_id))


@router.get("/{agent_id}/activity")
async def activity(agent_id: str, ctx: Ctx = Depends(current_ctx)):
    await get_agent(ctx, agent_id)
    return clean(await db.fetch(
        "select * from activity where agent_id = %s order by created_at desc limit 100", agent_id))


evaluations_router = APIRouter(prefix="/evaluations", tags=["evaluations"])


@evaluations_router.get("/{run_id}")
async def read_run(run_id: str, ctx: Ctx = Depends(current_ctx)):
    run = await db.fetchrow("select * from evaluation_runs where id = %s and org_id = %s", run_id, ctx.org_id)
    if not run:
        raise HTTPException(404, "Evaluation not found")
    return await _run_detail(run)


@evaluations_router.get("/{run_id}/cases")
async def read_cases(run_id: str, suite: str | None = None, ctx: Ctx = Depends(current_ctx)):
    run = await db.fetchrow("select id from evaluation_runs where id = %s and org_id = %s", run_id, ctx.org_id)
    if not run:
        raise HTTPException(404, "Evaluation not found")
    if suite:
        rows = await db.fetch("select * from evaluation_cases where run_id=%s and suite=%s order by created_at", run_id, suite)
    else:
        rows = await db.fetch("select * from evaluation_cases where run_id=%s order by created_at", run_id)
    return clean(rows)
