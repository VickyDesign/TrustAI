"""Minimal client for any OpenAI-compatible chat completions endpoint."""
import json
import re
from typing import Any

import httpx

from .config import get_settings


async def chat_json(system: str, user: str, *, max_tokens: int = 1200) -> Any | None:
    """Ask the configured model for JSON. Returns None when no model is configured or the call fails."""
    s = get_settings()
    if not s.llm_enabled:
        return None
    url = s.llm_base_url.rstrip("/") + "/chat/completions"
    body = {
        "model": s.llm_model,
        "temperature": 0,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system + "\nRespond with a single JSON value and nothing else."},
            {"role": "user", "content": user},
        ],
    }
    headers = {"Authorization": f"Bearer {s.llm_api_key}", "api-key": s.llm_api_key}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"] or ""
    except (httpx.HTTPError, KeyError, ValueError):
        return None
    return _parse_json(content)


def _parse_json(content: str) -> Any | None:
    content = content.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", content, re.S)
    if fenced:
        content = fenced.group(1).strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        m = re.search(r"(\{.*\}|\[.*\])", content, re.S)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                return None
    return None
