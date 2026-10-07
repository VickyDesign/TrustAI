"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Topbar } from "@/components/Shell";
import { Icon } from "@/components/Icon";
import { ErrorBox, Skeleton } from "@/components/ui";
import { AgentTable } from "@/components/agent-parts";
import { useAuth } from "@/components/auth";
import { useApi } from "@/lib/useApi";
import { isLive } from "@/lib/format";
import type { Agent } from "@/lib/types";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "decision", label: "Needs a decision" },
  { id: "draft", label: "In setup" },
] as const;

export default function AgentsPage() {
  const { me } = useAuth();
  const { data, error } = useApi<Agent[]>("/agents", { pollMs: 30000 });
  const [f, setF] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [q, setQ] = useState("");
  const list = useMemo(() => (data ?? []).filter((a) => {
    const okF = f === "all" || (f === "live" && isLive(a)) ||
      (f === "decision" && ["awaiting_approval", "blocked", "evaluated", "approved", "rejected"].includes(a.status)) ||
      (f === "draft" && ["draft", "evaluating"].includes(a.status));
    return okF && `${a.name} ${a.team ?? ""} ${a.owner_name ?? ""}`.toLowerCase().includes(q.toLowerCase());
  }), [data, f, q]);

  return (
    <>
      <Topbar crumbs={[{ label: me.org.name }, { label: "Agents" }]} />
      <div className="content view-in">
        <div className="ph">
          <div><h1>Agents</h1><p>Every agent in {me.org.name}. Open one to see how it’s doing, or pick up a setup where you left off.</p></div>
          <Link className="btn pri lg" href="/onboard"><Icon name="plus" />Onboard agent</Link>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <section className="card">
          <div className="tbl-tools">
            <div className="seg" role="group" aria-label="Filter agents">
              {FILTERS.map((x) => <button key={x.id} className={f === x.id ? "on" : ""} onClick={() => setF(x.id)}>{x.label}</button>)}
            </div>
            <label className="search" style={{ marginLeft: "auto" }}><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, team, or owner" aria-label="Filter agents" /></label>
          </div>
          {!data ? <div style={{ padding: 22 }}><Skeleton h={200} /></div> :
            data.length === 0 ? <div className="empty"><p>No agents yet.</p><Link className="btn pri" style={{ marginTop: 14 }} href="/onboard"><Icon name="plus" />Onboard your first agent</Link></div>
              : <AgentTable agents={list} />}
          {data && data.length > 0 && <div className="card-f"><span>{list.length} of {data.length} agents</span></div>}
        </section>
      </div>
    </>
  );
}
