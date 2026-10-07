"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Topbar } from "@/components/Shell";
import { Icon } from "@/components/Icon";
import { CopyButton, ErrorBox, Pill, Skeleton, Spinner, StatusPill, useToast } from "@/components/ui";
import { EvalList, Journey, RiskPanel, Waterfall } from "@/components/agent-parts";
import { Kpi, LineChart, bucketLabels } from "@/components/charts";
import { useAuth } from "@/components/auth";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { ROLE_LABEL, ago, clock, compact, isLive, n, protocolOf, secs, when } from "@/lib/format";
import type { Activity, Agent, Approval, EvalCase, EvalRun, Kpis, RequestRow, SeriesPoint, Span } from "@/lib/types";

const AUTH_LABEL = { none: "None", bearer: "Bearer token", api_key: "API key", oauth2: "OAuth 2.0" } as const;
const AUDIENCE_LABEL = { internal: "Internal staff only", partners: "Partners", customers: "Customers", public: "The public" } as const;
const ROLE_INITIALS = { admin: "AD", risk_owner: "RO", security: "SC", member: "ME" } as const;

type Tab = "monitor" | "evaluation" | "release" | "configuration" | "activity";

export default function AgentPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const toast = useToast();
  const { data: agent, error, reload } = useApi<Agent>(`/agents/${id}`, { pollMs: 15000 });
  const [tab, setTab] = useState<Tab | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!agent || tab) return;
    const fromUrl = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    setTab(fromUrl ?? (isLive(agent) ? "monitor" : ["awaiting_approval", "approved", "rejected"].includes(agent.status) ? "release" : "evaluation"));
  }, [agent, tab]);

  if (error) return (<><Topbar crumbs={[{ label: "Agents", href: "/agents" }, { label: "Not found" }]} /><div className="content"><ErrorBox>{error}</ErrorBox></div></>);
  if (!agent || !tab) return (<><Topbar crumbs={[{ label: "Agents", href: "/agents" }, { label: "Loading" }]} /><div className="content"><Skeleton h={500} /></div></>);

  const live = isLive(agent);
  const tabs: [Tab, string][] = [...(live ? [["monitor", "Monitor"]] as [Tab, string][] : []),
    ["evaluation", "Evaluation"], ["release", "Release"], ["configuration", "Configuration"], ["activity", "Activity"]];

  async function act(path: string, msg: string) {
    setBusy(true);
    try { await api(path, { method: "POST" }); toast(msg); await reload(); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Topbar crumbs={[{ label: "Agents", href: "/agents" }, { label: agent.name }]} />
      <div className="content view-in">
        <div className="agent">
          <div className="agent-id"><span className="agent-av"><Icon name="bot" /></span>
            <div>
              <h1>{agent.name}<span className="ver" style={{ cursor: "default" }}>{agent.version}</span><StatusPill status={agent.status} /></h1>
              <div className="kv"><span>Owner<b>{agent.owner_name || "—"}</b></span><span>Team<b>{agent.team || "—"}</b></span><span>Hosting<b>{protocolOf(agent.protocol).name}</b></span><span>Risk<b>{agent.risk_tier ? `Tier ${agent.risk_tier}` : "Not rated"}</b></span></div>
            </div>
          </div>
          <div className="row">
            {agent.status === "live" && <button className="btn" disabled={busy} onClick={() => act(`/agents/${id}/pause`, "Traffic paused")}><Icon name="pause" />Pause traffic</button>}
            {agent.status === "paused" && <button className="btn pri" disabled={busy} onClick={() => act(`/agents/${id}/resume`, "Traffic resumed")}><Icon name="play" />Resume traffic</button>}
            {["draft", "evaluated", "blocked", "rejected"].includes(agent.status) && <Link className="btn pri" href={`/onboard?agent=${id}`}>Continue setup</Link>}
            {agent.status === "approved" && <Link className="btn pri" href={`/onboard?agent=${id}`}><Icon name="rocket" />Deploy</Link>}
          </div>
        </div>
        <Journey agent={agent} />
        <div className="tabs" role="tablist">
          {tabs.map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => { setTab(t); history.replaceState(null, "", `?tab=${t}`); }}>{l}</button>)}
        </div>
        {agent.status === "paused" && <div className="banner warn"><Icon name="pause" /><span><b>Traffic is paused.</b> The gateway refuses requests to this agent until you resume it.</span></div>}
        {agent.status === "blocked" && <div className="banner crit"><Icon name="alert" /><span><b>Evaluation failed.</b> Fix the agent, then evaluate again from setup.</span><Link className="btn sm" href={`/onboard?agent=${id}`}>Open setup</Link></div>}
        {tab === "monitor" && <MonitorTab agent={agent} />}
        {tab === "evaluation" && <EvaluationTab agent={agent} onChange={reload} />}
        {tab === "release" && <ReleaseTab agent={agent} onChange={reload} role={me.role} />}
        {tab === "configuration" && <ConfigTab agent={agent} gateway={me.gateway_url} />}
        {tab === "activity" && <ActivityTab id={id} />}
      </div>
    </>
  );
}

function niceCeil(v: number) {
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * mag >= v) ?? 10;
  return step * mag;
}

function MonitorTab({ agent }: { agent: Agent }) {
  const [range, setRange] = useState(() => agent.deployed_at && Date.now() - new Date(agent.deployed_at).getTime() < 3600_000 ? "1h" : "24h");
  const { data } = useApi<{ kpis: Kpis; series: SeriesPoint[]; guardrails: { type: string; kind: string | null; n: number }[] }>(`/agents/${agent.id}/metrics?range=${range}`, { pollMs: 20000 });
  const { data: reqs } = useApi<RequestRow[]>(`/agents/${agent.id}/requests?limit=8`, { pollMs: 20000 });
  const [sel, setSel] = useState<string | null>(null);
  const current = sel ?? reqs?.[0]?.id ?? null;
  const { data: trace } = useApi<RequestRow & { spans: Span[] }>(current ? `/requests/${current}` : null);
  if (!data) return <Skeleton h={400} />;
  const s = data.series, k = data.kpis;
  const labels = bucketLabels(s.map((p) => p.t), range);
  const peak = Math.max(0, ...s.map((p) => p.p95 ?? 0));
  const latMax = niceCeil(Math.max(peak * 1.25, 200));
  const showObjective = latMax >= 4000;
  return (
    <>
      <div className="row" style={{ justifyContent: "flex-end", marginBottom: 16 }}>
        <div className="seg" role="group" aria-label="Time range">{["1h", "24h", "7d", "30d"].map((r) => <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>{r}</button>)}</div>
      </div>
      <div className="kpis k4">
        <Kpi label="Requests" icon={<Icon name="req" />} value={compact(k.requests)} sub={`${n(k.sessions)} conversations`} spark={s.map((p) => p.requests)} color="var(--accent)" />
        <Kpi label="Success rate" icon={<Icon name="check" />} value={k.success_rate == null ? "—" : n(k.success_rate, 2)} unit={k.success_rate == null ? undefined : "%"} sub="Objective 98%" color="var(--good)" />
        <Kpi label="p95 latency" icon={<Icon name="pulse" />} value={k.p95 == null ? "—" : (k.p95 / 1000).toFixed(2)} unit={k.p95 == null ? undefined : "s"} sub={`p50 ${secs(k.p50)}`} spark={s.map((p) => p.p95 ?? 0)} color="var(--amber)" />
        <Kpi label="Guardrail actions" icon={<Icon name="shield" />} value={n(k.guardrail_actions)} sub={`${n(k.blocked)} blocked, ${n(k.errors)} errors`} color="var(--teal)" />
      </div>
      {k.requests === 0 && (
        <div className="banner good" style={{ marginBottom: 24 }}><Icon name="rocket" /><span><b>Waiting for traffic.</b> Send requests through the gateway and they appear here within seconds. See Configuration for the endpoint.</span></div>
      )}
      <div className="grid g-main">
        <section className="card"><div className="card-h"><h2>Latency</h2><span className="sub">{showObjective ? "p50 and p95" : "p50 and p95, well under the 4 s objective"}</span>
          <div className="end"><div className="legend"><span><i style={{ background: "var(--accent)" }} />p95</span><span><i style={{ background: "var(--teal)" }} />p50</span>{showObjective && <span><i style={{ border: "1.5px dashed var(--crit)" }} />Objective 4 s</span>}</div></div></div>
          <LineChart label="Latency over time" labels={labels} max={latMax} ticks={[0, latMax / 2, latMax]} tickFormat={(v) => (v ? secs(v) : "0")} threshold={showObjective ? 4000 : undefined} height={300}
            series={[{ name: "p95", data: s.map((p) => p.p95), color: "var(--accent)", fill: true, format: (v) => secs(v) },
              { name: "p50", data: s.map((p) => p.p50), color: "var(--teal)", width: 1.75, format: (v) => secs(v) }]} />
        </section>
        <section className="card"><div className="card-h" style={{ paddingBottom: 10 }}><h2>Guardrails</h2><span className="sub">In the last {range}</span></div>
          {data.guardrails.length === 0 ? <div className="empty" style={{ padding: "20px 22px 28px" }}>No guardrail actions yet.</div> :
            data.guardrails.map((g, i) => (
              <div className="intent" key={i} style={{ gridTemplateColumns: "minmax(0,1fr) 56px" }}><div><b>{g.type === "jailbreak_blocked" ? "Jailbreak blocked" : `PII redacted${g.kind ? `, ${g.kind.replace("_", " ")}` : ""}`}</b>
                <div className="ibar"><i style={{ width: `${(g.n / data.guardrails[0].n) * 100}%` }} /></div></div><span className="r tn" style={{ fontWeight: 600 }}>{n(g.n)}</span></div>
            ))}
        </section>
      </div>
      <section className="card mt"><div className="card-h" style={{ paddingBottom: 16 }}><h2>Recent requests</h2><span className="sub">Every request through the gateway is traced</span></div>
        {!reqs?.length ? <div className="empty" style={{ borderTop: "1px solid var(--line)" }}>No requests yet.</div> : (
          <div className="traces">
            <div className="tlist">
              {reqs.map((r) => (
                <button key={r.id} className={`tr ${r.id === current ? "on" : ""}`} onClick={() => setSel(r.id)}>
                  <b>{r.input_preview || "(empty)"}</b><span className="d">{secs(r.latency_ms)}</span>
                  <span className="o"><i style={{ background: r.status === "ok" ? "var(--good)" : r.status === "blocked" ? "var(--warn)" : "var(--crit)" }} />{r.status === "ok" ? "Answered" : r.status === "blocked" ? "Blocked by guardrail" : r.error || "Error"}</span>
                  <span className="t">{clock(r.started_at)}</span>
                </button>
              ))}
            </div>
            <div className="wf">
              {trace && (
                <>
                  <div className="wf-h"><div><h3 style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{trace.input_preview}</h3>
                    <div className="wf-m"><span>Duration <b>{secs(trace.latency_ms)}</b></span><span>Spans <b>{trace.spans.length}</b></span>{trace.session_id && <span>Session <b>{trace.session_id}</b></span>}<span>At <b>{when(trace.started_at)}</b></span></div></div>
                    <Pill tone={trace.status === "ok" ? "good" : trace.status === "blocked" ? "warn" : "crit"} dot>{trace.status === "ok" ? "Answered" : trace.status === "blocked" ? "Blocked" : "Error"}</Pill></div>
                  <Waterfall spans={trace.spans} />
                  {trace.output_preview && <div className="note-box" style={{ marginTop: 14 }}><b style={{ display: "block", marginBottom: 4, color: "var(--fg)" }}>Answer</b>{trace.output_preview}</div>}
                  {trace.error && <div style={{ marginTop: 14 }}><ErrorBox>{trace.error}</ErrorBox></div>}
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}

function EvaluationTab({ agent, onChange }: { agent: Agent; onChange: () => void }) {
  const running = agent.status === "evaluating";
  const { data: run, loading, reload } = useApi<EvalRun | null>(`/agents/${agent.id}/evaluations/latest`, { pollMs: running ? 1500 : null });
  const [suite, setSuite] = useState<string | null>(null);
  const { data: cases } = useApi<EvalCase[]>(run && suite ? `/evaluations/${run.id}/cases?suite=${suite}` : null);
  useEffect(() => { if (run && run.status !== "running" && run.status !== "queued" && running) onChange(); }, [run, running, onChange]);
  useEffect(() => { reload(); }, [agent.status, reload]);
  if (loading && !run) return <Skeleton h={300} />;
  if (!run) return <section className="card"><div className="empty"><p>This agent hasn’t been evaluated yet.</p><Link className="btn pri" style={{ marginTop: 14 }} href={`/onboard?agent=${agent.id}`}>Open setup</Link></div></section>;
  const failed = run.status === "failed";
  return (
    <>
      <div className="grid g-main">
        <section className="card"><div className="card-h"><h2>Evaluation suites</h2><span className="sub">Run {when(run.created_at)}</span></div>
          <div className="fs" style={{ borderTop: 0 }}><EvalList results={run.results} onOpen={setSuite} /></div></section>
        <section className="card" style={{ alignSelf: "start" }}><div className="card-h"><h2>Result</h2></div>
          <div className="card-b">
            <div className="tierbox" style={{ padding: 18, background: `var(--${failed ? "crit" : run.status === "passed" ? "good" : "hover"}-soft, var(--hover))`, borderColor: "transparent" }}>
              <span className="lbl" style={{ color: `var(--${failed ? "crit" : "good"})` }}>{failed ? "Blocked" : run.status === "passed" ? "Cleared for release" : run.status === "error" ? "Couldn’t finish" : "Running"}</span>
              <h3 style={{ fontSize: 28 }}>{run.summary ? `${run.summary.passed} of ${run.summary.total}` : `${run.progress}%`} <span style={{ color: "var(--fg2)" }}>{run.summary ? "suites passed" : "complete"}</span></h3>
            </div>
            {run.error && <div style={{ marginTop: 12 }}><ErrorBox>{run.error}</ErrorBox></div>}
            <p className="help" style={{ marginTop: 14 }}>{run.summary?.judge === "llm" ? "Answers were judged by your configured model." : "Answers were judged with built-in rules. Add an LLM key on the backend for model-graded results."}</p>
          </div></section>
      </div>
      {agent.risk_assessment && <section className="card mt"><div className="card-h"><h2>Risk classification</h2></div><RiskPanel risk={agent.risk_assessment} /></section>}
      {suite && (
        <section className="card mt"><div className="card-h" style={{ paddingBottom: 14 }}><h2>Cases: {run.results.find((r) => r.suite === suite)?.title}</h2><div className="end"><button className="btn sm" onClick={() => setSuite(null)}><Icon name="x" />Close</button></div></div>
          {!cases ? <div style={{ padding: 22 }}><Skeleton h={120} /></div> : cases.map((c) => (
            <div className="case" key={c.id}>
              <Pill tone={c.verdict === "pass" ? "good" : "crit"} icon={c.verdict === "pass" ? "check" : "x"}>{c.verdict === "pass" ? "Pass" : c.verdict === "fail" ? "Fail" : "Error"}</Pill>
              <span className="q">{c.input}</span><span className="a">{c.output}</span><span className="muted tn">{secs(c.latency_ms)}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function ReleaseTab({ agent, onChange, role }: { agent: Agent; onChange: () => void; role: string }) {
  const { data, reload } = useApi<{ approvals: Approval[]; approvers: { user_id: string; name: string; role: string }[] }>(`/agents/${agent.id}/approvals`);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function decide(a: Approval, decision: "approved" | "rejected") {
    setBusy(a.id);
    try { await api(`/approvals/${a.id}/decision`, { method: "POST", json: { decision } }); toast(decision === "approved" ? "Approved" : "Rejected"); await reload(); onChange(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  }
  async function request() {
    setBusy("req");
    try { await api(`/agents/${agent.id}/approvals`, { method: "POST" }); toast("Approval requested"); await reload(); onChange(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  }
  if (!data) return <Skeleton h={240} />;
  const canDecide = (a: Approval) => role === "admin" || role === a.required_role;
  return (
    <div className="grid g-main">
      <section className="card" style={{ alignSelf: "start" }}><div className="card-h"><h2>Approvals</h2><span className="sub">{agent.risk_tier ? `Tier ${agent.risk_tier} needs ${agent.risk_tier === 1 ? "no approval" : agent.risk_tier === 2 ? "a risk owner" : "a risk owner and security"}` : "Evaluate first"}</span></div>
        <div className="fs" style={{ borderTop: 0, paddingTop: 10 }}>
          {data.approvals.length === 0 && <p className="muted">No approvals requested yet.</p>}
          {data.approvals.map((a, i) => (
            <div key={a.id} className={`appr ${i === 0 ? "first" : ""}`}>
              <span className="av do">{ROLE_INITIALS[a.required_role]}</span>
              <div><b>{ROLE_LABEL[a.required_role]}</b><small>{a.status === "pending" ? `Requested ${ago(a.requested_at)}${a.requested_by_name ? ` by ${a.requested_by_name}` : ""}` : `${a.status === "approved" ? "Approved" : "Rejected"} by ${a.decided_by_name} ${ago(a.decided_at)}${a.comment ? `: “${a.comment}”` : ""}`}</small></div>
              <div className="end row">
                {a.status === "pending" && canDecide(a) ? (<>
                  <button className="btn sm" disabled={busy === a.id} onClick={() => decide(a, "rejected")}>Reject</button>
                  <button className="btn sm pri" disabled={busy === a.id} onClick={() => decide(a, "approved")}>{busy === a.id && <Spinner size={13} />}Approve</button></>)
                  : <Pill tone={a.status === "approved" ? "good" : a.status === "rejected" ? "crit" : "warn"} icon={a.status === "approved" ? "check" : a.status === "rejected" ? "x" : "clock"}>{a.status === "pending" ? "Pending" : a.status === "approved" ? "Approved" : "Rejected"}</Pill>}
              </div>
            </div>
          ))}
          {["evaluated", "rejected"].includes(agent.status) && <button className="btn pri" style={{ marginTop: 14 }} disabled={busy === "req"} onClick={request}><Icon name="sign" />Request approval</button>}
        </div>
      </section>
      <section className="card" style={{ alignSelf: "start" }}><div className="card-h"><h2>Deployment</h2></div>
        <div className="card-b">
          {agent.rollout ? (<dl className="sum-l" style={{ padding: 0 }}>
            <div><dt>Rollout</dt><dd>{agent.rollout.mode === "gradual" ? "Gradual" : "All at once"}</dd></div>
            <div><dt>Auto rollback</dt><dd>{agent.rollout.auto_rollback ? "On" : "Off"}</dd></div>
            <div><dt>Alerts</dt><dd>{agent.rollout.alert_channel || "None"}</dd></div>
            <div><dt>Deployed</dt><dd>{when(agent.deployed_at)}</dd></div></dl>)
            : agent.status === "approved" ? <Link className="btn pri" style={{ width: "100%" }} href={`/onboard?agent=${agent.id}`}><Icon name="rocket" />Choose rollout and deploy</Link>
              : <p className="muted">Deploys once every required approval is in.</p>}
          {data.approvers.length <= 1 && role === "admin" && <p className="help" style={{ marginTop: 12 }}>You’re the only approver. Invite teammates in Settings and give them the risk owner or security role.</p>}
        </div>
      </section>
    </div>
  );
}

function ConfigTab({ agent, gateway }: { agent: Agent; gateway: string }) {
  const locked = ["awaiting_approval", "approved", "live", "paused"].includes(agent.status);
  const curl = `curl -X POST ${gateway}/${agent.slug}/invoke \\\n  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"input": "Hello", "session_id": "user-123"}'`;
  return (
    <>
      <section className="card"><div className="card-h"><h2>Gateway endpoint</h2><span className="sub">Send live traffic here so Plumb can apply guardrails and monitor it</span></div>
        <div className="card-b">
          <div className="codebox"><span>POST {gateway}/{agent.slug}/invoke</span><CopyButton text={`${gateway}/${agent.slug}/invoke`} /></div>
          <div className="code" style={{ marginTop: 12 }}><div className="code-h"><span className="dots"><i /><i /><i /></span>Example</div><pre style={{ padding: "12px 16px" }}>{curl}</pre></div>
          <p className="help" style={{ marginTop: 10 }}>Create a gateway key in <Link href="/settings">Settings</Link>.</p>
        </div></section>
      <section className="card mt"><div className="card-h"><h2>Connection</h2><div className="end">{!locked && <Link className="btn sm" href={`/onboard?agent=${agent.id}`}><Icon name="edit" />Edit</Link>}</div></div>
        <dl className="cfg-dl">
          <div><dt>Hosting</dt><dd>{protocolOf(agent.protocol).name}</dd></div>
          <div><dt>Endpoint</dt><dd className="mono">{agent.endpoint_url || "—"}</dd></div>
          <div><dt>Authentication</dt><dd>{agent.auth_type === "none" ? "None" : `${AUTH_LABEL[agent.auth_type]}, ${agent.auth_secret_hint ?? "not set"}`}</dd></div>
          <div><dt>Response key</dt><dd className="mono">{agent.response_key || "Detected automatically"}</dd></div>
          <div><dt>Timeout</dt><dd>{agent.timeout_s} seconds, {agent.max_retries} retries</dd></div>
          <div><dt>Last connection test</dt><dd>{agent.last_test ? `${agent.last_test.ok ? "Passed" : "Failed"}, ${when(agent.last_test.tested_at)}` : "Never"}</dd></div>
        </dl></section>
      <section className="card mt"><div className="card-h"><h2>Purpose, data, and tools</h2></div>
        <dl className="cfg-dl">
          <div style={{ gridColumn: "span 3" }}><dt>Purpose</dt><dd style={{ fontWeight: 400 }}>{agent.purpose || "—"}</dd></div>
          <div><dt>Used by</dt><dd>{AUDIENCE_LABEL[agent.audience]}</dd></div>
          <div><dt>Data it can reach</dt><dd>{agent.data_sources.join(", ") || "None listed"}</dd></div>
          <div><dt>Tools</dt><dd>{agent.tools.filter((t) => t.enabled).map((t) => `${t.name} (${t.access})`).join(", ") || "None listed"}</dd></div>
        </dl></section>
    </>
  );
}

function ActivityTab({ id }: { id: string }) {
  const { data } = useApi<Activity[]>(`/agents/${id}/activity`);
  if (!data) return <Skeleton h={240} />;
  const ICON: Record<string, string> = { created: "plus", connection: "plug", evaluation: "flask", approval: "sign", deploy: "rocket", pause: "pause", resume: "play" };
  return (
    <section className="card"><div className="card-h"><h2>Activity</h2><span className="sub">Everything that happened to this agent</span></div>
      <div className="timeline">
        {data.length === 0 && <p className="muted">Nothing yet.</p>}
        {data.map((a) => (
          <div className="tl" key={a.id}><span className="tl-ic"><Icon name={ICON[a.kind] ?? "clock"} /></span>
            <div><b>{a.message}</b><small>{a.actor_name || "Plumb"}</small></div><time>{when(a.created_at)}</time></div>
        ))}
      </div>
    </section>
  );
}
