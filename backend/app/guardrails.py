"""Gateway guardrails: PII redaction and jailbreak detection, applied to input and output."""
import re
from dataclasses import dataclass, field

PII_PATTERNS: dict[str, re.Pattern] = {
    "email": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    "card_number": re.compile(r"\b(?:\d[ -]?){13,19}\b"),
    "us_ssn": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    "aadhaar": re.compile(r"\b\d{4}\s\d{4}\s\d{4}\b"),
    "pan": re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b"),
    "phone": re.compile(r"(?<!\w)(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?){2,3}\d{3,4}(?!\w)"),
}

JAILBREAK_PATTERNS = [
    r"ignore (all |any )?(previous|prior|above) (instructions|rules|directions)",
    r"disregard (your|the) (instructions|system prompt|rules)",
    r"(reveal|print|show|repeat) (your|the) (system prompt|hidden instructions|initial instructions)",
    r"\byou are now (dan|in developer mode|unrestricted)\b",
    r"developer mode (enabled|on)",
    r"pretend (you have|there are) no (rules|restrictions|guidelines)",
    r"jailbreak",
]
_JAILBREAK = re.compile("|".join(JAILBREAK_PATTERNS), re.I)


def _luhn_ok(digits: str) -> bool:
    nums = [int(d) for d in digits if d.isdigit()]
    if not 13 <= len(nums) <= 19:
        return False
    total = 0
    for i, n in enumerate(reversed(nums)):
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def find_pii(text: str) -> list[tuple[str, str]]:
    """Return (kind, value) for every PII match."""
    found: list[tuple[str, str]] = []
    for kind, pat in PII_PATTERNS.items():
        for m in pat.finditer(text or ""):
            value = m.group(0)
            if kind == "card_number" and not _luhn_ok(value):
                continue
            if kind == "phone" and sum(c.isdigit() for c in value) < 10:
                continue
            found.append((kind, value))
    return found


@dataclass
class GuardResult:
    text: str
    blocked: bool = False
    actions: list[dict] = field(default_factory=list)


def redact(text: str, stage: str) -> GuardResult:
    out = text or ""
    actions = []
    for kind, value in find_pii(out):
        if value in out:
            out = out.replace(value, f"[{kind.upper()} REDACTED]")
            actions.append({"stage": stage, "type": "pii_redaction", "kind": kind})
    return GuardResult(text=out, actions=actions)


def check_input(text: str) -> GuardResult:
    if _JAILBREAK.search(text or ""):
        return GuardResult(text=text, blocked=True,
                           actions=[{"stage": "input", "type": "jailbreak_blocked"}])
    return redact(text, "input")


def check_output(text: str) -> GuardResult:
    return redact(text, "output")
