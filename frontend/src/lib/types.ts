export type Protocol = "http" | "a2a" | "adk" | "openai" | "directline" | "bedrock";
export type AuthType = "none" | "bearer" | "api_key" | "oauth2";
export type AgentStatus =
  | "draft" | "evaluating" | "evaluated" | "blocked" | "awaiting_approval"
  | "approved" | "live" | "paused" | "rejected";
export type Role = "admin" | "risk_owner" | "security" | "member";

export interface Tool { name: string; description?: string; access: "read" | "write"; enabled: boolean }

export interface ConnectionTest {
  ok: boolean; latency_ms: number; http_status: number | null; answer: string | null; error: string | null;
  checks: { label: string; ok: boolean }[]; tested_at: string; message: string;
}

export interface RiskDimension { key: string; label: string; level: "low" | "medium" | "high"; reason: string }
export interface RiskAssessment {
  tier: 1 | 2 | 3; highest: number; average: number; driver: string; method: "llm" | "rules";
  groups: { title: string; dimensions: RiskDimension[] }[]; approvals_required: Role[];
  policy?: { id: string; name: string }; questionnaire?: boolean;
}

export interface TestQuestion { question: string; expected: string }

export interface PolicyRules {
  guardrails: { block_jailbreak: boolean; redact_pii: boolean; pii_kinds: string[]; blocked_topics: string[] };
  evaluation: { accuracy_min: number; questions_min: number; injection_min: number; scope_min: number; pii_max_leaks: number; latency_p95_ms: number };
  approvals: Record<"1" | "2" | "3", Role[]>;
}
export interface Policy {
  id: string; name: string; description: string | null; is_default: boolean; rules: PolicyRules;
  agent_count: number; created_at: string; updated_at: string;
}
export interface RiskQuestion {
  key: string; dimension: string; text: string;
  options: { value: string; label: string; level: "low" | "medium" | "high" }[];
}

export interface Agent {
  id: string; org_id: string; name: string; slug: string; team: string | null; purpose: string | null;
  audience: "internal" | "customers" | "partners" | "public"; owner_user_id: string | null; owner_name: string | null;
  protocol: Protocol; endpoint_url: string | null; auth_type: AuthType; auth_header: string | null;
  auth_secret_hint: string | null; request_template: string | null; response_key: string | null;
  timeout_s: number; max_retries: number; data_sources: string[]; tools: Tool[]; status: AgentStatus;
  onboarding_step: number; risk_tier: 1 | 2 | 3 | null; risk_assessment: RiskAssessment | null;
  last_test: ConnectionTest | null; version: string;
  rollout: { mode: "gradual" | "all"; auto_rollback: boolean; alert_channel: string | null; started_at: string } | null;
  deployed_at: string | null; created_at: string; updated_at: string;
  policy_id: string | null; questionnaire: Record<string, string>; test_questions: TestQuestion[];
  metrics?: { requests_24h: number; success_rate: number | null; p95_ms: number | null };
}

export interface EvalResult {
  id: string; suite: string; title: string; description: string | null; position: number;
  status: "queued" | "running" | "passed" | "failed" | "warning" | "skipped";
  score: number | null; threshold: number | null; result_label: string | null; details: Record<string, unknown>;
}
export interface EvalRun {
  id: string; agent_id: string; status: "queued" | "running" | "passed" | "failed" | "error"; progress: number;
  summary: { passed: number; total: number; failed: string[]; tier: number; judge: string } | null;
  error: string | null; created_at: string; started_at: string | null; finished_at: string | null; results: EvalResult[];
}
export interface EvalCase { id: string; suite: string; input: string; output: string | null; verdict: "pass" | "fail" | "error"; reason: string | null; latency_ms: number | null }

export interface Approval {
  id: string; required_role: Role; status: "pending" | "approved" | "rejected"; requested_by: string;
  requested_by_name: string | null; decided_by_name: string | null; comment: string | null;
  requested_at: string; decided_at: string | null;
}

export interface Me {
  user: { id: string; email: string; name: string };
  org: { id: string; name: string; settings: { allow_self_approval?: boolean; join_code?: string } };
  role: Role; gateway_url: string; llm_enabled: boolean;
}

export interface SeriesPoint { t: string; requests: number; errors: number; blocked: number; p50: number | null; p95: number | null }
export interface Kpis {
  requests: number; ok: number; errors: number; blocked: number; p50: number | null; p95: number | null;
  guardrail_actions: number; sessions: number; success_rate: number | null;
}
export interface RequestRow {
  id: string; started_at: string; latency_ms: number | null; status: "ok" | "error" | "blocked"; http_status: number | null;
  error: string | null; input_preview: string | null; output_preview: string | null;
  guardrail_actions: { stage: string; type: string; kind?: string }[]; session_id: string | null;
}
export interface Span { id: string; name: string; kind: string; start_ms: number; duration_ms: number; attributes: Record<string, unknown> }
export interface Member { user_id: string; email: string; display_name: string | null; role: Role; created_at: string }
export interface Activity { id: number; actor_name: string | null; kind: string; message: string; created_at: string }
