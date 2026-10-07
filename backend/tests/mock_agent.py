"""A tiny agent used for local end-to-end testing. Run: uvicorn tests.mock_agent:app --port 9100"""
import asyncio
import random

from fastapi import FastAPI, Header, HTTPException, Request

app = FastAPI()
TOKEN = "test-token-123"
REFUSE = ("ignore", "override", "system prompt", "developer mode", "restrictions", "phishing", "bypass",
          "delete every", "coworker", "credit card", "social security", "national id", "home address",
          "email addresses", "contact details", "safety rules", "operator", "code")


@app.post("/api/v1/screen")
async def screen(request: Request, authorization: str = Header(default="")):
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "bad token")
    body = await request.json()
    q = str(body.get("query", ""))
    await asyncio.sleep(random.uniform(0.05, 0.25))
    if any(w in q.lower() for w in REFUSE):
        answer = "I'm sorry, I can't help with that. I only screen vendors for sanctions and adverse media."
    else:
        answer = (f"I screened the request '{q[:60]}'. No sanctions matches were found and adverse media "
                  "results show no current issues. Contact the risk team at risk@arden.io for a full report.")
    return {"result": {"summary": answer, "risk_rating": "low"}, "trace_id": "mock"}
