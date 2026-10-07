"""Monitoring built from the requests that pass through the gateway."""
from fastapi import APIRouter, Depends, HTTPException, Query

from .. import db
from ..auth import Ctx, current_ctx
from ..common import clean, get_agent

router = APIRouter(tags=["metrics"])

RANGES = {"1h": ("1 hour", "2 minutes", 30), "24h": ("24 hours", "15 minutes", 96), "7d": ("7 days", "2 hours", 84),
          "30d": ("30 days", "8 hours", 90)}


def _range(r: str) -> tuple[str, str, int]:
    if r not in RANGES:
        raise HTTPException(400, "Range must be one of 1h, 24h, 7d, 30d")
    return RANGES[r]


async def _series(where: str, args: tuple, span: str, bucket: str) -> list[dict]:
    rows = await db.fetch(
        f"""with b as (
              select generate_series(date_bin(%s::interval, now() - %s::interval, 'epoch'),
                                     date_bin(%s::interval, now(), 'epoch'), %s::interval) as t
            )
            select b.t,
                   count(r.id) as requests,
                   count(r.id) filter (where r.status = 'error') as errors,
                   count(r.id) filter (where r.status = 'blocked') as blocked,
                   percentile_cont(0.5) within group (order by r.latency_ms) filter (where r.status <> 'blocked') as p50,
                   percentile_cont(0.95) within group (order by r.latency_ms) filter (where r.status <> 'blocked') as p95
            from b left join requests r
              on date_bin(%s::interval, r.started_at, 'epoch') = b.t and {where}
            group by b.t order by b.t""",
        bucket, span, bucket, bucket, bucket, *args,
    )
    return clean(rows)


async def _kpis(where: str, args: tuple, span: str) -> dict:
    row = await db.fetchrow(
        f"""select count(*) as requests,
                   count(*) filter (where status='ok') as ok,
                   count(*) filter (where status='error') as errors,
                   count(*) filter (where status='blocked') as blocked,
                   percentile_cont(0.5) within group (order by latency_ms) filter (where status <> 'blocked') as p50,
                   percentile_cont(0.95) within group (order by latency_ms) filter (where status <> 'blocked') as p95,
                   coalesce(sum(jsonb_array_length(guardrail_actions)), 0) as guardrail_actions,
                   count(distinct session_id) as sessions
            from requests r where {where} and started_at > now() - %s::interval""",
        *args, span,
    )
    row = clean(row or {})
    total = row.get("requests") or 0
    answered = total - (row.get("blocked") or 0)  # guardrail blocks are intended, not agent failures
    row["success_rate"] = round(100 * (row.get("ok") or 0) / answered, 2) if answered else None
    return row


@router.get("/agents/{agent_id}/metrics")
async def agent_metrics(agent_id: str, range: str = Query("24h"), ctx: Ctx = Depends(current_ctx)):
    await get_agent(ctx, agent_id)
    span, bucket, _ = _range(range)
    where, args = "r.agent_id = %s", (agent_id,)
    kpis = await _kpis(where, args, span)
    series = await _series(where, args, span, bucket)
    guard = await db.fetch(
        """select a->>'type' as type, a->>'kind' as kind, count(*) as n
           from requests r, jsonb_array_elements(r.guardrail_actions) a
           where r.agent_id = %s and r.started_at > now() - %s::interval group by 1, 2 order by n desc""",
        agent_id, span)
    return clean({"range": range, "kpis": kpis, "series": series, "guardrails": guard})


@router.get("/agents/{agent_id}/requests")
async def agent_requests(agent_id: str, limit: int = Query(20, le=100), ctx: Ctx = Depends(current_ctx)):
    await get_agent(ctx, agent_id)
    return clean(await db.fetch(
        """select id, started_at, latency_ms, status, http_status, error, input_preview, output_preview,
                  guardrail_actions, session_id
           from requests where agent_id=%s order by started_at desc limit %s""", agent_id, limit))


@router.get("/requests/{request_id}")
async def request_trace(request_id: str, ctx: Ctx = Depends(current_ctx)):
    req = await db.fetchrow("select * from requests where id=%s and org_id=%s", request_id, ctx.org_id)
    if not req:
        raise HTTPException(404, "Request not found")
    spans = await db.fetch("select * from spans where request_id=%s order by start_ms, name", request_id)
    out = clean(req)
    out["spans"] = clean(spans)
    return out


@router.get("/overview")
async def overview(range: str = Query("24h"), ctx: Ctx = Depends(current_ctx)):
    span, bucket, _ = _range(range)
    where, args = "r.org_id = %s", (ctx.org_id,)
    kpis = await _kpis(where, args, span)
    series = await _series(where, args, span, bucket)
    counts = await db.fetch("select status, count(*) as n from agents where org_id=%s group by status", ctx.org_id)
    health = await db.fetch(
        """select a.id, a.name, a.slug, a.protocol, a.team, a.owner_name, a.risk_tier, a.status,
                  count(r.id) as requests,
                  round(100.0 * count(*) filter (where r.status='ok') / nullif(count(*) filter (where r.status in ('ok','error')), 0), 2) as success_rate,
                  percentile_cont(0.95) within group (order by r.latency_ms) filter (where r.status <> 'blocked') as p95
           from agents a left join requests r on r.agent_id = a.id and r.started_at > now() - %s::interval
           where a.org_id = %s and a.status in ('live','paused')
           group by a.id order by count(r.id) desc""",
        span, ctx.org_id)
    attention = []
    for a in clean(health):
        if a["requests"] and a["success_rate"] is not None and a["success_rate"] < 98:
            attention.append({"kind": "objective", "agent_id": a["id"], "agent_name": a["name"],
                              "title": f"{a['name']} is below its success objective",
                              "detail": f"{a['success_rate']}% success against 98%"})
    for ap in clean(await db.fetch(
            """select ag.id, ag.name, ap.required_role, ap.requested_at from approvals ap join agents ag on ag.id = ap.agent_id
               where ap.org_id=%s and ap.status='pending' order by ap.requested_at""", ctx.org_id)):
        attention.append({"kind": "approval", "agent_id": ap["id"], "agent_name": ap["name"],
                          "title": f"{ap['name']} is waiting for approval",
                          "detail": f"Needs {ap['required_role'].replace('_', ' ')} sign-off", "at": ap["requested_at"]})
    for b in clean(await db.fetch("select id, name from agents where org_id=%s and status='blocked'", ctx.org_id)):
        attention.append({"kind": "blocked", "agent_id": b["id"], "agent_name": b["name"],
                          "title": f"{b['name']} failed evaluation", "detail": "Fix the agent and evaluate again"})
    return clean({"range": range, "kpis": kpis, "series": series,
                  "agent_counts": {c["status"]: c["n"] for c in counts},
                  "live_agents": health, "attention": attention})
