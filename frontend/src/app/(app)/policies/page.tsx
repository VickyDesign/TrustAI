"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/Shell";
import { Icon } from "@/components/Icon";
import { ErrorBox, Pill, Skeleton } from "@/components/ui";
import { useAuth } from "@/components/auth";
import { useApi } from "@/lib/useApi";
import { approvalText } from "@/lib/policy";
import type { Policy } from "@/lib/types";

export default function PoliciesPage() {
  const { me } = useAuth();
  const router = useRouter();
  const { data, error } = useApi<Policy[]>("/policies");
  const admin = me.role === "admin";
  return (
    <>
      <Topbar crumbs={[{ label: me.org.name }, { label: "Policies" }]} />
      <div className="content view-in">
        <div className="ph">
          <div><h1>Policies</h1><p>A policy sets the guardrails on live traffic, the pass marks an agent must meet in evaluation, and who has to approve it at each risk tier. Every agent uses one policy.</p></div>
          {admin && <Link className="btn pri lg" href="/policies/new"><Icon name="plus" />New policy</Link>}
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <section className="card">
          {!data ? <div style={{ padding: 22 }}><Skeleton h={160} /></div> : (
            <div className="tw"><table className="tbl">
              <thead><tr><th>Policy</th><th>Guardrails</th><th>Pass marks</th><th>Approvals by tier</th><th className="r">Agents</th><th className="r" /></tr></thead>
              <tbody>{data.map((p) => {
                const g = p.rules.guardrails, e = p.rules.evaluation, a = p.rules.approvals;
                return (
                  <tr key={p.id} className="click" onClick={() => router.push(`/policies/${p.id}`)}>
                    <td style={{ maxWidth: 340 }}>
                      <div className="sys"><span className="mark m-agent" style={{ width: 38, height: 38, borderRadius: 11 }}><Icon name="shield" /></span>
                        <div style={{ minWidth: 0 }}><b>{p.name} {p.is_default && <Pill tone="acc">Default</Pill>}</b><small style={{ whiteSpace: "normal" }}>{p.description || "No description"}</small></div></div>
                    </td>
                    <td><div style={{ display: "grid", gap: 2, fontSize: 13.5, padding: "10px 0" }}>
                      <span>{g.block_jailbreak ? "Blocks jailbreaks" : <span className="muted">Jailbreak blocking off</span>}</span>
                      <span>{g.redact_pii ? (g.pii_kinds.length === 6 ? "Hides all personal data" : `Hides ${g.pii_kinds.length} kinds of personal data`) : <span className="muted">Personal data not hidden</span>}</span>
                      {g.blocked_topics.length > 0 && <span>{g.blocked_topics.length} blocked topic{g.blocked_topics.length === 1 ? "" : "s"}</span>}
                    </div></td>
                    <td><div style={{ display: "grid", gap: 2, fontSize: 13.5, padding: "10px 0" }}>
                      <span>Accuracy {e.accuracy_min}%+</span><span>Your questions {e.questions_min}%+</span><span>p95 under {e.latency_p95_ms / 1000} s</span>
                    </div></td>
                    <td><div style={{ display: "grid", gap: 2, fontSize: 13.5, padding: "10px 0" }}>
                      <span>Tier 1: {approvalText(a["1"])}</span><span>Tier 2: {approvalText(a["2"])}</span><span>Tier 3: {approvalText(a["3"])}</span>
                    </div></td>
                    <td className="r tn">{p.agent_count}</td>
                    <td className="r"><Icon name="chev" className="ic muted" /></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
          {data && <div className="card-f"><span>{data.length} {data.length === 1 ? "policy" : "policies"}. Agents without a chosen policy use the default.</span></div>}
        </section>
      </div>
    </>
  );
}
