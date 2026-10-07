"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";
import { Mark, Pill, StatusPill, Tier } from "./ui";
import { Sparkline } from "./charts";
import { healthOf, isLive, n, protocolOf, secs } from "@/lib/format";
import type { Agent, EvalResult, RiskAssessment, Span } from "@/lib/types";

export function AgentTable({ agents }: { agents: Agent[] }) {
  const router = useRouter();
  if (!agents.length) return <div className="empty">No agents match.</div>;
  return (
    <div className="tw">
      <table className="tbl">
        <thead><tr><th>Agent</th><th>Hosting</th><th>Status</th><th>Health</th><th>Risk</th><th>Owner</th><th className="r">Requests, 24h</th><th className="r">Success</th><th className="r">p95</th><th className="r"></th></tr></thead>
        <tbody>
          {agents.map((a) => {
            const live = isLive(a);
            const h = healthOf(a);
            const go = a.status === "draft" || a.status === "evaluating" ? `/onboard?agent=${a.id}` : `/agents/${a.id}`;
            return (
              <tr key={a.id} className="click" onClick={() => router.push(go)}>
                <td><div className="sys"><Mark>{protocolOf(a.protocol).mark}</Mark><div><b>{a.name}</b><small>{a.team || "No team set"}</small></div></div></td>
                <td><span className="muted">{protocolOf(a.protocol).name}</span></td>
                <td><StatusPill status={a.status} /></td>
                <td>{live ? <Pill tone={h.tone} dot>{h.label}</Pill> : <span className="na">—</span>}</td>
                <td><Tier tier={a.risk_tier} /></td>
                <td>{a.owner_name || "—"}</td>
                <td className="r">{live ? n(a.metrics?.requests_24h) : <span className="na">—</span>}</td>
                <td className="r">{live && a.metrics?.success_rate != null ? `${n(a.metrics.success_rate, 1)}%` : <span className="na">—</span>}</td>
                <td className="r">{live ? secs(a.metrics?.p95_ms) : <span className="na">—</span>}</td>
                <td className="r">
                  {a.status === "draft" ? <Link className="btn sm pri" href={go} onClick={(e) => e.stopPropagation()}>Continue setup</Link>
                    : <Icon name="chev" className="ic muted" />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const LV = { low: "Low", medium: "Medium", high: "High" } as const;

export function RiskPanel({ risk }: { risk: RiskAssessment }) {
  const tone = risk.tier === 3 ? "t3c" : risk.tier === 2 ? "t2c" : "";
  const label = risk.tier === 3 ? "High risk" : risk.tier === 2 ? "Medium risk" : "Low risk";
  const approvals = risk.approvals_required.length;
  return (
    <>
      <div className="risk-top">
        <div className={`tierbox ${tone}`}>
          <span className="lbl">Risk tier</span>
          <h3>Tier {risk.tier} <span>{label}</span></h3>
          <div className="tierscale"><i /><i /><i /></div>
          <p>{risk.driver} sets the tier. {approvals === 0 ? "No approval is needed before release." : `Release needs ${approvals === 1 ? "one approval" : "two approvals"}.`}</p>
        </div>
        <div className="facts2">
          <div className="fact"><small>Highest score</small><b>{risk.highest} of 3</b></div>
          <div className="fact"><small>Average score</small><b>{risk.average.toFixed(2)} of 3</b></div>
          <div className="fact"><small>Approvals needed</small><b>{approvals || "None"}</b></div>
          <div className="fact"><small>Assessed by</small><b>{risk.method === "llm" ? "Model review" : "Policy rules"}</b></div>
        </div>
      </div>
      <div className="dims d2">
        {risk.groups.map((g) => {
          const c = { low: 0, medium: 0, high: 0 } as Record<string, number>;
          g.dimensions.forEach((d) => c[d.level]++);
          const sum = (["high", "medium", "low"] as const).filter((k) => c[k]).map((k) => `${c[k]} ${k}`).join(", ");
          return (
            <div className="dg" key={g.title}>
              <div className="dg-h"><b>{g.title}</b><small>{sum}</small></div>
              {g.dimensions.map((d) => (
                <div className="dim" key={d.key}>
                  <div><b>{d.label}</b><small>{d.reason}</small></div>
                  <div className={`lvl ${d.level[0]}`}><em>{LV[d.level]}</em><span className="bars"><i /><i /><i /></span></div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

const RI: Record<EvalResult["status"], string> = { queued: "clock", running: "", passed: "check", warning: "alert", failed: "x", skipped: "clock" };

export function EvalList({ results, onOpen }: { results: EvalResult[]; onOpen?: (suite: string) => void }) {
  return (
    <div className="run">
      {results.map((r) => (
        <div key={r.id} className={`run-i ${r.status === "running" ? "active" : r.status === "passed" ? "pass" : r.status === "warning" ? "note" : ""}`}
          style={r.status === "failed" ? { borderColor: "color-mix(in srgb,var(--crit) 30%,var(--line))", background: "var(--crit-soft)" } : undefined}>
          <span className="ri" style={r.status === "failed" ? { background: "var(--sheet)", color: "var(--crit)" } : undefined}>
            {r.status === "running" ? <span className="spin" style={{ width: 14, height: 14 }} /> : <Icon name={RI[r.status]} />}
          </span>
          <div><b>{r.title}</b><small>{r.description}</small></div>
          <span className="res">
            {r.status === "queued" ? <small className="muted">Queued</small> : r.status === "running" ? <small className="muted">Running</small> : r.result_label}
            {onOpen && r.suite !== "risk" && r.suite !== "latency" && (r.status === "passed" || r.status === "failed" || r.status === "warning") && (
              <> <button className="link-btn" style={{ marginLeft: 10, fontSize: 12.5 }} onClick={() => onOpen(r.suite)}>Cases</button></>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Journey({ agent }: { agent: Agent }) {
  const s = agent.status;
  const tested = !!agent.last_test?.ok;
  const evaluated = ["evaluated", "awaiting_approval", "approved", "live", "paused", "rejected"].includes(s);
  const approved = ["approved", "live", "paused"].includes(s);
  const live = isLive(agent);
  const steps: [string, string, "done" | "now" | "wait" | "bad" | "todo"][] = [
    ["Connected", tested ? "Connection test passed" : "Not finished", tested ? "done" : "now"],
    ["Evaluated", s === "blocked" ? "A suite failed" : s === "evaluating" ? "Running now" : evaluated ? `Tier ${agent.risk_tier}` : "Not yet",
      s === "blocked" ? "bad" : s === "evaluating" ? "now" : evaluated ? "done" : "todo"],
    ["Approved", s === "awaiting_approval" ? "Waiting for sign-off" : s === "rejected" ? "Rejected" : approved ? "All sign-offs in" : "Not yet",
      s === "awaiting_approval" ? "wait" : s === "rejected" ? "bad" : approved ? "done" : "todo"],
    ["Live", s === "paused" ? "Paused" : live ? `Since ${new Date(agent.deployed_at!).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "Not yet",
      live ? "now" : "todo"],
  ];
  const icon = (st: string, i: number) => st === "done" ? "check" : st === "bad" ? "x" : st === "wait" ? "clock" : st === "now" ? (i === 3 ? "pulse" : "edit") : "clock";
  return (
    <div className="journey">
      {steps.map((st, i) => (
        <span key={i} style={{ display: "contents" }}>
          {i > 0 && <span className="jline" />}
          <div className={`jstep ${st[2]}`}><span className="jd"><Icon name={icon(st[2], i)} /></span><div><b>{st[0]}</b><small>{st[1]}</small></div></div>
        </span>
      ))}
    </div>
  );
}

export function Waterfall({ spans }: { spans: Span[] }) {
  if (!spans.length) return <div className="empty">No spans recorded.</div>;
  const total = Math.max(...spans.map((s) => s.start_ms + s.duration_ms), 1);
  const scale = total * 1.15;
  const ticks = 5;
  const kind = (k: string) => (k === "agent" ? "root" : k === "guardrail" ? "gr" : k === "llm" ? "llm" : "mcp");
  return (
    <div className="wfw"><div className="wfi">
      <div className="axis">
        {Array.from({ length: ticks + 1 }, (_, i) => <span key={i} style={{ left: `${(i / ticks) * 100}%` }}>{secs((scale * i) / ticks)}</span>)}
      </div>
      <div className="spans">
        <div className="gv" style={{ backgroundSize: `${100 / ticks}% 100%` }} />
        {spans.map((s, i) => (
          <div className="sr" key={s.id}>
            <span className={`sn ${i ? "c" : ""}`}><i className={s.kind === "agent" ? "" : `k-${kind(s.kind) === "gr" ? "gr" : kind(s.kind)}`} style={s.kind === "agent" ? { background: "var(--line2)" } : undefined} />{s.name}</span>
            <span className="lane">
              <span className={`sb ${kind(s.kind)}`} style={{ left: `${(s.start_ms / scale) * 100}%`, width: `${(s.duration_ms / scale) * 100}%` }} />
              <span className="sl" style={{ left: `calc(${((s.start_ms + s.duration_ms) / scale) * 100}% + 8px)` }}>{secs(s.duration_ms)}</span>
            </span>
          </div>
        ))}
      </div>
    </div></div>
  );
}
