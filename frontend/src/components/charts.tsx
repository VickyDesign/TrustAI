"use client";
import { useEffect, useRef, useState } from "react";

export interface Series { name: string; data: (number | null)[]; color: string; fill?: boolean; width?: number; format: (v: number) => string }

/** Responsive SVG line chart with an area fill, a dashed objective line and a hover crosshair. */
export function LineChart({ series, labels, max, ticks, tickFormat, threshold, height = 280, label }: {
  series: Series[]; labels: string[]; max: number; ticks: number[]; tickFormat: (v: number) => string;
  threshold?: number; height?: number; label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const n = Math.max(1, labels.length);
  const pl = 48, pr = 18, pt = 12, pb = 30, iw = w - pl - pr, ih = height - pt - pb;
  const x = (i: number) => pl + (i + 0.5) * (iw / n);
  const y = (v: number) => pt + ih - (Math.min(v, max) / max) * ih;
  const step = Math.ceil(n / (w > 1000 ? 10 : 6));
  const id = label.replace(/\W/g, "");
  return (
    <div className="chart" ref={ref}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={label}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.floor(((e.clientX - r.left - pl) / iw) * n);
          if (i >= 0 && i < n) setHover({ i, x: e.clientX - r.left, y: e.clientY - r.top }); else setHover(null);
        }}
        onMouseLeave={() => setHover(null)}>
        <defs>
          {series.map((s, k) => (
            <linearGradient key={k} id={`g${id}${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity=".22" /><stop offset="1" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line className="gridl" x1={pl} x2={w - pr} y1={y(t)} y2={y(t)} />
            <text className="ax" x={pl - 10} y={y(t) + 4} textAnchor="end">{tickFormat(t)}</text>
          </g>
        ))}
        {threshold !== undefined && <line x1={pl} x2={w - pr} y1={y(threshold)} y2={y(threshold)} stroke="var(--crit)" strokeWidth={1.25} strokeDasharray="5 4" />}
        {series.map((s, k) => {
          const pts = s.data.map((v, i) => (v === null ? null : [x(i), y(v)] as [number, number]));
          const segs: string[] = [];
          let cur = "";
          pts.forEach((p) => { if (!p) { if (cur) segs.push(cur); cur = ""; } else cur += (cur ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); });
          if (cur) segs.push(cur);
          return (
            <g key={k}>
              {s.fill && segs.map((d, j) => {
                const xs = d.match(/[ML]([\d.]+) /g)!.map((m) => parseFloat(m.slice(1)));
                return <path key={j} d={`${d}L${xs[xs.length - 1]} ${pt + ih}L${xs[0]} ${pt + ih}Z`} fill={`url(#g${id}${k})`} />;
              })}
              {segs.map((d, j) => <path key={j} d={d} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeLinejoin="round" strokeLinecap="round" />)}
              {segs.length === 0 || pts.filter(Boolean).length < 2 ? pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={3} fill={s.color} />) : null}
            </g>
          );
        })}
        <line x1={pl} x2={w - pr} y1={pt + ih + 0.5} y2={pt + ih + 0.5} stroke="var(--line2)" />
        {labels.map((l, i) => (i % step === 0 ? <text key={i} className="ax" x={x(i)} y={height - 8} textAnchor="middle">{l}</text> : null))}
        {hover && <line x1={x(hover.i)} x2={x(hover.i)} y1={pt} y2={pt + ih} stroke="var(--fg3)" opacity={0.5} />}
      </svg>
      {hover && (
        <div className="tip show" style={{ left: Math.min(hover.x + 14, w - 190), top: Math.max(0, hover.y - 30) }}>
          <b>{labels[hover.i]}</b>
          {series.map((s) => (
            <div key={s.name}><span><i style={{ background: s.color }} />{s.name}</span><span>{s.data[hover.i] === null ? "—" : s.format(s.data[hover.i] as number)}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ data, color, className = "spk" }: { data: number[]; color: string; className?: string }) {
  const W = 200, H = 50;
  const vals = data.length > 1 ? data : [0, 0];
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const pts = vals.map((v, i) => [(i * W) / (vals.length - 1), 6 + (1 - (v - mn) / (mx - mn || 1)) * (H - 12)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
  const id = useRef("s" + Math.random().toString(36).slice(2, 8)).current;
  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".2" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d}L${W} ${H}L0 ${H}Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Donut({ parts, big, small }: { parts: [number, string][]; big: string; small: string }) {
  const tot = parts.reduce((a, p) => a + p[0], 0) || 1, r = 55, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 136 136" width={136} height={136} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={68} cy={68} r={r} fill="none" stroke="var(--hover)" strokeWidth={14} />
        {parts.filter((p) => p[0] > 0).map((p, i) => {
          const len = (p[0] / tot) * c;
          const el = <circle key={i} cx={68} cy={68} r={r} fill="none" stroke={`var(${p[1]})`} strokeWidth={14} strokeDasharray={`${Math.max(len - 3, 1)} ${c}`} strokeDashoffset={-off} />;
          off += len;
          return el;
        })}
      </svg>
      <div className="donut-c"><b>{big}</b><small>{small}</small></div>
    </div>
  );
}

export function Kpi({ label, icon, value, unit, delta, deltaTone, sub, spark, color }: {
  label: string; icon: React.ReactNode; value: string; unit?: string; delta?: string; deltaTone?: "up" | "bad";
  sub: string; spark?: number[]; color: string;
}) {
  return (
    <div className="kpi">
      <div className="kpi-h">{label}<span className="kpi-ic">{icon}</span></div>
      <div className="kpi-v"><b>{value}{unit && <small>{unit}</small>}</b>{delta && <span className={`delta ${deltaTone ?? "up"}`}>{delta}</span>}</div>
      <div className="kpi-s">{sub}</div>
      {spark && <Sparkline data={spark} color={color} />}
      {!spark && <div style={{ height: 22 }} />}
    </div>
  );
}

export function bucketLabels(ts: string[], range: string): string[] {
  return ts.map((t) => {
    const d = new Date(t);
    if (range === "7d" || range === "30d") return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  });
}
