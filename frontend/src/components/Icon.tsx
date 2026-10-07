const P: Record<string, string> = {
  check: '<path d="m3.5 8.3 2.8 2.7 6.2-6.3"/>',
  x: '<path d="m4.5 4.5 7 7m0-7-7 7"/>',
  chev: '<path d="m6 4 4 4-4 4"/>',
  back: '<path d="m10 4-4 4 4 4"/>',
  down: '<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>',
  updown: '<path d="m5.5 6 2.5-2.5L10.5 6M5.5 10l2.5 2.5 2.5-2.5"/>',
  alert: '<path d="M8 2.8 14 13H2L8 2.8Z"/><path d="M8 6.6v2.9M8 11.2v.05"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 5v3.2l2 1.3"/>',
  sign: '<path d="M3 12.5c1.8 0 2.6-1.2 3.2-2.7.7-1.8 1.4-4.3 2.8-4.3 1.2 0 1 2-.2 3.6M9.5 12.5H13"/>',
  key: '<circle cx="5.5" cy="10.5" r="3"/><path d="m7.6 8.4 5.4-5.4M11 5l1.5 1.5"/>',
  dl: '<path d="M8 2.5v8M4.8 7.5 8 10.7l3.2-3.2M3 13.5h10"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.8v2.6h-2.6"/>',
  play: '<path d="M5 3.5v9l7-4.5-7-4.5Z"/>',
  link: '<path d="M6.8 9.2 9.2 6.8M7 4.6l1-1a2.6 2.6 0 0 1 3.7 3.7l-1 1M9 11.4l-1 1a2.6 2.6 0 0 1-3.7-3.7l1-1"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  filter: '<path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3"/>',
  req: '<path d="M2.5 13.5V9M6 13.5V5.5M9.5 13.5V7.5M13 13.5V2.5"/>',
  pulse: '<path d="M2 8h3l1.5-3 2.5 6 1.5-3H14"/>',
  shield: '<path d="M8 2 13 4v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4l5-2Z"/>',
  bot: '<rect x="3" y="5" width="10" height="8" rx="2.5"/><path d="M8 2.5V5M6 9h.01M10 9h.01"/>',
  bell: '<path d="M4 11V7.2a4 4 0 0 1 8 0V11l1.2 1.5H2.8L4 11Z"/><path d="M6.6 14h2.8"/>',
  pause: '<rect x="3.5" y="3" width="3" height="10" rx="1"/><rect x="9.5" y="3" width="3" height="10" rx="1"/>',
  more: '<path d="M3.5 8h.01M8 8h.01M12.5 8h.01" stroke-width="2.4"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>',
  sun: '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1 1M4.4 11.6l-1 1M12.6 12.6l-1-1M4.4 4.4l-1-1"/>',
  moon: '<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z"/>',
  rocket: '<path d="M9.5 2.5c2.5.2 3.8 1.5 4 4L9 11 5 7l4.5-4.5ZM5 7 3 7.5l-1 2 3 .5M9 11l-.5 2-2 1-.5-3M10.5 5.5h.01"/>',
  flask: '<path d="M6 2.5h4M6.5 2.5v4L3 12.5c-.4.7.1 1.5.9 1.5h8.2c.8 0 1.3-.8.9-1.5L9.5 6.5v-4M4.8 10h6.4"/>',
  user: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3.5 13.5a4.5 4.5 0 0 1 9 0"/>',
  plug: '<path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2a3.5 3.5 0 0 1-7 0v-2ZM8 11v2.5"/>',
  edit: '<path d="M10.5 3 13 5.5 6 12.5H3.5V10L10.5 3Z"/>',
  grid: '<rect x="2.5" y="2.5" width="4.5" height="5.5" rx="1.2"/><rect x="9" y="2.5" width="4.5" height="3.5" rx="1.2"/><rect x="9" y="8" width="4.5" height="5.5" rx="1.2"/><rect x="2.5" y="10" width="4.5" height="3.5" rx="1.2"/>',
  gear: '<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.7M8 12.5v1.7M14.2 8h-1.7M3.5 8H1.8M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2M12.4 12.4l-1.2-1.2M4.8 4.8 3.6 3.6"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  logout: '<path d="M9.5 4V3a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-1M6.5 8h7M11 5.5 13.5 8 11 10.5"/>',
  menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
};

export function Icon({ name, className = "ic", style }: { name: string; className?: string; style?: React.CSSProperties }) {
  return <svg className={className} style={style} viewBox="0 0 16 16" aria-hidden="true" dangerouslySetInnerHTML={{ __html: P[name] ?? "" }} />;
}

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <span className="logo">
      <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 1.5v5.75" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M10 7.25 14.2 11.8 10 18.5 5.8 11.8Z" fill="#8FA2FF" />
      </svg>
    </span>
  );
}
