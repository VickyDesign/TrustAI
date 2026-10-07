"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { Icon, Logo } from "./Icon";
import { useAuth } from "./auth";
import { ROLE_LABEL } from "@/lib/format";

const MenuContext = createContext<() => void>(() => {});

const NAV = [
  { href: "/", label: "Overview", icon: "grid" },
  { href: "/agents", label: "Agents", icon: "bot" },
  { href: "/policies", label: "Policies", icon: "shield" },
  { href: "/settings", label: "Settings", icon: "gear" },
];

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { me, signOut } = useAuth();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="app">
      <aside className={`side ${open ? "open" : ""}`} aria-label="Main navigation">
        <div className="brand"><Logo /><div><b>Trust AI</b><small>Powered by Random Trees</small></div></div>
        <div className="ws" aria-label="Workspace">
          <span className="ws-av">{initials(me.org.name)}</span>
          <span><b>{me.org.name}</b><small>{ROLE_LABEL[me.role]}</small></span>
        </div>
        <Link className="btn pri onb-cta" href="/onboard"><Icon name="plus" />Onboard agent</Link>
        <nav className="ng">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`ni ${active(n.href) ? "on" : ""}`}><Icon name={n.icon} />{n.label}</Link>
          ))}
        </nav>
        <div style={{ marginTop: "auto" }} />
        <div className="me">
          <span className="av pr">{initials(me.user.name)}</span>
          <div style={{ minWidth: 0, flex: 1 }}><b>{me.user.name}</b><small style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{me.user.email}</small></div>
          <button className="icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
        </div>
      </aside>
      <div className="main">
        <div className="sheet">
          <MenuContext.Provider value={() => setOpen((o) => !o)}>{children}</MenuContext.Provider>
        </div>
      </div>
    </div>
  );
}


export function Topbar({ crumbs }: { crumbs: { label: string; href?: string }[] }) {
  const toggle = useContext(MenuContext);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setDark(t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("trustai-theme", next); } catch {}
    setDark(!dark);
  };
  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" type="button" onClick={toggle} aria-label="Open navigation"><Icon name="menu" /></button>
      <div className="crumb">
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: "contents" }}>
            {i > 0 && <Icon name="chev" />}
            {c.href ? <Link href={c.href} style={{ color: "var(--fg3)" }}>{c.label}</Link> : <b>{c.label}</b>}
          </span>
        ))}
      </div>
      <span style={{ marginLeft: "auto" }} />
      <span className="env"><i />Production</span>
      <button className="icon-btn" type="button" onClick={flip} aria-label="Switch light or dark theme"><Icon name={dark ? "sun" : "moon"} /></button>
    </header>
  );
}
