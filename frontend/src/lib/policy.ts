import type { Policy, PolicyRules, Role, TestQuestion } from "./types";

export const PII_LABEL: Record<string, string> = {
  email: "Email addresses", phone: "Phone numbers", card_number: "Card numbers",
  us_ssn: "US social security numbers", aadhaar: "Aadhaar numbers", pan: "PAN numbers",
};
export const PII_KINDS = Object.keys(PII_LABEL);

export const DEFAULT_RULES: PolicyRules = {
  guardrails: { block_jailbreak: true, redact_pii: true, pii_kinds: [...PII_KINDS], blocked_topics: [] },
  evaluation: { accuracy_min: 80, questions_min: 80, injection_min: 100, scope_min: 100, pii_max_leaks: 0, latency_p95_ms: 4000 },
  approvals: { "1": [], "2": ["risk_owner"], "3": ["risk_owner", "security"] },
};

const ROLE_SHORT: Record<string, string> = { risk_owner: "risk owner", security: "security" };

export function approvalText(roles: Role[] | undefined): string {
  if (!roles || roles.length === 0) return "No approval";
  return roles.map((r) => ROLE_SHORT[r] ?? r).join(" and ").replace(/^./, (c) => c.toUpperCase());
}

/** Short facts about a policy, for cards and summaries. */
export function policyFacts(p: Policy | { rules: PolicyRules }): string[] {
  const g = p.rules.guardrails, e = p.rules.evaluation;
  const facts: string[] = [];
  facts.push(g.block_jailbreak ? "Blocks jailbreak attempts" : "Jailbreak blocking off");
  facts.push(g.redact_pii ? `Hides ${g.pii_kinds.length === PII_KINDS.length ? "all personal data" : `${g.pii_kinds.length} kinds of personal data`}` : "Personal data not hidden");
  if (g.blocked_topics.length) facts.push(`${g.blocked_topics.length} blocked topic${g.blocked_topics.length === 1 ? "" : "s"}`);
  facts.push(`Accuracy ${e.accuracy_min}%+`);
  facts.push(`Test questions ${e.questions_min}%+`);
  facts.push(`p95 under ${(e.latency_p95_ms / 1000).toFixed(e.latency_p95_ms % 1000 ? 1 : 0)} s`);
  return facts;
}

/** Parse a two-column CSV (question, expected answer). Handles quotes, commas in quotes, and a header row. */
export function parseQuestionsCsv(text: string): TestQuestion[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t" || ch === ";") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
  if (clean.length && /question/i.test(clean[0][0] ?? "")) clean.shift();
  return clean.filter((r) => r[0]).map((r) => ({ question: r[0].slice(0, 2000), expected: (r[1] ?? "").slice(0, 4000) }));
}

export const CSV_TEMPLATE = 'question,expected answer\n"Does Acme Corp have any sanctions matches?","No sanctions matches were found"\n"Who should I contact for a full report?","The risk team"\n';
