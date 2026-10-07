"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Topbar } from "@/components/Shell";
import { Icon } from "@/components/Icon";
import { ErrorBox, Mark, Pill, Skeleton } from "@/components/ui";
import { Donut, Kpi, LineChart, bucketLabels } from "@/components/charts";
import { useAuth } from "@/components/auth";
import { useApi } from "@/lib/useApi";
import { compact, n, protocolOf, secs } from "@/lib/format";
import type { Kpis, SeriesPoint } from "@/lib/types";

interface Overview {
  range: string; kpis: Kpis; series: SeriesPoint[]; agent_counts: Record<string, number>;
  live_agents: { id: string; name: string; protocol: string; team: string | null; owner_name: string | null; risk_tier: number | null; status: string; requests: number; success_rate: number | null; p95: number | null }[];
  attention: { kind: string; agent_id: string; title: string; detail: string }[];
}

export default function OverviewPage() {
  const { me } = useAuth();
  const router = useRouter();
  const [range, setRange] = useState("24h");
  const { data, error, loading } = useApi<Overview>(`/overview?range=${range}`, { pollMs: 30000 });
  const counts = data?.agent_counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const live = (counts.live ?? 0) + (counts.paused ?? 0);

  if (!loading && data && total === 0) {
    return (
      <>
        <Topbar crumbs={[{ label: me.org.name }, { label: "Overview" }]} />
        <div className="content">
          <div className="first">
            <div className="first-hero">
              <div className="first-copy">
                <span className="eyebrow"><Icon name="rocket" />Getting started</span>
                <h1>Welcome, {me.user.name.split(" ")[0]}. Let’s get your first agent live.</h1>
                <p>Point Trust AI at an agent you already run. It tests the connection, rates the risk, runs evaluation suites against the real endpoint, collects sign-off, and monitors every request once it’s in production.</p>
                <div className="row">
                  <Link className="btn pri lg" href="/onboard"><Icon name="plus" />Onboard your first agent</Link>
                  {me.role === "admin" && <Link className="btn lg" href="/settings">Invite your team</Link>}
                </div>
                <div className="first-need">
                  <div><small>You’ll need</small><b>The agent’s URL</b></div>
                  <div><small>And usually</small><b>A token or API key</b></div>
                  <div><small>Takes about</small><b>Five minutes</b></div>
                </div>
              </div>
              <div className="first-flow" aria-label="How onboarding works">
                <ol>
                  {[["plug", "Connect", "One test request confirms Trust AI can reach it"], ["edit", "Describe", "Owner, audience, data, and tools set the risk"],
                    ["flask", "Evaluate", "Accuracy, injection, PII, scope, and latency"], ["rocket", "Deploy", "Approval by tier, then a gradual rollout"]].map(([ic, t, d], i) => (
                    <li key={t}><span className="fi"><Icon name={ic} /></span><div><b>{t}</b><small>{d}</small></div><em>0{i + 1}</em></li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  const s = data?.series ?? [];
  const labels = bucketLabels(s.map((p) => p.t), range);
  const reqMax = Math.max(10, ...s.map((p) => p.requests));
  const niceMax = Math.ceil(reqMax / Math.pow(10, Math.floor(Math.log10(reqMax)))) * Math.pow(10, Math.floor(Math.log10(reqMax)));
  const errRate = s.map((p) => (p.requests - p.blocked > 0 ? (100 * p.errors) / (p.requests - p.blocked) : null));
  const errPeak = Math.max(0, ...errRate.map((v) => v ?? 0));
  const errMax = errPeak <= 4 ? 4 : errPeak <= 10 ? 10 : errPeak <= 20 ? 20 : errPeak <= 50 ? 50 : 100;
  const healthy = data?.live_agents.filter((a) => a.status === "live" && (a.success_rate ?? 100) >= 98).length ?? 0;
  const below = data?.live_agents.filter((a) => (a.success_rate ?? 100) < 98).length ?? 0;
  const paused = data?.live_agents.filter((a) => a.status === "paused").length ?? 0;
  const k = data?.kpis;

  return (
    <>
      <Topbar crumbs={[{ label: me.org.name }, { label: "Overview" }]} />
      <div className="content view-in">
        <div className="ph">
          <div><h1>Fleet overview</h1><p>{live} of {total} agents are live. {data?.attention.length ? `${data.attention.length} ${data.attention.length > 1 ? "items need" : "item needs"} your attention.` : "Nothing needs your attention right now."}</p></div>
          <div className="seg" role="group" aria-label="Time range">
            {["1h", "24h", "7d", "30d"].map((r) => <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>{r}</button>)}
          </div>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        {!data ? <Skeleton h={400} /> : (
          <>
            <div className="kpis">
              <Kpi label="Live agents" icon={<Icon name="bot" />} value={String(live)} sub={`of ${total} registered`} color="var(--accent)" />
              <Kpi label="Requests" icon={<Icon name="req" />} value={compact(k!.requests)} sub={`in the last ${range}`} spark={s.map((p) => p.requests)} color="var(--accent)" />
              <Kpi label="Success rate" icon={<Icon name="check" />} value={k!.success_rate == null ? "—" : n(k!.success_rate, 2)} unit={k!.success_rate == null ? undefined : "%"} sub="Objective 98%" spark={errRate.map((v) => 100 - (v ?? 0))} color="var(--good)" />
              <Kpi label="p95 latency" icon={<Icon name="pulse" />} value={k!.p95 == null ? "—" : (k!.p95 / 1000).toFixed(2)} unit={k!.p95 == null ? undefined : "s"} sub="Objective 4 s" spark={s.map((p) => p.p95 ?? 0)} color="var(--amber)" />
              <Kpi label="Guardrail actions" icon={<Icon name="shield" />} value={compact(k!.guardrail_actions)} sub={`${n(k!.blocked)} requests blocked`} color="var(--teal)" />
              <Kpi label="Conversations" icon={<Icon name="user" />} value={compact(k!.sessions)} sub="Distinct sessions" color="var(--teal)" />
            </div>
            <div className="grid g-main">
              <section className="card">
                <div className="card-h"><h2>Traffic and errors</h2><span className="sub">All agents</span>
                  <div className="end"><div className="legend"><span><i style={{ background: "var(--accent)" }} />Requests</span><span><i style={{ background: "var(--crit)" }} />Error rate</span></div></div></div>
                <LineChart label="Requests over time" labels={labels} max={niceMax} ticks={[0, niceMax / 2, niceMax]} tickFormat={(v) => compact(v)} height={280}
                  series={[{ name: "Requests", data: s.map((p) => p.requests), color: "var(--accent)", fill: true, format: (v) => n(v) }]} />
                <LineChart label="Error rate over time" labels={labels} max={errMax} ticks={[0, errMax / 2, errMax]} tickFormat={(v) => `${v}%`} threshold={2} height={130}
                  series={[{ name: "Error rate", data: errRate, color: "var(--crit)", width: 1.75, format: (v) => `${v.toFixed(1)}%` }]} />
              </section>
              <div className="col">
                <section className="card"><div className="card-h"><h2>Fleet health</h2><span className="sub">{live} live</span></div>
                  <div className="health"><Donut parts={[[healthy, "--good"], [paused, "--warn"], [below, "--crit"]]} big={String(live)} small="live" />
                    <div className="hl"><div><i style={{ background: "var(--good)" }} />Healthy<b>{healthy}</b></div><div><i style={{ background: "var(--warn)" }} />Paused<b>{paused}</b></div><div><i style={{ background: "var(--crit)" }} />Below objective<b>{below}</b></div></div></div>
                </section>
                <section className="card"><div className="card-h" style={{ paddingBottom: 12 }}><h2>Needs your attention</h2>{data.attention.length > 0 && <Pill tone="crit">{String(data.attention.length)}</Pill>}</div>
                  {data.attention.length === 0 && <div className="muted" style={{ padding: "4px 22px 24px", fontSize: 13.5 }}>All clear. Approvals, failed evaluations, and agents below objective show up here.</div>}
                  {data.attention.slice(0, 6).map((a, i) => (
                    <button key={i} className="att" onClick={() => router.push(`/agents/${a.agent_id}`)}>
                      <span className={`att-ic ${a.kind === "approval" ? "acc" : "crit"}`}><Icon name={a.kind === "approval" ? "sign" : a.kind === "blocked" ? "flask" : "alert"} /></span>
                      <span><b>{a.title}</b><small>{a.detail}</small></span>
                    </button>
                  ))}
                </section>
              </div>
            </div>
            <section className="card mt">
              <div className="tbl-tools"><h2 style={{ fontSize: 16, fontWeight: 600 }}>Live agents</h2><div style={{ marginLeft: "auto" }}><Link className="btn" href="/agents">All agents <Icon name="chev" /></Link></div></div>
              {data.live_agents.length === 0 ? <div className="empty">No agents are live yet. Deploy one from its release step.</div> : (
                <div className="tw"><table className="tbl">
                  <thead><tr><th>Agent</th><th>Owner</th><th>Status</th><th className="r">Requests</th><th className="r">Success</th><th className="r">p95</th></tr></thead>
                  <tbody>{data.live_agents.map((a) => (
                    <tr key={a.id} className="click" onClick={() => router.push(`/agents/${a.id}`)}>
                      <td><div className="sys"><Mark>{protocolOf(a.protocol as never).mark}</Mark><div><b>{a.name}</b><small>{a.team || "No team set"}</small></div></div></td>
                      <td>{a.owner_name || "—"}</td>
                      <td>{a.status === "paused" ? <Pill tone="warn" dot>Paused</Pill> : (a.success_rate ?? 100) < 98 ? <Pill tone="crit" dot>Below objective</Pill> : <Pill tone="good" dot>Healthy</Pill>}</td>
                      <td className="r">{n(a.requests)}</td>
                      <td className="r">{a.success_rate == null ? "—" : `${n(a.success_rate, 1)}%`}</td>
                      <td className="r">{secs(a.p95)}</td>
                    </tr>))}</tbody>
                </table></div>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
