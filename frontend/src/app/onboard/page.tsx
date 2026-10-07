"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon, Logo } from "@/components/Icon";
import { CopyButton, ErrorBox, Mark, Pill, Skeleton, Spinner, Switch, useToast } from "@/components/ui";
import { EvalList, RiskPanel } from "@/components/agent-parts";
import { useAuth } from "@/components/auth";
import { api } from "@/lib/api";
import { PROTOCOLS, ROLE_LABEL, ago, protocolOf, secs } from "@/lib/format";
import type { Agent, Approval, AuthType, ConnectionTest, EvalRun, Member, Protocol, Tool } from "@/lib/types";

const STEPS = ["Connect", "Describe", "Evaluate", "Deploy"];
const NOTES = [
  ["Connect your agent", "Trust AI sends one test request to confirm it can reach the agent and read its answer."],
  ["Describe it", "Ownership, audience and data access decide the risk tier and who has to approve."],
  ["Evaluate it", "Trust AI classifies risk and runs every suite against the real agent. Nothing reaches users yet."],
  ["Deploy it", "Collect the approvals the tier needs, then choose how traffic moves to the agent."],
];
const DATA_PRESETS: [string, boolean][] = [
  ["Public website", false], ["Internal knowledge base", false], ["Product catalog", false], ["Contracts", false],
  ["Employee directory", true], ["Customer records", true], ["Payments history", true], ["Health records", true],
];
const PLACEHOLDER: Record<Protocol, string> = {
  http: "https://agents.example.com/api/v1/chat",
  a2a: "https://agents.example.com/a2a",
  adk: "https://my-adk-service.run.app",
  openai: "https://my-resource.openai.azure.com/openai/v1/responses",
  directline: "https://directline.botframework.com/v3/directline",
  bedrock: "",
};
const DEFAULT_TEMPLATE = '{\n  "message": "{{prompt}}",\n  "session_id": "{{session_id}}"\n}';

interface Conn {
  protocol: Protocol; endpoint_url: string; auth_type: AuthType; auth_header: string; auth_secret: string;
  oauth: { token_url: string; client_id: string; client_secret: string; scope: string };
  template: string; response_key: string; timeout_s: number; app_name: string; user_id: string; model: string; agent_ref: string;
}

function connFrom(a: Agent | null): Conn {
  let s: Record<string, string> = {};
  if (a && a.protocol !== "http") { try { s = JSON.parse(a.request_template || "{}"); } catch { s = {}; } }
  return {
    protocol: a?.protocol ?? "http", endpoint_url: a?.endpoint_url ?? "", auth_type: a?.auth_type ?? "bearer",
    auth_header: a?.auth_header ?? "X-API-Key", auth_secret: "", oauth: { token_url: "", client_id: "", client_secret: "", scope: "" },
    template: a?.protocol === "http" && a.request_template ? a.request_template : DEFAULT_TEMPLATE,
    response_key: a?.response_key ?? "", timeout_s: a?.timeout_s ?? 60,
    app_name: s.app_name ?? "", user_id: s.user_id ?? "", model: s.model ?? "", agent_ref: s.agent ?? "",
  };
}

function connPayload(c: Conn) {
  const settings: Record<string, string> = {};
  if (c.protocol === "adk") { if (c.app_name) settings.app_name = c.app_name; if (c.user_id) settings.user_id = c.user_id; }
  if (c.protocol === "openai") { if (c.model) settings.model = c.model; if (c.agent_ref) settings.agent = c.agent_ref; }
  const out: Record<string, unknown> = {
    protocol: c.protocol, endpoint_url: c.endpoint_url.trim(), auth_type: c.auth_type,
    auth_header: c.auth_type === "api_key" ? c.auth_header : null, timeout_s: c.timeout_s,
    request_template: c.protocol === "http" ? c.template : JSON.stringify(settings),
    response_key: c.protocol === "http" ? c.response_key.trim() || null : null,
  };
  if (c.auth_type === "oauth2" && c.oauth.token_url && c.oauth.client_id && c.oauth.client_secret) out.auth_secret = JSON.stringify(c.oauth);
  else if (c.auth_type !== "oauth2" && c.auth_type !== "none" && c.auth_secret) out.auth_secret = c.auth_secret;
  return out;
}

function stepFor(a: Agent): number {
  if (a.status === "draft") return a.last_test?.ok ? (a.onboarding_step >= 3 ? 2 : 1) : 0;
  if (["evaluating", "evaluated", "blocked"].includes(a.status)) return 2;
  return 3;
}

export default function OnboardPage() {
  const { me } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("agent");
    if (!id) { setReady(true); return; }
    api<Agent>(`/agents/${id}`).then((a) => {
      setAgent(a);
      if (a.status === "live" || a.status === "paused") setDone(true);
      setStep(stepFor(a));
      setReady(true);
    }).catch((e) => { setLoadError((e as Error).message); setReady(true); });
  }, []);

  const update = useCallback((a: Agent) => {
    setAgent(a);
    const url = `/onboard?agent=${a.id}`;
    if (window.location.pathname + window.location.search !== url) history.replaceState(null, "", url);
  }, []);

  const exit = () => router.push(agent ? `/agents/${agent.id}` : "/agents");

  return (
    <section className="wiz" aria-label="Onboard an agent">
      <header className="wiz-top">
        <div className="wiz-title"><Logo /><div><b>Onboard an agent</b><small>One agent, four steps, live at the end</small></div></div>
        <nav className="wiz-steps" aria-label="Onboarding steps">
          {STEPS.map((s, i) => {
            const st = done || i < step ? "done" : i === step ? "on" : "";
            return (
              <span key={s} style={{ display: "contents" }}>
                {i > 0 && <span className={`ws-line ${i <= step || done ? "done" : ""}`} />}
                <button type="button" className={`ws-step ${st}`} disabled={!(i < step && !done)} onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}>
                  <span className="n">{done || i < step ? <Icon name="check" /> : i + 1}</span><b>{s}</b>
                </button>
              </span>
            );
          })}
        </nav>
        <button className="btn ghost wiz-close" type="button" onClick={exit}><Icon name="x" />{done ? "Close" : "Save and exit"}</button>
      </header>
      <div className="wiz-body">
        {!ready ? <div className="wiz-inner"><Skeleton h={480} /><Skeleton h={360} /></div>
          : loadError ? <div style={{ maxWidth: 640, margin: "40px auto" }}><ErrorBox>{loadError}</ErrorBox><Link className="btn" style={{ marginTop: 16 }} href="/agents">Back to agents</Link></div>
          : done && agent ? <Done agent={agent} gateway={me.gateway_url} />
          : (
            <div className="wiz-inner">
              <div style={{ minWidth: 0 }}>
                {step === 0 && <ConnectStep agent={agent} onSaved={update} onNext={() => setStep(1)} toast={toast} />}
                {step === 1 && agent && <DescribeStep agent={agent} onSaved={update} onBack={() => setStep(0)} onNext={() => setStep(2)} />}
                {step === 2 && agent && <EvaluateStep agent={agent} onSaved={update} onBack={() => setStep(1)} onNext={() => setStep(3)} llm={me.llm_enabled} />}
                {step === 3 && agent && <DeployStep agent={agent} onSaved={update} onBack={() => setStep(2)} onDone={() => setDone(true)} role={me.role} />}
              </div>
              <Summary agent={agent} step={step} />
            </div>
          )}
      </div>
    </section>
  );
}

/* Footer shared by every step ----------------------------------------------- */
function Foot({ onBack, hint, next, nextLabel, busy }: { onBack?: () => void; hint: string; next: (() => void) | null; nextLabel: string; busy?: boolean }) {
  return (
    <div className="wiz-foot" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 41 }}>
      {onBack ? <button className="btn" type="button" onClick={onBack}><Icon name="back" />Back</button> : <span />}
      <p>{hint}</p>
      <button className="btn pri lg" type="button" disabled={!next || busy} onClick={() => next?.()}>{busy && <Spinner size={14} />}{nextLabel}</button>
    </div>
  );
}

/* Summary rail ----------------------------------------------------------------- */
function Summary({ agent, step }: { agent: Agent | null; step: number }) {
  const row = (k: string, v: string | null | undefined) => (
    <div><dt>{k}</dt><dd className={v ? "" : "pend"}>{v || "Not yet"}</dd></div>
  );
  const ev = agent?.risk_assessment;
  return (
    <aside className="card summary">
      <div className="sum-h"><div className="sys"><Mark>{protocolOf(agent?.protocol ?? "http").mark}</Mark><div><b>{agent?.name || "New agent"}</b><small>{protocolOf(agent?.protocol ?? "http").name}</small></div></div></div>
      <dl className="sum-l">
        {row("Connection", agent?.last_test?.ok ? `Tested, ${secs(agent.last_test.latency_ms)}` : null)}
        {row("Owner", agent && agent.onboarding_step >= 3 ? agent.owner_name : null)}
        {row("Data access", agent && agent.onboarding_step >= 3 ? `${agent.data_sources.length} source${agent.data_sources.length === 1 ? "" : "s"}` : null)}
        {row("Risk tier", ev ? `Tier ${ev.tier}` : null)}
        {row("Evaluation", agent?.status === "blocked" ? "Failed" : ev && agent?.status !== "evaluating" ? "Passed" : agent?.status === "evaluating" ? "Running" : null)}
        {row("Approval", agent?.status === "approved" ? "Complete" : agent?.status === "awaiting_approval" ? "Waiting" : agent?.status === "rejected" ? "Rejected" : null)}
        {row("Goes live in", "Production")}
      </dl>
      <div className="sum-n"><b>{NOTES[step][0]}</b>{NOTES[step][1]}</div>
    </aside>
  );
}

/* Step 1: connect ------------------------------------------------------------ */
function ConnectStep({ agent, onSaved, onNext, toast }: { agent: Agent | null; onSaved: (a: Agent) => void; onNext: () => void; toast: (m: string) => void }) {
  const [c, setC] = useState<Conn>(() => connFrom(agent));
  const [dirty, setDirty] = useState(!agent);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [test, setTest] = useState<ConnectionTest | null>(agent?.last_test ?? null);
  const set = <K extends keyof Conn>(k: K, v: Conn[K]) => { setC((p) => ({ ...p, [k]: v })); setDirty(true); };
  const locked = !!agent && ["awaiting_approval", "approved", "live", "paused"].includes(agent.status);
  const hasSecret = !!agent?.auth_secret_hint;
  const needsSecret = c.auth_type !== "none" && !hasSecret && (c.auth_type === "oauth2" ? !(c.oauth.token_url && c.oauth.client_id && c.oauth.client_secret) : !c.auth_secret);
  const canTest = c.endpoint_url.trim().length > 8 && !needsSecret && c.protocol !== "bedrock";

  async function save(): Promise<Agent> {
    const body = connPayload(c);
    const a = agent ? await api<Agent>(`/agents/${agent.id}`, { method: "PATCH", json: body })
      : await api<Agent>("/agents", { method: "POST", json: { ...body, onboarding_step: 1 } });
    onSaved(a); setDirty(false); setC((p) => ({ ...p, auth_secret: "", oauth: { ...p.oauth, client_secret: "" } }));
    return a;
  }
  async function runTest() {
    setBusy(true); setErr(null);
    try {
      const a = locked ? agent! : await save();
      const r = await api<ConnectionTest>(`/agents/${a.id}/test`, { method: "POST", json: {} });
      setTest(r);
      onSaved({ ...a, last_test: r });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function next() {
    if (!agent) return;
    if (dirty) { toast("Test the connection again after changing it"); return; }
    try { onSaved(await api<Agent>(`/agents/${agent.id}`, { method: "PATCH", json: { onboarding_step: 2 } })); onNext(); }
    catch (e) { setErr((e as Error).message); }
  }
  const ok = !!test?.ok && !dirty;

  return (
    <>
      <div className="wiz-h"><small>Step 1 of 4</small><h2>Connect your agent</h2><p>Tell Trust AI where the agent runs and how to talk to it. Secrets are encrypted at rest and never shown again.</p></div>
      {locked && <div className="banner warn"><Icon name="lock" /><span>This agent is in release, so its connection is locked. Pause it to make changes.</span></div>}
      <section className="card">
        <div className="fs">
          <h3>Where is it hosted?</h3><p>Pick the option that matches how your agent is served.</p>
          <div className="protos" role="radiogroup" aria-label="Hosting">
            {PROTOCOLS.map((p) => (
              <button key={p.id} type="button" className="proto" role="radio" aria-checked={c.protocol === p.id} disabled={locked || p.id === "bedrock"}
                style={p.id === "bedrock" ? { opacity: 0.55, cursor: "not-allowed" } : undefined} onClick={() => set("protocol", p.id)}>
                <span className="mark m-agent">{p.mark}</span><span><b>{p.name}</b><small>{p.hint}</small></span><span className="rd" />
              </button>
            ))}
          </div>
        </div>
        <div className="fs">
          <h3>Endpoint and access</h3>
          <div className="field"><label className="lab" htmlFor="w-url">Agent URL<small>Required</small></label>
            <div className="inp"><Icon name="link" /><input id="w-url" className="mono" value={c.endpoint_url} disabled={locked} placeholder={PLACEHOLDER[c.protocol]} onChange={(e) => set("endpoint_url", e.target.value)} /></div></div>
          <div className="field f2">
            <div><label className="lab" htmlFor="w-auth">Authentication</label>
              <div className="inp"><select id="w-auth" value={c.auth_type} disabled={locked} onChange={(e) => set("auth_type", e.target.value as AuthType)}>
                <option value="bearer">Bearer token</option><option value="api_key">API key header</option><option value="oauth2">OAuth 2.0 client credentials</option><option value="none">None</option>
              </select></div></div>
            {c.auth_type === "bearer" || c.auth_type === "api_key" ? (
              <div><label className="lab" htmlFor="w-tok">{c.auth_type === "bearer" ? "Token" : "Key"}<small style={hasSecret ? { color: "var(--good)" } : undefined}>{hasSecret ? `Saved, ${agent?.auth_secret_hint}` : "Encrypted at rest"}</small></label>
                <div className="inp"><Icon name="lock" /><input id="w-tok" className="mono" type="password" autoComplete="off" disabled={locked} value={c.auth_secret} placeholder={hasSecret ? "Leave blank to keep the saved value" : ""} onChange={(e) => set("auth_secret", e.target.value)} /></div></div>
            ) : <div />}
          </div>
          {c.auth_type === "api_key" && (
            <div className="field"><label className="lab" htmlFor="w-hdr">Header name</label><div className="inp"><input id="w-hdr" className="mono" value={c.auth_header} disabled={locked} onChange={(e) => set("auth_header", e.target.value)} /></div></div>
          )}
          {c.auth_type === "oauth2" && (
            <>
              <div className="field"><label className="lab" htmlFor="w-tu">Token URL{hasSecret && <small style={{ color: "var(--good)" }}>Saved. Fill all three to replace.</small>}</label><div className="inp"><input id="w-tu" className="mono" value={c.oauth.token_url} disabled={locked} onChange={(e) => set("oauth", { ...c.oauth, token_url: e.target.value })} /></div></div>
              <div className="field f2">
                <div><label className="lab" htmlFor="w-ci">Client ID</label><div className="inp"><input id="w-ci" className="mono" value={c.oauth.client_id} disabled={locked} onChange={(e) => set("oauth", { ...c.oauth, client_id: e.target.value })} /></div></div>
                <div><label className="lab" htmlFor="w-cs">Client secret</label><div className="inp"><Icon name="lock" /><input id="w-cs" className="mono" type="password" autoComplete="off" value={c.oauth.client_secret} disabled={locked} onChange={(e) => set("oauth", { ...c.oauth, client_secret: e.target.value })} /></div></div>
              </div>
              <div className="field"><label className="lab" htmlFor="w-sc">Scope<small>Optional</small></label><div className="inp"><input id="w-sc" className="mono" value={c.oauth.scope} disabled={locked} onChange={(e) => set("oauth", { ...c.oauth, scope: e.target.value })} /></div></div>
            </>
          )}

          <details className="adv">
            <summary><Icon name="chev" />{c.protocol === "http" ? "Request format" : "Advanced"}<small>{c.protocol === "http" ? `JSON body with {{prompt}}, answer ${c.response_key ? `read from ${c.response_key}` : "detected automatically"}` : `Timeout ${c.timeout_s} s`}</small></summary>
            <div className="adv-b">
              {c.protocol === "http" && (
                <div className="field" style={{ marginTop: 0 }}><label className="lab" htmlFor="w-tpl">Request body<small>Use {"{{prompt}}"} and {"{{session_id}}"}</small></label>
                  <textarea id="w-tpl" className="ta mono" style={{ fontFamily: "var(--mono)", fontSize: 13, minHeight: 120 }} value={c.template} disabled={locked} onChange={(e) => set("template", e.target.value)} /></div>
              )}
              {c.protocol === "adk" && (
                <div className="field f2" style={{ marginTop: 0 }}>
                  <div><label className="lab" htmlFor="w-app">App name<small>Required</small></label><div className="inp"><input id="w-app" className="mono" value={c.app_name} disabled={locked} onChange={(e) => set("app_name", e.target.value)} /></div></div>
                  <div><label className="lab" htmlFor="w-uid">User ID<small>Optional</small></label><div className="inp"><input id="w-uid" className="mono" value={c.user_id} placeholder="plumb" disabled={locked} onChange={(e) => set("user_id", e.target.value)} /></div></div>
                </div>
              )}
              {c.protocol === "openai" && (
                <div className="field f2" style={{ marginTop: 0 }}>
                  <div><label className="lab" htmlFor="w-model">Model or deployment</label><div className="inp"><input id="w-model" className="mono" value={c.model} disabled={locked} onChange={(e) => set("model", e.target.value)} /></div></div>
                  <div><label className="lab" htmlFor="w-aref">Foundry agent name<small>Optional</small></label><div className="inp"><input id="w-aref" className="mono" value={c.agent_ref} disabled={locked} onChange={(e) => set("agent_ref", e.target.value)} /></div></div>
                </div>
              )}
              <div className="field f2">
                {c.protocol === "http" ? <div><label className="lab" htmlFor="w-key">Response key<small>Dot path, optional</small></label><div className="inp"><input id="w-key" className="mono" value={c.response_key} placeholder="result.answer" disabled={locked} onChange={(e) => set("response_key", e.target.value)} /></div></div> : <div />}
                <div><label className="lab" htmlFor="w-to">Timeout</label><div className="inp"><input id="w-to" type="number" min={1} max={300} value={c.timeout_s} disabled={locked} onChange={(e) => set("timeout_s", Math.max(1, Math.min(300, Number(e.target.value) || 60)))} /><span className="suf">seconds</span></div></div>
              </div>
            </div>
          </details>

          <div className={`test ${ok ? "ok" : ""}`} style={test && !test.ok && !dirty ? { borderStyle: "solid", borderColor: "color-mix(in srgb,var(--crit) 35%,var(--line))", background: "var(--crit-soft)" } : undefined}>
            <div className="test-h">
              <div><b>{ok ? "Connection works" : test && !test.ok && !dirty ? "The test request failed" : "Test the connection"}</b>
                <small>{ok ? `Answered in ${secs(test!.latency_ms)} with a readable reply` : test && !test.ok && !dirty ? test.error : needsSecret ? "Add the credentials first." : "Trust AI sends one sample request to the agent."}</small></div>
              <button type="button" className={`btn ${ok ? "" : "dark"}`} disabled={!canTest || busy} onClick={runTest}>
                {busy ? <Spinner size={14} /> : <Icon name={ok ? "refresh" : "play"} />}{busy ? "Testing" : ok ? "Test again" : "Send test request"}
              </button>
            </div>
            {test && !dirty && (
              <>
                <ul className="checks">{test.checks.map((k) => <li key={k.label}><span className="ck" style={k.ok ? undefined : { color: "var(--crit)" }}><Icon name={k.ok ? "check" : "x"} /></span>{k.label}</li>)}</ul>
                {test.answer && <div className="note-box" style={{ marginTop: 14, background: "var(--sheet)" }}><b style={{ display: "block", color: "var(--fg)", marginBottom: 4 }}>The agent replied</b>{test.answer.slice(0, 600)}</div>}
              </>
            )}
          </div>
          {err && <div style={{ marginTop: 14 }}><ErrorBox>{err}</ErrorBox></div>}
        </div>
      </section>
      <div style={{ height: 90 }} />
      <Foot hint={ok ? "Connection confirmed." : "A passing connection test is needed to continue."} next={ok ? next : null} nextLabel="Continue" />
    </>
  );
}

/* Step 2: describe ------------------------------------------------------------ */
function DescribeStep({ agent, onSaved, onBack, onNext }: { agent: Agent; onSaved: (a: Agent) => void; onBack: () => void; onNext: () => void }) {
  const locked = ["awaiting_approval", "approved", "live", "paused"].includes(agent.status);
  const [f, setF] = useState({
    name: agent.name === "New agent" ? "" : agent.name, team: agent.team ?? "", purpose: agent.purpose ?? "",
    owner_user_id: agent.owner_user_id ?? "", audience: agent.audience, data_sources: agent.data_sources, tools: agent.tools,
  });
  const [members, setMembers] = useState<Member[]>([]);
  const [custom, setCustom] = useState("");
  const [tool, setTool] = useState<{ name: string; access: "read" | "write" }>({ name: "", access: "read" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Member[]>("/members").then(setMembers).catch(() => {}); }, []);
  const sources = useMemo(() => {
    const all = DATA_PRESETS.map(([d]) => d);
    return [...all, ...f.data_sources.filter((d) => !all.includes(d))];
  }, [f.data_sources]);
  const toggle = (d: string) => setF((p) => ({ ...p, data_sources: p.data_sources.includes(d) ? p.data_sources.filter((x) => x !== d) : [...p.data_sources, d] }));
  const setTools = (t: Tool[]) => setF((p) => ({ ...p, tools: t }));
  const valid = f.name.trim().length > 0 && f.purpose.trim().length >= 10;

  async function next() {
    setBusy(true); setErr(null);
    try {
      const owner = members.find((m) => m.user_id === f.owner_user_id);
      const body: Record<string, unknown> = {
        name: f.name.trim(), team: f.team.trim() || null, purpose: f.purpose.trim(), audience: f.audience,
        owner_user_id: f.owner_user_id || null, owner_name: owner ? owner.display_name || owner.email : agent.owner_name, onboarding_step: 3,
      };
      if (!locked) { body.data_sources = f.data_sources; body.tools = f.tools; }
      onSaved(await api<Agent>(`/agents/${agent.id}`, { method: "PATCH", json: body }));
      onNext();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="wiz-h"><small>Step 2 of 4</small><h2>Describe the agent</h2><p>This tells reviewers what the agent is for, who is accountable, and what it can touch. It also drives the risk tier.</p></div>
      <section className="card">
        <div className="fs"><h3>Basics</h3>
          <div className="field f2">
            <div><label className="lab" htmlFor="w-name">Agent name<small>Required</small></label><div className="inp"><input id="w-name" value={f.name} placeholder="Vendor risk screener" onChange={(e) => setF({ ...f, name: e.target.value })} /></div></div>
            <div><label className="lab" htmlFor="w-team">Team</label><div className="inp"><input id="w-team" value={f.team} placeholder="Third-party risk" onChange={(e) => setF({ ...f, team: e.target.value })} /></div></div>
          </div>
          <div className="field"><label className="lab" htmlFor="w-purpose">What does it do?<small>Required. Used to generate test cases.</small></label>
            <textarea id="w-purpose" className="ta" value={f.purpose} placeholder="Screens new vendors against sanctions lists and summarizes the findings for the risk team." onChange={(e) => setF({ ...f, purpose: e.target.value })} /></div>
          <div className="field f2">
            <div><label className="lab" htmlFor="w-owner">Accountable owner</label><div className="inp"><select id="w-owner" value={f.owner_user_id} onChange={(e) => setF({ ...f, owner_user_id: e.target.value })}>
              {!members.length && <option value={f.owner_user_id}>{agent.owner_name}</option>}
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name || m.email}</option>)}
            </select></div></div>
            <div><label className="lab" htmlFor="w-users">Who will use it?</label><div className="inp"><select id="w-users" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value as Agent["audience"] })}>
              <option value="internal">Internal staff only</option><option value="partners">Partners</option><option value="customers">Customers</option><option value="public">The public</option>
            </select></div></div>
          </div>
        </div>
        <div className="fs"><h3>Data it can reach</h3><p>Select every source the agent can read. Sensitive sources raise the risk tier.</p>
          <div className="chips" style={{ marginTop: 14 }}>
            {sources.map((d) => {
              const sens = DATA_PRESETS.find(([x]) => x === d)?.[1];
              return <button key={d} type="button" className="chk" aria-pressed={f.data_sources.includes(d)} disabled={locked} onClick={() => toggle(d)}><span className="box"><Icon name="check" /></span>{d}{sens && <span className="sens">Sensitive</span>}</button>;
            })}
          </div>
          {!locked && (
            <form className="row" style={{ marginTop: 12, maxWidth: 420 }} onSubmit={(e) => { e.preventDefault(); const v = custom.trim(); if (v && !f.data_sources.includes(v)) setF({ ...f, data_sources: [...f.data_sources, v] }); setCustom(""); }}>
              <div className="inp" style={{ flex: 1, height: 38 }}><input value={custom} placeholder="Add another source" onChange={(e) => setCustom(e.target.value)} aria-label="Add a data source" /></div>
              <button className="btn" type="submit" disabled={!custom.trim()}><Icon name="plus" />Add</button>
            </form>
          )}
        </div>
        <div className="fs"><h3>Tools it can use</h3><p>List the actions the agent can take. Write access raises the risk tier.</p>
          <div style={{ marginTop: 8 }}>
            {f.tools.length === 0 && <p className="muted" style={{ fontSize: 13.5, padding: "10px 0" }}>No tools listed. Add any API or MCP tool the agent can call.</p>}
            {f.tools.map((t, i) => (
              <div className="toolrow" key={t.name + i}>
                <div><b>{t.name}</b><small>{t.access === "write" ? "Can change data" : "Read only"}</small></div>
                <span className="tag" style={t.access === "write" ? { background: "var(--warn-soft)", color: "var(--warn)" } : undefined}>{t.access === "write" ? "Write" : "Read"}</span>
                <Switch checked={t.enabled} label={`Allow ${t.name}`} onChange={(v) => !locked && setTools(f.tools.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} />
                {!locked && <button type="button" className="icon-btn" aria-label={`Remove ${t.name}`} onClick={() => setTools(f.tools.filter((_, j) => j !== i))}><Icon name="trash" /></button>}
              </div>
            ))}
          </div>
          {!locked && (
            <form className="row" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); if (!tool.name.trim()) return; setTools([...f.tools, { name: tool.name.trim(), access: tool.access, enabled: true, description: "" }]); setTool({ name: "", access: "read" }); }}>
              <div className="inp" style={{ flex: 1, maxWidth: 320, height: 38 }}><input className="mono" value={tool.name} placeholder="servicenow.create_ticket" onChange={(e) => setTool({ ...tool, name: e.target.value })} aria-label="Tool name" /></div>
              <div className="seg" role="group" aria-label="Access">
                <button type="button" className={tool.access === "read" ? "on" : ""} onClick={() => setTool({ ...tool, access: "read" })}>Read</button>
                <button type="button" className={tool.access === "write" ? "on" : ""} onClick={() => setTool({ ...tool, access: "write" })}>Write</button>
              </div>
              <button className="btn" type="submit" disabled={!tool.name.trim()}><Icon name="plus" />Add tool</button>
            </form>
          )}
        </div>
      </section>
      {err && <div style={{ marginTop: 14 }}><ErrorBox>{err}</ErrorBox></div>}
      <div style={{ height: 90 }} />
      <Foot onBack={onBack} hint={valid ? "Saved when you continue." : "Add a name and a sentence about what it does."} next={valid ? next : null} nextLabel="Continue" busy={busy} />
    </>
  );
}

/* Step 3: evaluate ------------------------------------------------------------- */
function EvaluateStep({ agent, onSaved, onBack, onNext, llm }: { agent: Agent; onSaved: (a: Agent) => void; onBack: () => void; onNext: () => void; llm: boolean }) {
  const [run, setRun] = useState<EvalRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const active = run && (run.status === "queued" || run.status === "running");

  useEffect(() => {
    api<EvalRun | null>(`/agents/${agent.id}/evaluations/latest`).then((r) => { if (agent.status !== "draft") setRun(r); }).catch(() => {}).finally(() => setLoading(false));
  }, [agent.id, agent.status]);

  useEffect(() => {
    if (!active || !run) return;
    const t = setInterval(async () => {
      try {
        const r = await api<EvalRun>(`/evaluations/${run.id}`);
        setRun(r);
        if (r.status !== "queued" && r.status !== "running") onSaved(await api<Agent>(`/agents/${agent.id}`));
      } catch { /* keep polling */ }
    }, 1200);
    return () => clearInterval(t);
  }, [active, run, agent.id, onSaved]);

  async function start() {
    setStarting(true); setErr(null);
    try {
      const { run_id } = await api<{ run_id: string }>(`/agents/${agent.id}/evaluations`, { method: "POST" });
      setRun(await api<EvalRun>(`/evaluations/${run_id}`));
      onSaved({ ...agent, status: "evaluating" });
    } catch (e) { setErr((e as Error).message); } finally { setStarting(false); }
  }

  const finished = run && !active;
  const passed = finished && run.status === "passed";
  const progress = run ? (finished ? 100 : Math.max(4, run.progress)) : 0;
  const locked = ["awaiting_approval", "approved", "live", "paused"].includes(agent.status);
  const canContinue = locked || agent.status === "evaluated" || agent.status === "rejected";

  return (
    <>
      <div className="wiz-h"><small>Step 3 of 4</small><h2>Evaluate before anyone uses it</h2>
        <p>Trust AI classifies risk, then sends real test prompts to the agent: task accuracy, prompt injection, PII leakage, scope, and latency. {llm ? "Answers are graded by your configured model." : "No LLM key is configured, so answers are graded with built-in rules."}</p></div>
      <section className="card">
        <div className="fs">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div><h3>{finished ? (passed ? "Evaluation complete" : run.status === "error" ? "Evaluation couldn’t finish" : "Evaluation found problems") : active ? "Running suites" : "Evaluation suites"}</h3>
              <p style={{ marginTop: 3, fontSize: 13.5, color: "var(--fg3)" }}>
                {finished ? (passed ? `${run.summary?.passed} of ${run.summary?.total} suites passed.` : run.error || `Failed: ${run.summary?.failed.join(", ")}. Fix the agent and run it again.`)
                  : active ? "This usually takes under a minute." : "Six checks run against the live endpoint you connected."}</p></div>
            {finished && passed ? <Pill tone="good" icon="check">{`${run.summary?.passed} of ${run.summary?.total} passed`}</Pill>
              : !active && !locked && <button className="btn pri" type="button" disabled={starting || loading} onClick={start}>{starting ? <Spinner size={14} /> : <Icon name={finished ? "refresh" : "play"} />}{finished ? "Run again" : "Run evaluation"}</button>}
          </div>
          <div className="bigbar"><i style={{ width: `${progress}%`, background: finished && !passed ? "var(--crit)" : undefined }} /></div>
        </div>
        <div className="fs">
          {loading ? <Skeleton h={300} /> : run ? <EvalList results={run.results} /> : (
            <div className="run">
              {[["Risk classification", "12 dimensions from purpose, audience, data and tools"], ["Task accuracy", "Cases generated from the agent’s purpose"], ["Prompt injection", "Red-team probes with a canary secret"], ["PII leakage", "Requests for personal data the agent must refuse"], ["Scope adherence", "Out-of-scope requests it should decline"], ["Latency", "p95 across every case, 4 s objective"]].map(([t, d]) => (
                <div className="run-i" key={t}><span className="ri"><Icon name="clock" /></span><div><b>{t}</b><small>{d}</small></div><span className="res"><small className="muted">Queued</small></span></div>
              ))}
            </div>
          )}
        </div>
      </section>
      {err && <div style={{ marginTop: 14 }}><ErrorBox>{err}</ErrorBox></div>}
      {finished && agent.risk_assessment && (
        <section className="card mt"><div className="card-h"><h2>Risk classification</h2><span className="sub">Tier {agent.risk_assessment.tier}. {agent.risk_assessment.driver} sets the tier.</span></div><RiskPanel risk={agent.risk_assessment} /></section>
      )}
      <div style={{ height: 90 }} />
      <Foot onBack={onBack} hint={canContinue ? "Ready for release." : active ? "Evaluation is running." : agent.status === "blocked" ? "A failing suite blocks release." : "Run the evaluation to continue."} next={canContinue ? onNext : null} nextLabel="Continue" />
    </>
  );
}

/* Step 4: deploy ---------------------------------------------------------------- */
function DeployStep({ agent, onSaved, onBack, onDone, role }: { agent: Agent; onSaved: (a: Agent) => void; onBack: () => void; onDone: () => void; role: string }) {
  const toast = useToast();
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [roll, setRoll] = useState({ rollout: "gradual" as "gradual" | "all", auto_rollback: true, alerts: false, alert_channel: "" });

  const refresh = useCallback(async () => {
    const r = await api<{ approvals: Approval[] }>(`/agents/${agent.id}/approvals`);
    setApprovals(r.approvals);
  }, [agent.id]);
  useEffect(() => { refresh().catch((e) => setErr((e as Error).message)); }, [refresh]);
  useEffect(() => {
    if (agent.status !== "awaiting_approval") return;
    const t = setInterval(async () => {
      try { await refresh(); const a = await api<Agent>(`/agents/${agent.id}`); if (a.status !== agent.status) onSaved(a); } catch { /* retry */ }
    }, 5000);
    return () => clearInterval(t);
  }, [agent.status, agent.id, refresh, onSaved]);

  async function request() {
    setBusy("req"); setErr(null);
    try { const r = await api<{ approvals: Approval[] }>(`/agents/${agent.id}/approvals`, { method: "POST" }); setApprovals(r.approvals); onSaved(await api<Agent>(`/agents/${agent.id}`)); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  async function decide(a: Approval, decision: "approved" | "rejected") {
    setBusy(a.id); setErr(null);
    try { await api(`/approvals/${a.id}/decision`, { method: "POST", json: { decision } }); await refresh(); onSaved(await api<Agent>(`/agents/${agent.id}`)); toast(decision === "approved" ? "Approved" : "Rejected"); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  async function deploy() {
    setBusy("deploy"); setErr(null);
    try {
      onSaved(await api<Agent>(`/agents/${agent.id}/deploy`, { method: "POST", json: { rollout: roll.rollout, auto_rollback: roll.auto_rollback, alert_channel: roll.alerts && roll.alert_channel.trim() ? roll.alert_channel.trim() : null } }));
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  const tier = agent.risk_tier ?? 3;
  const pending = (approvals ?? []).filter((a) => a.status === "pending");
  const current = (approvals ?? []).filter((a, i, arr) => arr.findIndex((b) => b.required_role === a.required_role) === i);
  const canDecide = (a: Approval) => role === "admin" || role === a.required_role;
  const approved = agent.status === "approved";

  return (
    <>
      <div className="wiz-h"><small>Step 4 of 4</small><h2>Deploy to Production</h2>
        <p>{tier === 1 ? "Tier 1 agents are approved by policy." : tier === 2 ? "Tier 2 agents need approval from a risk owner." : "Tier 3 agents need approval from a risk owner and security."} Then choose how traffic moves to the agent.</p></div>
      <section className="card">
        <div className="fs"><h3>Approval</h3><p>Required by the Production policy for Tier {tier}.</p>
          {!approvals ? <div style={{ marginTop: 12 }}><Skeleton h={64} /></div> : current.length === 0 ? (
            <div className="appr first" style={{ marginTop: 6 }}>
              <span className="av do"><Icon name="sign" /></span>
              <div><b>{agent.status === "approved" ? "Approved by policy" : "No approval requested yet"}</b><small>{tier === 1 ? "Tier 1 needs no sign-off" : `${tier === 2 ? "Risk owner" : "Risk owner and security"} will be asked`}</small></div>
              <div className="end">{agent.status === "evaluated" || agent.status === "rejected" ? <button className="btn" type="button" disabled={busy === "req"} onClick={request}>{busy === "req" ? <Spinner size={13} /> : <Icon name="sign" />}{tier === 1 ? "Confirm" : "Request approval"}</button> : approved ? <Pill tone="good" icon="check">Approved</Pill> : null}</div>
            </div>
          ) : current.map((a, i) => (
            <div key={a.id} className={`appr ${i === 0 ? "first" : ""}`} style={i === 0 ? { marginTop: 6 } : undefined}>
              <span className="av do">{({ admin: "AD", risk_owner: "RO", security: "SC", member: "ME" } as const)[a.required_role]}</span>
              <div><b>{ROLE_LABEL[a.required_role]}</b><small>{a.status === "pending" ? `Requested ${ago(a.requested_at)}` : `${a.status === "approved" ? "Approved" : "Rejected"} by ${a.decided_by_name} ${ago(a.decided_at)}`}</small></div>
              <div className="end row">
                {a.status === "pending" && canDecide(a) ? (<>
                  <button className="btn sm" type="button" disabled={busy === a.id} onClick={() => decide(a, "rejected")}>Reject</button>
                  <button className="btn sm pri" type="button" disabled={busy === a.id} onClick={() => decide(a, "approved")}>{busy === a.id && <Spinner size={13} />}Approve</button></>)
                  : <Pill tone={a.status === "approved" ? "good" : a.status === "rejected" ? "crit" : "warn"} icon={a.status === "approved" ? "check" : a.status === "rejected" ? "x" : "clock"}>{a.status === "pending" ? "Waiting" : a.status === "approved" ? "Approved" : "Rejected"}</Pill>}
              </div>
            </div>
          ))}
          {agent.status === "rejected" && current.length > 0 && <button className="btn" type="button" style={{ marginTop: 12 }} disabled={busy === "req"} onClick={request}><Icon name="refresh" />Request approval again</button>}
          {pending.length > 0 && !pending.some(canDecide) && <p className="help" style={{ marginTop: 12 }}>Approvers see this in their workspace. You can leave and come back; Trust AI keeps your place.</p>}
        </div>
        <div className="fs"><h3>Rollout</h3><p>How traffic moves to {agent.name}.</p>
          <div className="opts" role="radiogroup" aria-label="Rollout">
            <button type="button" className="opt" role="radio" aria-checked={roll.rollout === "gradual"} onClick={() => setRoll({ ...roll, rollout: "gradual" })}>
              <b>Gradual <Pill tone="acc">Recommended</Pill></b><small>10% for 30 minutes, 50% for an hour, then everyone</small><span className="stairs"><i style={{ height: "20%" }} /><i style={{ height: "50%" }} /><i style={{ height: "100%" }} /></span></button>
            <button type="button" className="opt" role="radio" aria-checked={roll.rollout === "all"} onClick={() => setRoll({ ...roll, rollout: "all" })}>
              <b>All at once</b><small>Every request goes to the agent immediately</small><span className="stairs"><i style={{ height: "100%" }} /><i style={{ height: "100%" }} /><i style={{ height: "100%" }} /></span></button>
          </div>
          <div className="toggle-row" style={{ marginTop: 12 }}><div><b>Roll back automatically</b><small>If success falls below 98% for 10 minutes</small></div><Switch checked={roll.auto_rollback} label="Roll back automatically" onChange={(v) => setRoll({ ...roll, auto_rollback: v })} /></div>
          <div className="toggle-row"><div><b>Send alerts</b><small>A Slack channel, email, or webhook URL</small></div><Switch checked={roll.alerts} label="Send alerts" onChange={(v) => setRoll({ ...roll, alerts: v })} /></div>
          {roll.alerts && <div className="field" style={{ marginTop: 8 }}><div className="inp"><input value={roll.alert_channel} placeholder="#agent-ops" onChange={(e) => setRoll({ ...roll, alert_channel: e.target.value })} aria-label="Alert destination" /></div></div>}
        </div>
      </section>
      {err && <div style={{ marginTop: 14 }}><ErrorBox>{err}</ErrorBox></div>}
      <div style={{ height: 90 }} />
      <Foot onBack={onBack} hint={approved ? "Everything is in place." : agent.status === "awaiting_approval" ? "Waiting for approval." : "Request approval to continue."} next={approved ? deploy : null} nextLabel="Deploy to Production" busy={busy === "deploy"} />
    </>
  );
}

/* Done -------------------------------------------------------------------------- */
function Done({ agent, gateway }: { agent: Agent; gateway: string }) {
  const router = useRouter();
  const url = `${gateway}/${agent.slug}/invoke`;
  const curl = `curl -X POST ${url} \\\n  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"input": "Hello", "session_id": "user-123"}'`;
  return (
    <div className="done-wrap">
      <div className="done-ic"><Icon name="check" /></div>
      <h2>{agent.name} is live</h2>
      <p>{agent.rollout?.mode === "gradual" ? "Traffic moves over gradually." : "It takes every request now."} Send requests through the Trust AI gateway so guardrails apply and every call is traced.</p>
      <div className="done-grid">
        <div><small>Risk tier</small><b>Tier {agent.risk_tier}</b></div>
        <div><small>Rollout</small><b>{agent.rollout?.mode === "gradual" ? "Gradual" : "All at once"}</b></div>
        <div><small>Auto rollback</small><b>{agent.rollout?.auto_rollback ? "On" : "Off"}</b></div>
      </div>
      <div style={{ textAlign: "left", marginBottom: 28 }}>
        <div className="codebox" style={{ marginTop: 0 }}><span>POST {url}</span><CopyButton text={url} /></div>
        <div className="code" style={{ marginTop: 10 }}><div className="code-h"><span className="dots"><i /><i /><i /></span>Example request</div><pre style={{ padding: "12px 16px" }}>{curl}</pre></div>
        <div className="help" style={{ marginTop: 10 }}>Callers authenticate with a gateway key. Create one in <Link href="/settings">Settings</Link>.</div>
      </div>
      <div className="row" style={{ justifyContent: "center" }}>
        <button className="btn lg" type="button" onClick={() => { window.location.href = "/onboard"; }}><Icon name="plus" />Onboard another agent</button>
        <button className="btn pri lg" type="button" onClick={() => router.push(`/agents/${agent.id}`)}>Open {agent.name} <Icon name="chev" /></button>
      </div>
    </div>
  );
}
