"use client";
import { useState } from "react";
import { Topbar } from "@/components/Shell";
import { Icon } from "@/components/Icon";
import { CopyButton, ErrorBox, Pill, Skeleton, Spinner, Switch, useToast } from "@/components/ui";
import { useAuth } from "@/components/auth";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { ROLE_LABEL, ago, when } from "@/lib/format";
import type { Member, Role } from "@/lib/types";

interface Key { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }

export default function SettingsPage() {
  const { me, reloadMe } = useAuth();
  const admin = me.role === "admin";
  return (
    <>
      <Topbar crumbs={[{ label: me.org.name }, { label: "Settings" }]} />
      <div className="content view-in">
        <div className="ph"><div><h1>Settings</h1><p>Workspace, people and roles, and the keys your applications use to reach live agents.</p></div></div>
        {!admin && <div className="banner warn" style={{ marginBottom: 24 }}><Icon name="lock" /><span>You’re a {ROLE_LABEL[me.role].toLowerCase()} in this workspace. Only admins can change these settings.</span></div>}
        <Workspace admin={admin} onSaved={reloadMe} />
        <People admin={admin} meId={me.user.id} joinCode={me.org.settings.join_code ?? null} />
        <Keys admin={admin} gateway={me.gateway_url} />
        <section className="card mt"><div className="card-h"><h2>Evaluation model</h2><span className="sub">Used to generate test cases and grade answers</span></div>
          <div className="card-b row" style={{ gap: 14 }}>
            <Pill tone={me.llm_enabled ? "good" : "warn"} dot>{me.llm_enabled ? "Connected" : "Not configured"}</Pill>
            <span className="muted" style={{ fontSize: 13.5 }}>{me.llm_enabled ? "Evaluations use the model configured on the API server." : "Evaluations fall back to built-in rules. Set LLM_API_KEY on the API server to grade answers with a model."}</span>
          </div>
        </section>
      </div>
    </>
  );
}

function Workspace({ admin, onSaved }: { admin: boolean; onSaved: () => Promise<void> }) {
  const { me } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(me.org.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const self = me.org.settings.allow_self_approval !== false;
  async function save(body: Record<string, unknown>, msg: string) {
    setBusy(true); setErr(null);
    try { await api("/org", { method: "PATCH", json: body }); await onSaved(); toast(msg); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className="card"><div className="card-h"><h2>Workspace</h2></div>
      <div className="card-b">
        <form className="row" style={{ alignItems: "flex-end", maxWidth: 560 }} onSubmit={(e) => { e.preventDefault(); save({ name: name.trim() }, "Workspace renamed"); }}>
          <div style={{ flex: 1 }}><label className="lab" htmlFor="org-name">Name</label><div className="inp"><input id="org-name" value={name} disabled={!admin} onChange={(e) => setName(e.target.value)} /></div></div>
          {admin && <button className="btn" type="submit" style={{ height: 44 }} disabled={busy || !name.trim() || name.trim() === me.org.name}>Save</button>}
        </form>
        <div className="toggle-row" style={{ marginTop: 18, maxWidth: 760 }}>
          <div><b>Let people approve agents they submitted</b><small>Useful for small teams. Turn off to require a second person for every release.</small></div>
          <Switch checked={self} label="Allow self-approval" onChange={(v) => admin && save({ allow_self_approval: v }, v ? "Self-approval allowed" : "Self-approval turned off")} />
        </div>
        {err && <div style={{ marginTop: 14 }}><ErrorBox>{err}</ErrorBox></div>}
      </div>
    </section>
  );
}

function People({ admin, meId, joinCode }: { admin: boolean; meId: string; joinCode: string | null }) {
  const { data, error, setData } = useApi<Member[]>("/members");
  const { reloadMe } = useAuth();
  const toast = useToast();
  const [code, setCode] = useState<string | null>(joinCode);
  const [err, setErr] = useState<string | null>(null);
  async function setRole(m: Member, role: Role) {
    setErr(null);
    try { setData(await api<Member[]>(`/members/${m.user_id}`, { method: "PATCH", json: { role } })); toast(`${m.display_name || m.email} is now ${ROLE_LABEL[role].toLowerCase()}`); if (m.user_id === meId) await reloadMe(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function rotate() {
    setErr(null);
    try { const r = await api<{ code: string }>("/invite-code", { method: "POST" }); setCode(r.code); toast(code ? "New invite code created" : "Invite code created"); }
    catch (e) { setErr((e as Error).message); }
  }
  return (
    <section className="card mt"><div className="card-h"><h2>People</h2><span className="sub">Risk owners and security approve releases. Admins can do everything.</span></div>
      {admin && (
        <div className="card-b" style={{ paddingTop: 0 }}>
          <div className="note-box">
            <b style={{ display: "block", color: "var(--fg)", marginBottom: 4 }}>Invite teammates</b>
            They sign up on the Plumb sign-in page and enter this code. They join as members; change their role here.
            {code ? <div className="codebox"><span>{code}</span><CopyButton text={code} /><button className="btn sm" type="button" onClick={rotate}><Icon name="refresh" />New code</button></div>
              : <div style={{ marginTop: 12 }}><button className="btn" type="button" onClick={rotate}><Icon name="plus" />Create invite code</button></div>}
          </div>
        </div>
      )}
      {error && <div className="card-b"><ErrorBox>{error}</ErrorBox></div>}
      {err && <div className="card-b" style={{ paddingTop: 0 }}><ErrorBox>{err}</ErrorBox></div>}
      {!data ? <div style={{ padding: 22 }}><Skeleton h={120} /></div> : (
        <div className="tw"><table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Role</th></tr></thead>
          <tbody>{data.map((m) => (
            <tr key={m.user_id}>
              <td><div className="sys"><span className="av pr" style={{ width: 32, height: 32, fontSize: 12 }}>{(m.display_name || m.email).split(/[\s@.]+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()}</span><div><b>{m.display_name || m.email.split("@")[0]}{m.user_id === meId && <span className="muted" style={{ fontWeight: 400 }}> (you)</span>}</b></div></div></td>
              <td className="muted">{m.email}</td>
              <td className="muted">{when(m.created_at)}</td>
              <td>{admin ? (
                <div className="inp" style={{ height: 36, width: 170 }}><select value={m.role} aria-label={`Role for ${m.email}`} onChange={(e) => setRole(m, e.target.value as Role)}>
                  {(["admin", "risk_owner", "security", "member"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select></div>) : ROLE_LABEL[m.role]}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function Keys({ admin, gateway }: { admin: boolean; gateway: string }) {
  const { data, error, reload } = useApi<Key[]>("/keys");
  const toast = useToast();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Key | null>(null);
  async function create() {
    setBusy(true); setErr(null);
    try { const r = await api<{ key: string }>("/keys", { method: "POST", json: { name: name.trim() } }); setCreated(r.key); setName(""); await reload(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function revoke(k: Key) {
    try { await api(`/keys/${k.id}`, { method: "DELETE" }); toast("Key revoked"); await reload(); }
    catch (e) { setErr((e as Error).message); } finally { setRevoking(null); }
  }
  return (
    <section className="card mt"><div className="card-h"><h2>Gateway keys</h2><span className="sub">Applications send this key to call live agents through {gateway}</span></div>
      <div className="card-b" style={{ paddingTop: 0 }}>
        {admin && (
          <form className="row" style={{ maxWidth: 560, marginTop: 4 }} onSubmit={(e) => { e.preventDefault(); create(); }}>
            <div className="inp" style={{ flex: 1 }}><input value={name} placeholder="Name, for example Support web app" onChange={(e) => setName(e.target.value)} aria-label="Key name" /></div>
            <button className="btn pri" type="submit" style={{ height: 44 }} disabled={busy || !name.trim()}>{busy ? <Spinner size={14} /> : <Icon name="key" />}Create key</button>
          </form>
        )}
        {created && (
          <div className="banner good" style={{ marginTop: 16, marginBottom: 0, display: "block" }}>
            <b>Copy this key now.</b> It won’t be shown again.
            <div className="codebox"><span>{created}</span><CopyButton text={created} /><button className="btn sm" type="button" onClick={() => setCreated(null)}>Done</button></div>
          </div>
        )}
        {(error || err) && <div style={{ marginTop: 14 }}><ErrorBox>{error || err}</ErrorBox></div>}
      </div>
      {!data ? <div style={{ padding: 22 }}><Skeleton h={80} /></div> : data.length === 0 ? <div className="empty" style={{ borderTop: "1px solid var(--line)" }}>No keys yet.</div> : (
        <div className="tw"><table className="tbl">
          <thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th>Status</th><th className="r" /></tr></thead>
          <tbody>{data.map((k) => (
            <tr key={k.id}>
              <td><b>{k.name}</b></td>
              <td className="mono muted">{k.prefix}…</td>
              <td className="muted">{when(k.created_at)}</td>
              <td className="muted">{k.last_used_at ? ago(k.last_used_at) : "Never"}</td>
              <td>{k.revoked_at ? <Pill tone="mute">Revoked</Pill> : <Pill tone="good" dot>Active</Pill>}</td>
              <td className="r">{admin && !k.revoked_at && <button className="btn sm" type="button" onClick={() => setRevoking(k)}><Icon name="trash" />Revoke</button>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {revoking && (
        <div className="dlg-back" role="dialog" aria-modal="true" aria-labelledby="rv-h" onClick={() => setRevoking(null)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <h3 id="rv-h">Revoke {revoking.name}?</h3>
            <p>Applications using this key stop reaching your agents immediately. This can’t be undone.</p>
            <div className="row"><button className="btn" type="button" onClick={() => setRevoking(null)}>Cancel</button><button className="btn pri" type="button" style={{ background: "var(--crit)", borderColor: "var(--crit)" }} onClick={() => revoke(revoking)}>Revoke key</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
