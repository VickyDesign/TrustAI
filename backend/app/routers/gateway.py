"""The gateway that live traffic goes through. It applies guardrails, calls the agent, and records a trace."""
import time

from fastapi import APIRouter, Header, HTTPException

from .. import db, guardrails, policy
from ..adapters import call_agent
from ..schemas import InvokeIn
from ..security import hash_key

router = APIRouter(prefix="/v1/agents", tags=["gateway"])


async def _record(agent: dict, session_id: str | None, status: str, latency: int, http_status: int | None,
                  error: str | None, inp: str, out: str | None, actions: list, spans: list[dict]) -> str:
    deployment_id = (agent.get("rollout") or {}).get("deployment_id")
    row = await db.fetchrow(
        """insert into requests (org_id, agent_id, deployment_id, session_id, latency_ms, status, http_status, error,
             input_preview, output_preview, guardrail_actions)
           values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
        agent["org_id"], agent["id"], deployment_id, session_id, latency, status, http_status, error,
        inp[:500], (out or "")[:500] or None, db.jsonb(actions),
    )
    assert row
    for s in spans:
        await db.execute(
            "insert into spans (request_id, name, kind, start_ms, duration_ms, attributes) values (%s,%s,%s,%s,%s,%s)",
            row["id"], s["name"], s["kind"], s["start_ms"], s["duration_ms"], db.jsonb(s.get("attributes", {})),
        )
    return str(row["id"])


@router.post("/{slug}/invoke")
async def invoke(slug: str, body: InvokeIn, authorization: str = Header(default="")):
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Send a gateway key as: Authorization: Bearer trustai_...")
    key = await db.fetchrow(
        "select id, org_id from gateway_keys where key_hash=%s and revoked_at is null",
        hash_key(authorization.split(" ", 1)[1].strip()))
    if not key:
        raise HTTPException(401, "Invalid or revoked gateway key")
    await db.execute("update gateway_keys set last_used_at=now() where id=%s", key["id"])
    agent = await db.fetchrow("select * from agents where org_id=%s and slug=%s", key["org_id"], slug)
    if not agent:
        raise HTTPException(404, f"No agent at /{slug}")
    return await run_through_gateway(agent, body)


async def run_through_gateway(agent: dict, body: InvokeIn) -> dict:
    """Apply input guardrails, call the agent, apply output guardrails, and record the trace."""
    if agent["status"] == "paused":
        raise HTTPException(503, "This agent is paused")
    if agent["status"] != "live":
        raise HTTPException(409, "This agent isn't deployed yet")

    rules = (await policy.for_agent(agent))["rules"]
    t0 = time.perf_counter()
    ms = lambda: int((time.perf_counter() - t0) * 1000)  # noqa: E731
    spans: list[dict] = []

    g_in = guardrails.check_input(body.input, rules)
    spans.append({"name": "guardrail.input", "kind": "guardrail", "start_ms": 0, "duration_ms": max(ms(), 1),
                  "attributes": {"actions": g_in.actions}})
    if g_in.blocked:
        total = ms()
        spans.insert(0, {"name": "agent.run", "kind": "agent", "start_ms": 0, "duration_ms": total})
        topic = next((a.get("kind") for a in g_in.actions if a["type"] == "topic_blocked"), None)
        reason = (f"Blocked by policy: “{topic}” is a blocked topic." if topic
                  else "Blocked by the jailbreak guardrail.")
        rid = await _record(agent, body.session_id, "blocked", total, None, reason,
                            body.input, None, g_in.actions, spans)
        return {"request_id": rid, "output": None, "blocked": True,
                "reason": reason, "guardrails": g_in.actions, "latency_ms": total}

    start = ms()
    call = await call_agent(agent, g_in.text, body.session_id)
    spans.append({"name": f"{agent['protocol']}.call", "kind": "http", "start_ms": start,
                  "duration_ms": max(ms() - start, 1),
                  "attributes": {"http_status": call.http_status, "endpoint": agent.get("endpoint_url")}})
    actions = list(g_in.actions)
    output = None
    if call.ok:
        g_start = ms()
        g_out = guardrails.check_output(call.text or "", rules)
        output = g_out.text
        actions += g_out.actions
        spans.append({"name": "guardrail.output", "kind": "guardrail", "start_ms": g_start,
                      "duration_ms": max(ms() - g_start, 1), "attributes": {"actions": g_out.actions}})
    total = ms()
    spans.insert(0, {"name": "agent.run", "kind": "agent", "start_ms": 0, "duration_ms": total})
    rid = await _record(agent, body.session_id, "ok" if call.ok else "error", total, call.http_status, call.error,
                        g_in.text, output, actions, spans)
    if not call.ok:
        raise HTTPException(502, {"request_id": rid, "error": call.error})
    return {"request_id": rid, "output": output, "blocked": False, "guardrails": actions, "latency_ms": total}
