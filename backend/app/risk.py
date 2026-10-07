"""Risk classification across 12 dimensions in four groups, and the approval policy per tier."""
from . import llm

GROUPS = [
    ("Autonomy and decisions", [
        ("autonomy", "Autonomy", "How far the agent acts without a person confirming"),
        ("decision_scope", "Decision scope", "How many tools and choices it has per request"),
        ("temporal_coupling", "Temporal coupling", "Whether actions span beyond one conversation"),
    ]),
    ("Action authority", [
        ("action_authority", "Action authority", "What it can change in other systems"),
        ("system_reach", "System reach", "How many systems it connects to"),
        ("blast_radius", "Blast radius", "How much one wrong action can affect"),
    ]),
    ("Data exposure", [
        ("data_sensitivity", "Data sensitivity", "How sensitive the data it reads is"),
        ("data_egress", "Data egress", "Where its answers go and who sees them"),
        ("aggregation", "Aggregation", "Whether it combines many records at once"),
    ]),
    ("Recoverability", [
        ("reversibility", "Reversibility", "Whether its actions can be undone"),
        ("persistence", "Persistence", "Whether it keeps memory between conversations"),
        ("control_authority", "Control authority", "Whether it can change its own permissions"),
    ]),
]
LEVELS = {"low": 1, "medium": 2, "high": 3}
SENSITIVE_WORDS = ("payment", "payroll", "salary", "customer", "patient", "health", "medical",
                   "bank", "card", "ssn", "passport", "employee", "hr ", "personnel")
ACCOUNT_WORDS = ("password", "mfa", "account", "group", "permission", "role", "payment", "refund",
                 "transfer", "delete", "invoice", "order")

APPROVALS_BY_TIER = {1: [], 2: ["risk_owner"], 3: ["risk_owner", "security"]}


def _heuristic(agent: dict) -> dict[str, tuple[str, str]]:
    tools = [t for t in (agent.get("tools") or []) if t.get("enabled", True)]
    writes = [t for t in tools if t.get("access") == "write"]
    names = " ".join((t.get("name", "") + " " + t.get("description", "")).lower() for t in writes)
    sources = [s.lower() for s in (agent.get("data_sources") or [])]
    sensitive = [s for s in sources if any(w in s for w in SENSITIVE_WORDS)]
    external = agent.get("audience") in ("customers", "partners", "public")
    account_writes = any(w in names for w in ACCOUNT_WORDS)

    def lv(cond_high, cond_med):
        return "high" if cond_high else "medium" if cond_med else "low"

    return {
        "autonomy": (lv(len(writes) >= 3, bool(writes)), (f"{len(writes)} tool{'s' if len(writes) != 1 else ''} can change data" if writes else "No tool can change data")),
        "decision_scope": (lv(len(tools) >= 10, len(tools) >= 3), (f"Chooses among {len(tools)} tools" if len(tools) > 1 else "One tool or none to choose from")),
        "temporal_coupling": ("low", "Each action finishes inside one request"),
        "action_authority": (lv(account_writes, bool(writes)),
                             "Can change accounts or money" if account_writes else
                             ("Can create or update records" if writes else "Read only")),
        "system_reach": (lv(len(tools) >= 8, len(tools) >= 3), f"{len(tools)} connected tool{'s' if len(tools) != 1 else ''}"),
        "blast_radius": (lv(account_writes and external, bool(writes)), "One record per action" if writes else "No changes"),
        "data_sensitivity": (lv(len(sensitive) >= 2, bool(sensitive) or bool(sources)),
                             ", ".join(agent.get("data_sources") or []) or "No data sources"),
        "data_egress": (lv(external and bool(sensitive), external or bool(sources)),
                        "Answers go outside the company" if external else "Internal users only"),
        "aggregation": ("low", "Works on one record at a time"),
        "reversibility": (lv(account_writes, bool(writes)), "Some actions can't be undone" if account_writes else "Changes can be reverted"),
        "persistence": ("low", "No memory between conversations"),
        "control_authority": ("low", "Cannot change its own permissions"),
    }


async def classify(agent: dict) -> dict:
    """Return a risk assessment: tier, scores, and per-dimension levels with reasons."""
    levels = _heuristic(agent)
    method = "rules"
    dims_doc = "\n".join(f"- {key}: {label}. {desc}" for _, ds in GROUPS for key, label, desc in ds)
    tools = [f"{t.get('name')} ({t.get('access', 'read')}): {t.get('description', '')}"
             for t in agent.get("tools") or [] if t.get("enabled", True)]
    answer = await llm.chat_json(
        "You assess the operational risk of AI agents for an enterprise governance team. "
        "Rate each dimension low, medium, or high and give a reason of at most 8 words.",
        f"Agent: {agent.get('name')}\nPurpose: {agent.get('purpose') or 'not given'}\n"
        f"Users: {agent.get('audience')}\nData it can read: {', '.join(agent.get('data_sources') or []) or 'none'}\n"
        f"Tools:\n" + ("\n".join(tools) or "none") + f"\n\nDimensions:\n{dims_doc}\n\n"
        'Return {"<dimension key>": {"level": "low|medium|high", "reason": "..."}} for all 12 keys.',
    )
    if isinstance(answer, dict):
        for key in levels:
            v = answer.get(key)
            if isinstance(v, dict) and v.get("level") in LEVELS:
                levels[key] = (v["level"], str(v.get("reason") or levels[key][1])[:80])
        method = "llm"

    groups = []
    for title, ds in GROUPS:
        items = [{"key": k, "label": label, "level": levels[k][0], "reason": levels[k][1]} for k, label, _ in ds]
        groups.append({"title": title, "dimensions": items})
    scores = [LEVELS[levels[k][0]] for k in levels]
    highest = max(scores)
    tier = 3 if highest == 3 else 2 if highest == 2 else 1
    driver = max(levels, key=lambda k: LEVELS[levels[k][0]])
    driver_label = next(label for _, ds in GROUPS for k, label, _ in ds if k == driver)
    return {
        "tier": tier,
        "highest": highest,
        "average": round(sum(scores) / len(scores), 2),
        "driver": driver_label,
        "groups": groups,
        "method": method,
        "approvals_required": APPROVALS_BY_TIER[tier],
    }
