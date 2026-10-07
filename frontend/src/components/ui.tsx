"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Icon } from "./Icon";
import { STATUS } from "@/lib/format";
import type { AgentStatus } from "@/lib/types";

export function Pill({ tone, icon, dot, children }: { tone: string; icon?: string; dot?: boolean; children: React.ReactNode }) {
  return (
    <span className={`pill p-${tone}`}>
      {icon ? <Icon name={icon} /> : dot ? <i /> : null}
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: AgentStatus }) {
  const s = STATUS[status];
  return <Pill tone={s.tone} icon={s.icon} dot={!s.icon}>{s.label}</Pill>;
}

export function Tier({ tier }: { tier: number | null }) {
  if (!tier) return <span className="na">Not rated</span>;
  return (
    <span className="tier">
      <span className={`tbars t${tier}`}><i /><i /><i /></span>Tier {tier}
    </span>
  );
}

export function Mark({ kind = "agent", children, size }: { kind?: "agent" | "model" | "mcp"; children: React.ReactNode; size?: number }) {
  return (
    <span className={`mark m-${kind}`} style={size ? { width: size, height: size, borderRadius: size * 0.29 } : { width: 38, height: 38, borderRadius: 11 }}>
      {children}
    </span>
  );
}

export function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div className="err" role="alert"><Icon name="alert" /><span>{children}</span></div>;
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spin" style={{ width: size, height: size }} />;
}

export function Skeleton({ h = 120 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h }} />;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

/* Toasts ------------------------------------------------------------------- */
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className={`toast ${msg ? "show" : ""}`} role="status"><Icon name="check" /><span>{msg}</span></div>
    </ToastCtx.Provider>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="btn sm"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Select the text to copy it"); }
      }}
    >
      <Icon name="copy" />{label}
    </button>
  );
}
