"""The risk questionnaire the agent owner answers while onboarding.

Each answer maps to a level on one of the 12 risk dimensions. The final level for a dimension is the
higher of the owner's answer and what Trust AI infers from the agent's tools and data, so an answer
can make an agent look riskier but never safer than its configuration suggests.
"""

QUESTIONS = [
    {
        "key": "autonomy", "dimension": "autonomy",
        "text": "Does it act without a person reviewing its output first?",
        "options": [
            {"value": "reviewed", "label": "No, a person always reviews", "level": "low"},
            {"value": "sometimes", "label": "Sometimes", "level": "medium"},
            {"value": "autonomous", "label": "Yes, it acts on its own", "level": "high"},
        ],
    },
    {
        "key": "changes", "dimension": "action_authority",
        "text": "Can it change data or trigger actions in other systems?",
        "options": [
            {"value": "read_only", "label": "No, it only reads", "level": "low"},
            {"value": "records", "label": "It creates or updates records", "level": "medium"},
            {"value": "critical", "label": "It can move money, change accounts or delete data", "level": "high"},
        ],
    },
    {
        "key": "impact", "dimension": "blast_radius",
        "text": "What is the worst a wrong answer or action could cause?",
        "options": [
            {"value": "minor", "label": "A minor inconvenience", "level": "low"},
            {"value": "moderate", "label": "Rework or a fixable bad decision", "level": "medium"},
            {"value": "severe", "label": "Financial loss, legal or safety harm", "level": "high"},
        ],
    },
    {
        "key": "undo", "dimension": "reversibility",
        "text": "Can its actions be undone easily?",
        "options": [
            {"value": "nothing", "label": "It doesn't take actions", "level": "low"},
            {"value": "yes", "label": "Yes", "level": "low"},
            {"value": "partly", "label": "Partly", "level": "medium"},
            {"value": "no", "label": "No", "level": "high"},
        ],
    },
    {
        "key": "personal_data", "dimension": "data_sensitivity",
        "text": "Does it handle personal data?",
        "options": [
            {"value": "none", "label": "No", "level": "low"},
            {"value": "basic", "label": "Names and work contacts", "level": "medium"},
            {"value": "sensitive", "label": "IDs, health or financial data", "level": "high"},
        ],
    },
    {
        "key": "regulated", "dimension": "data_egress",
        "text": "Is it part of a regulated process, such as finance, healthcare, HR or legal?",
        "options": [
            {"value": "no", "label": "No", "level": "low"},
            {"value": "supports", "label": "It supports one", "level": "medium"},
            {"value": "yes", "label": "Yes, it's part of one", "level": "high"},
        ],
    },
    {
        "key": "bulk", "dimension": "aggregation",
        "text": "Does it work across many records at once, like bulk updates or reports?",
        "options": [
            {"value": "no", "label": "No, one at a time", "level": "low"},
            {"value": "yes", "label": "Yes", "level": "medium"},
        ],
    },
    {
        "key": "memory", "dimension": "persistence",
        "text": "Does it remember past conversations or store what users tell it?",
        "options": [
            {"value": "no", "label": "No", "level": "low"},
            {"value": "yes", "label": "Yes", "level": "medium"},
        ],
    },
    {
        "key": "permissions", "dimension": "control_authority",
        "text": "Can it change its own access or other people's permissions?",
        "options": [
            {"value": "no", "label": "No", "level": "low"},
            {"value": "yes", "label": "Yes", "level": "high"},
        ],
    },
    {
        "key": "schedule", "dimension": "temporal_coupling",
        "text": "Does it keep working after the conversation ends, or run on a schedule?",
        "options": [
            {"value": "no", "label": "No", "level": "low"},
            {"value": "yes", "label": "Yes", "level": "medium"},
        ],
    },
]

_BY_KEY = {q["key"]: q for q in QUESTIONS}


def clean_answers(answers: dict | None) -> dict:
    """Keep only known questions and valid options."""
    out = {}
    for key, value in (answers or {}).items():
        q = _BY_KEY.get(key)
        if q and any(o["value"] == value for o in q["options"]):
            out[key] = value
    return out


def levels_from_answers(answers: dict | None) -> dict[str, tuple[str, str]]:
    """Map answers to {dimension: (level, reason)}."""
    out: dict[str, tuple[str, str]] = {}
    for key, value in clean_answers(answers).items():
        q = _BY_KEY[key]
        opt = next(o for o in q["options"] if o["value"] == value)
        out[q["dimension"]] = (opt["level"], f"Owner says: {opt['label']}"[:80])
    return out


def is_complete(answers: dict | None) -> bool:
    return len(clean_answers(answers)) == len(QUESTIONS)
