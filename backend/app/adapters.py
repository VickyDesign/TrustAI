"""Protocol adapters: send one message to an agent and read back its answer.

Every adapter returns an AgentCall so the connection test, the evaluation engine,
and the gateway all treat agents the same way regardless of how they are hosted.
"""
import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import httpx

from .security import UnsafeURL, check_outbound_url, decrypt

DEFAULT_TEMPLATE = '{"message": "{{prompt}}", "session_id": "{{session_id}}"}'
COMMON_KEYS = ["response", "reply", "output", "answer", "text", "message", "content", "result"]


@dataclass
class AgentCall:
    ok: bool
    text: str | None = None
    latency_ms: int = 0
    http_status: int | None = None
    error: str | None = None
    raw: Any = None
    steps: list[dict] = field(default_factory=list)  # sub-calls, recorded as trace spans


class AdapterError(Exception):
    def __init__(self, message: str, http_status: int | None = None, raw: Any = None):
        super().__init__(message)
        self.http_status = http_status
        self.raw = raw


def dig(data: Any, path: str) -> Any:
    """Read a dot path such as 'data.reply' or 'choices.0.message.content'."""
    cur = data
    for part in [p for p in path.split(".") if p]:
        if isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except (ValueError, IndexError):
                return None
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def _as_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    return json.dumps(value)[:4000]


def _settings(agent: dict) -> dict:
    """Non-HTTP protocols keep small JSON settings in request_template (app name, model)."""
    try:
        v = json.loads(agent.get("request_template") or "{}")
        return v if isinstance(v, dict) else {}
    except json.JSONDecodeError:
        return {}


async def _auth_headers(agent: dict, client: httpx.AsyncClient) -> dict:
    kind = agent.get("auth_type") or "none"
    secret = decrypt(agent.get("auth_secret_enc"))
    if kind == "none" or not secret:
        return {}
    if kind == "bearer":
        return {"Authorization": f"Bearer {secret}"}
    if kind == "api_key":
        return {agent.get("auth_header") or "X-API-Key": secret}
    if kind == "oauth2":
        # Secret holds client-credentials settings as JSON.
        try:
            cfg = json.loads(secret)
            resp = await client.post(
                cfg["token_url"],
                data={"grant_type": "client_credentials", "client_id": cfg["client_id"],
                      "client_secret": cfg["client_secret"], "scope": cfg.get("scope", "")},
            )
            resp.raise_for_status()
            return {"Authorization": f"Bearer {resp.json()['access_token']}"}
        except Exception as e:  # noqa: BLE001
            raise AdapterError(f"Could not get an OAuth token: {e}")
    return {}


def _render_template(template: str, prompt: str, session_id: str) -> Any:
    esc = lambda s: json.dumps(s)[1:-1]  # noqa: E731
    body = template.replace("{{prompt}}", esc(prompt)).replace("{{session_id}}", esc(session_id))
    try:
        return json.loads(body)
    except json.JSONDecodeError as e:
        raise AdapterError(f"The request template is not valid JSON: {e.msg}")


async def _post_json(client: httpx.AsyncClient, url: str, body: Any, headers: dict) -> tuple[Any, int]:
    check_outbound_url(url)
    resp = await client.post(url, json=body, headers=headers)
    try:
        data = resp.json()
    except ValueError:
        data = resp.text
    if resp.status_code >= 400:
        raise AdapterError(f"The agent returned HTTP {resp.status_code}", resp.status_code, data)
    return data, resp.status_code


# --- protocols -----------------------------------------------------------------

async def _http(agent, prompt, session_id, client, headers):
    body = _render_template(agent.get("request_template") or DEFAULT_TEMPLATE, prompt, session_id)
    data, code = await _post_json(client, agent["endpoint_url"], body, headers)
    key = agent.get("response_key")
    if key:
        text = _as_text(dig(data, key))
        if text is None:
            raise AdapterError(f"No value found at response key “{key}”", code, data)
    elif isinstance(data, str):
        text = data
    else:
        text = next((_as_text(dig(data, k)) for k in COMMON_KEYS if dig(data, k) is not None), None)
        if text is None:
            raise AdapterError("Couldn't find the answer in the response. Set a response key.", code, data)
    return text, code, data


def _a2a_text(result: Any) -> str | None:
    """Pull text parts out of an A2A Message or Task result."""
    if not isinstance(result, dict):
        return None
    parts: list = []
    if result.get("kind") == "message" or "parts" in result:
        parts = result.get("parts", [])
    else:
        for art in result.get("artifacts") or []:
            parts += art.get("parts", [])
        if not parts:
            parts = (dig(result, "status.message.parts") or [])
    texts = [p.get("text") for p in parts if isinstance(p, dict) and p.get("text")]
    return "\n".join(texts) if texts else None


async def _a2a(agent, prompt, session_id, client, headers):
    url = agent["endpoint_url"]
    if url.rstrip("/").endswith((".json", "agent-card")) or "/.well-known/" in url:
        check_outbound_url(url)
        card = (await client.get(url, headers=headers)).json()
        url = card.get("url") or url
    body = {
        "jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": "message/send",
        "params": {"message": {"role": "user", "kind": "message", "messageId": str(uuid.uuid4()),
                               "contextId": session_id, "parts": [{"kind": "text", "text": prompt}]}},
    }
    data, code = await _post_json(client, url, body, headers)
    if isinstance(data, dict) and data.get("error"):
        raise AdapterError(f"A2A error: {dig(data, 'error.message') or data['error']}", code, data)
    text = _a2a_text(dig(data, "result"))
    if text is None:
        raise AdapterError("The A2A reply had no text parts", code, data)
    return text, code, data


async def _adk(agent, prompt, session_id, client, headers):
    cfg = _settings(agent)
    app = cfg.get("app_name")
    if not app:
        raise AdapterError("Set the ADK app name for this agent")
    base = agent["endpoint_url"].rstrip("/")
    user = cfg.get("user_id", "plumb")
    check_outbound_url(base)
    await client.post(f"{base}/apps/{app}/users/{user}/sessions/{session_id}", json={}, headers=headers)
    body = {"app_name": app, "user_id": user, "session_id": session_id,
            "new_message": {"role": "user", "parts": [{"text": prompt}]}}
    data, code = await _post_json(client, f"{base}/run", body, headers)
    texts = []
    for ev in data if isinstance(data, list) else []:
        for p in dig(ev, "content.parts") or []:
            if isinstance(p, dict) and p.get("text"):
                texts.append(p["text"])
    if not texts:
        raise AdapterError("The ADK agent returned no text", code, data)
    return texts[-1], code, data


async def _openai(agent, prompt, session_id, client, headers):
    cfg = _settings(agent)
    url = agent["endpoint_url"]
    if url.rstrip("/").endswith("/chat/completions"):
        body = {"model": cfg.get("model", ""), "messages": [{"role": "user", "content": prompt}]}
        data, code = await _post_json(client, url, body, headers)
        text = _as_text(dig(data, "choices.0.message.content"))
    else:
        body = {"input": prompt}
        if cfg.get("model"):
            body["model"] = cfg["model"]
        if cfg.get("agent"):
            body["agent"] = {"name": cfg["agent"], "type": "agent_reference"}
        data, code = await _post_json(client, url, body, headers)
        text = _as_text(dig(data, "output_text"))
        if text is None:
            for item in dig(data, "output") or []:
                for c in item.get("content", []) if isinstance(item, dict) else []:
                    if c.get("text"):
                        text = c["text"]
    if text is None:
        raise AdapterError("The response had no output text", code, data)
    return text, code, data


async def _directline(agent, prompt, session_id, client, headers):
    base = (agent.get("endpoint_url") or "https://directline.botframework.com/v3/directline").rstrip("/")
    check_outbound_url(base)
    conv = await client.post(f"{base}/conversations", headers=headers)
    if conv.status_code >= 400:
        raise AdapterError(f"Direct Line returned HTTP {conv.status_code}", conv.status_code)
    cid = conv.json()["conversationId"]
    await client.post(f"{base}/conversations/{cid}/activities", headers=headers,
                      json={"type": "message", "from": {"id": f"plumb-{session_id}"}, "text": prompt})
    deadline = time.monotonic() + float(agent.get("timeout_s") or 30)
    while time.monotonic() < deadline:
        await asyncio.sleep(0.8)
        acts = (await client.get(f"{base}/conversations/{cid}/activities", headers=headers)).json()
        replies = [a for a in acts.get("activities", [])
                   if a.get("type") == "message" and not str(dig(a, "from.id")).startswith("plumb-")]
        if replies:
            return replies[-1].get("text") or "", 200, acts
    raise AdapterError("The bot didn't reply before the timeout")


async def _bedrock(*_):
    raise AdapterError("Bedrock Agents need AWS request signing, which is next on the roadmap. "
                       "Put an HTTP endpoint in front of the agent for now.")


PROTOCOLS = {"http": _http, "a2a": _a2a, "adk": _adk, "openai": _openai,
             "directline": _directline, "bedrock": _bedrock}


async def call_agent(agent: dict, prompt: str, session_id: str | None = None) -> AgentCall:
    session_id = session_id or f"plumb-{uuid.uuid4().hex[:12]}"
    if not agent.get("endpoint_url") and agent.get("protocol") != "directline":
        return AgentCall(ok=False, error="Add the agent's URL first")
    handler = PROTOCOLS.get(agent.get("protocol") or "http", _http)
    timeout = httpx.Timeout(float(agent.get("timeout_s") or 60), connect=10.0)
    attempts = int(agent.get("max_retries") or 0) + 1
    start = time.perf_counter()
    last: AgentCall | None = None
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        for attempt in range(attempts):
            try:
                headers = await _auth_headers(agent, client)
                text, code, raw = await handler(agent, prompt, session_id, client, headers)
                return AgentCall(ok=True, text=text, http_status=code, raw=raw,
                                 latency_ms=int((time.perf_counter() - start) * 1000))
            except UnsafeURL as e:
                return AgentCall(ok=False, error=str(e), latency_ms=int((time.perf_counter() - start) * 1000))
            except AdapterError as e:
                last = AgentCall(ok=False, error=str(e), http_status=e.http_status, raw=e.raw)
                if not (e.http_status and e.http_status >= 500):
                    break
            except httpx.TimeoutException:
                last = AgentCall(ok=False, error=f"No answer within {agent.get('timeout_s') or 60} seconds")
            except httpx.HTTPError as e:
                last = AgentCall(ok=False, error=f"Couldn't reach the agent: {e.__class__.__name__}")
            if attempt < attempts - 1:
                await asyncio.sleep(0.5 * (attempt + 1))
    assert last is not None
    last.latency_ms = int((time.perf_counter() - start) * 1000)
    return last
