"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Topbar } from "@/components/Shell";
import { Icon } from "@/components/Icon";
import { ErrorBox, Pill, Skeleton, Spinner, Switch, useToast } from "@/components/ui";
import { useAuth } from "@/components/auth";
import { api } from "@/lib/api";
import { DEFAULT_RULES, PII_KINDS, PII_LABEL } from "@/lib/policy";
import type { Policy, PolicyRules, Role } from "@/lib/types";

const MARKS: { key: keyof PolicyRules["evaluation"]; label: string; help: string; suffix: string; min: number; max: number }[] = [
  { key: "accuracy_min", label: "Task accuracy", help: "Share of realistic requests the agent must answer well", suffix: "% or more", min: 0, max: 100 },
  { key: "questions_min", label: "Your test questions", help: "Share of the owner's test questions it must answer correctly", suffix: "% or more", min: 0, max: 100 },
  { key: "injection_min", label: "Prompt injection", help: "Share of attack prompts it must resist", suffix: "% or more", min: 0, max: 100 },
  { key: "scope_min", label: "Out-of-scope requests", help: "Share of harmful or off-topic requests it must decline", suffix: "% or more", min: 0, max: 100 },
  { key: "pii_max_leaks", label: "Personal data leaks", help: "Answers that may contain personal data", suffix: "at most", min: 0, max: 5 },
];

export default function PolicyEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const { me } = useAuth();
  const admin = me.role === "admin";
  const router = useRouter();
  const toast = useToast();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [rules, setRules] = useState<PolicyRules>(DEFAULT_RULES);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (isNew) return;
    api<Policy>(`/policies/${id}`).then((p) => { setPolicy(p); setName(p.name); setDesc(p.description ?? ""); setRules(p.rules); })
      .catch((e) => setLoadErr((e as Error).message));
  }, [id, isNew]);

  const g = rules.guardrails, e = rules.evaluation;
  const setG = (patch: Partial<PolicyRules["guardrails"]>) => setRules({ ...rules, guardrails: { ...g, ...patch } });
  const setE = (patch: Partial<PolicyRules["evaluation"]>) => setRules({ ...rules, evaluation: { ...e, ...patch } });
  const toggleRole = (tier: "1" | "2" | "3", role: Role) => {
    const cur = rules.approvals[tier];
    setRules({ ...rules, approvals: { ...rules.approvals, [tier]: cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role] } });
  };
  const addTopic = () => {
    const t = topic.trim();
    if (t && !g.blocked_topics.some((x) => x.toLowerCase() === t.toLowerCase())) setG({ blocked_topics: [...g.blocked_topics, t] });
    setTopic("");
  };

  async function save() {
    setBusy(true); setErr(null);
    try {
      const body = { name: name.trim(), description: desc.trim(), rules };
      const saved = isNew ? await api<Policy>("/policies", { method: "POST", json: body })
        : await api<Policy>(`/policies/${id}`, { method: "PATCH", json: body });
      toast(isNew ? "Policy created" : "Policy saved");
      if (isNew) router.replace(`/policies/${saved.id}`); else { setPolicy(saved); setRules(saved.rules); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function makeDefault() {
    setBusy(true);
    try { await api(`/policies/${id}/default`, { method: "POST" }); setPolicy(policy && { ...policy, is_default: true }); toast("This is now the default policy"); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api(`/policies/${id}`, { method: "DELETE" }); toast("Policy deleted"); router.push("/policies"); }
    catch (e) { setErr((e as Error).message); setBusy(false); setConfirmDelete(false); }
  }

  const title = isNew ? "New policy" : policy?.name ?? "Policy";
  if (loadErr) return (<><Topbar crumbs={[{ label: "Policies", href: "/policies" }, { label: "Not found" }]} /><div className="content"><ErrorBox>{loadErr}</ErrorBox></div></>);
  if (!isNew && !policy) return (<><Topbar crumbs={[{ label: "Policies", href: "/policies" }, { label: "Loading" }]} /><div className="content"><Skeleton h={500} /></div></>);

  return (
    <>
      <Topbar crumbs={[{ label: "Policies", href: "/policies" }, { label: title }]} />
      <div className="content view-in" style={{ maxWidth: 1100 }}>
        <div className="ph">
          <div><h1>{title} {policy?.is_default && <Pill tone="acc">Default</Pill>}</h1>
            <p>{isNew ? "Set the guardrails, pass marks and approvals. You can pick this policy for any agent while onboarding it." : `Used by ${policy!.agent_count} agent${policy!.agent_count === 1 ? "" : "s"}. Changes to guardrails apply to live traffic straight away; pass marks apply from the next evaluation.`}</p></div>
          {admin && <div className="row">
            {!isNew && !policy?.is_default && <button className="btn" type="button" disabled={busy} onClick={makeDefault}>Make default</button>}
            <button className="btn pri lg" type="button" disabled={busy || !name.trim()} onClick={save}>{busy && <Spinner size={14} />}{isNew ? "Create policy" : "Save changes"}</button>
          </div>}
        </div>
        {!admin && <div className="banner warn" style={{ marginBottom: 20 }}><Icon name="lock" /><span>Only admins can change policies.</span></div>}
        {err && <div style={{ marginBottom: 16 }}><ErrorBox>{err}</ErrorBox></div>}

        <fieldset disabled={!admin} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "grid", gap: 24 }}>
          <section className="card"><div className="card-h"><h2>Details</h2></div>
            <div className="card-b" style={{ paddingTop: 0 }}>
              <div className="field f2" style={{ marginTop: 0 }}>
                <div><label className="lab" htmlFor="p-name">Name<small>Required</small></label><div className="inp"><input id="p-name" value={name} placeholder="Customer-facing" onChange={(ev) => setName(ev.target.value)} /></div></div>
                <div><label className="lab" htmlFor="p-desc">Description</label><div className="inp"><input id="p-desc" value={desc} placeholder="For agents that talk to customers" onChange={(ev) => setDesc(ev.target.value)} /></div></div>
              </div>
            </div>
          </section>

          <section className="card"><div className="card-h"><h2>Guardrails</h2><span className="sub">Applied to every live request through the gateway</span></div>
            <div className="card-b" style={{ paddingTop: 0 }}>
              <div className="toggle-row"><div><b>Block jailbreak attempts</b><small>Stops messages that try to override the agent’s instructions</small></div><Switch checked={g.block_jailbreak} label="Block jailbreak attempts" onChange={(v) => admin && setG({ block_jailbreak: v })} /></div>
              <div className="toggle-row"><div><b>Hide personal data</b><small>Replaces personal data in messages and answers with a placeholder</small></div><Switch checked={g.redact_pii} label="Hide personal data" onChange={(v) => admin && setG({ redact_pii: v })} /></div>
              {g.redact_pii && (
                <div className="chips" style={{ margin: "4px 0 10px" }}>
                  {PII_KINDS.map((k) => (
                    <button key={k} type="button" className="chk" aria-pressed={g.pii_kinds.includes(k)}
                      onClick={() => setG({ pii_kinds: g.pii_kinds.includes(k) ? g.pii_kinds.filter((x) => x !== k) : [...g.pii_kinds, k] })}>
                      <span className="box"><Icon name="check" /></span>{PII_LABEL[k]}</button>
                  ))}
                </div>
              )}
              <div className="field">
                <label className="lab" htmlFor="p-topic">Blocked topics<small>Requests and answers that mention these are stopped</small></label>
                <div className="row" style={{ gap: 8 }}>
                  <div className="inp" style={{ flex: 1 }}><input id="p-topic" value={topic} placeholder="For example: crypto, medical advice, competitors" onChange={(ev) => setTopic(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); addTopic(); } }} /></div>
                  <button className="btn" type="button" style={{ height: 44 }} disabled={!topic.trim()} onClick={addTopic}><Icon name="plus" />Add</button>
                </div>
                {g.blocked_topics.length > 0 && (
                  <div className="chips" style={{ marginTop: 10 }}>
                    {g.blocked_topics.map((t) => (
                      <span key={t} className="tag" style={{ height: 30, gap: 6, fontSize: 13 }}>{t}
                        {admin && <button type="button" className="link-btn" aria-label={`Remove ${t}`} onClick={() => setG({ blocked_topics: g.blocked_topics.filter((x) => x !== t) })} style={{ display: "grid", placeItems: "center" }}><Icon name="x" /></button>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="card"><div className="card-h"><h2>Evaluation pass marks</h2><span className="sub">An agent that misses any of these is blocked from release</span></div>
            <div className="card-b" style={{ paddingTop: 0 }}>
              {MARKS.map((m) => (
                <div className="toggle-row" key={m.key}>
                  <div><b>{m.label}</b><small>{m.help}</small></div>
                  <div className="inp" style={{ width: 190, height: 40 }}>
                    {m.suffix === "at most" && <span className="suf">at most</span>}
                    <input type="number" min={m.min} max={m.max} value={e[m.key]} aria-label={m.label}
                      onChange={(ev) => setE({ [m.key]: Math.max(m.min, Math.min(m.max, Number(ev.target.value) || 0)) } as Partial<PolicyRules["evaluation"]>)} style={{ textAlign: "right" }} />
                    {m.suffix !== "at most" && <span className="suf">{m.suffix}</span>}
                  </div>
                </div>
              ))}
              <div className="toggle-row">
                <div><b>Response time</b><small>The slowest 5% of answers must arrive within this time</small></div>
                <div className="inp" style={{ width: 190, height: 40 }}><span className="suf">under</span>
                  <input type="number" min={0.5} max={60} step={0.5} value={e.latency_p95_ms / 1000} aria-label="Response time in seconds"
                    onChange={(ev) => setE({ latency_p95_ms: Math.round(Math.max(0.5, Math.min(60, Number(ev.target.value) || 4)) * 1000) })} style={{ textAlign: "right" }} /><span className="suf">seconds</span></div>
              </div>
            </div>
          </section>

          <section className="card"><div className="card-h"><h2>Approvals</h2><span className="sub">Who must sign off before release, by risk tier. Admins can approve anything.</span></div>
            <div className="card-b" style={{ paddingTop: 0 }}>
              {(["1", "2", "3"] as const).map((t) => (
                <div className="toggle-row" key={t}>
                  <div><b>Tier {t}, {t === "1" ? "low" : t === "2" ? "medium" : "high"} risk</b><small>{rules.approvals[t].length === 0 ? "Released without approval" : `Needs ${rules.approvals[t].length} approval${rules.approvals[t].length > 1 ? "s" : ""}`}</small></div>
                  <div className="chips">
                    {(["risk_owner", "security"] as Role[]).map((r) => (
                      <button key={r} type="button" className="chk" aria-pressed={rules.approvals[t].includes(r)} onClick={() => toggleRole(t, r)}>
                        <span className="box"><Icon name="check" /></span>{r === "risk_owner" ? "Risk owner" : "Security"}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </fieldset>

        {admin && !isNew && !policy?.is_default && (
          <div style={{ marginTop: 24 }}><button className="btn" type="button" onClick={() => setConfirmDelete(true)}><Icon name="trash" />Delete policy</button></div>
        )}
      </div>
      {confirmDelete && (
        <div className="dlg-back" role="dialog" aria-modal="true" aria-labelledby="pd-h" onClick={() => !busy && setConfirmDelete(false)}>
          <div className="dlg" onClick={(ev) => ev.stopPropagation()}>
            <h3 id="pd-h">Delete {policy?.name}?</h3>
            <p>Agents that use it switch to the default policy. Live agents get the default guardrails straight away.</p>
            <div className="row"><button className="btn" type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn pri" type="button" disabled={busy} style={{ background: "var(--crit)", borderColor: "var(--crit)" }} onClick={remove}>Delete policy</button></div>
          </div>
        </div>
      )}
    </>
  );
}
