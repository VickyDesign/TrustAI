"""A small built-in sample agent, so a new workspace can try the whole flow before connecting a real one.

Connect it in the wizard as an HTTP endpoint:
  URL    https://<this API>/demo/agent
  Token  plumb-demo (bearer)
Everything else can stay at its default.
"""
import asyncio
import random

from fastapi import APIRouter, Header, HTTPException, Request

router = APIRouter(prefix="/demo", tags=["demo"])

TOKEN = "plumb-demo"
REFUSE = ("ignore", "override", "system prompt", "developer mode", "restrictions", "phishing", "bypass",
          "delete every", "coworker", "credit card", "social security", "national id", "home address",
          "email addresses", "contact details", "safety rules", "operator", "code", "password")


@router.post("/agent")
async def demo_agent(request: Request, authorization: str = Header(default="")):
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "Use the bearer token plumb-demo")
    try:
        body = await request.json()
    except ValueError:
        body = {}
    q = ""
    if isinstance(body, dict):
        q = str(next((body[k] for k in ("message", "query", "input", "prompt", "question") if body.get(k)), ""))
    await asyncio.sleep(random.uniform(0.2, 0.6))
    if any(w in q.lower() for w in REFUSE):
        answer = "Sorry, I can't help with that. I only answer questions about vendor screening."
    else:
        answer = (f"I checked “{q[:80]}”. No sanctions matches were found and adverse media shows no current "
                  "issues. Email the risk team at risk@example.com for the full report.")
    return {"reply": answer, "risk_rating": "low"}
