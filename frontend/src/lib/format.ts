import type { Agent, AgentStatus, Protocol, Role } from "./types";

export const PROTOCOLS: { id: Protocol; mark: string; name: string; hint: string }[] = [
  { id: "http", mark: "HTTP", name: "HTTP endpoint", hint: "Any URL that accepts a JSON POST" },
  { id: "a2a", mark: "A2A", name: "A2A agent", hint: "Read from its agent card" },
  { id: "adk", mark: "ADK", name: "Google ADK", hint: "/run endpoint with sessions" },
  { id: "openai", mark: "AIF", name: "Azure AI Foundry or OpenAI", hint: "Responses or Chat Completions API" },
  { id: "directline", mark: "DL", name: "Copilot Studio", hint: "Through the Direct Line API" },
  { id: "bedrock", mark: "BRK", name: "Bedrock Agents", hint: "Coming next" },
];
export const protocolOf = (p: Protocol) => PROTOCOLS.find((x) => x.id === p) ?? PROTOCOLS[0];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin", risk_owner: "Risk owner", security: "Security", member: "Member",
};

export function n(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
export function compact(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (v >= 10_000) return (v / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return v.toLocaleString();
}
export function secs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export const isLive = (a: Pick<Agent, "status">) => a.status === "live" || a.status === "paused";

export const STATUS: Record<AgentStatus, { label: string; tone: string; icon?: string }> = {
  draft: { label: "Draft", tone: "mute", icon: "edit" },
  evaluating: { label: "Evaluating", tone: "acc", icon: "flask" },
  evaluated: { label: "Ready for approval", tone: "acc", icon: "check" },
  blocked: { label: "Evaluation failed", tone: "crit", icon: "x" },
  awaiting_approval: { label: "Awaiting approval", tone: "acc", icon: "clock" },
  approved: { label: "Approved, not deployed", tone: "good", icon: "check" },
  live: { label: "Live", tone: "good" },
  paused: { label: "Paused", tone: "warn", icon: "pause" },
  rejected: { label: "Release rejected", tone: "crit", icon: "x" },
};

export function healthOf(a: Agent): { label: string; tone: string } {
  const m = a.metrics;
  if (a.status === "paused") return { label: "Paused", tone: "warn" };
  if (!m || !m.requests_24h) return { label: "No traffic yet", tone: "mute" };
  if ((m.success_rate ?? 100) < 98) return { label: "Below objective", tone: "crit" };
  if ((m.p95_ms ?? 0) > 4000) return { label: "Slow", tone: "warn" };
  return { label: "Healthy", tone: "good" };
}
