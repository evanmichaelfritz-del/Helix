import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { BrandMark, IconCal, IconProtocol, IconToday, IconVitals, IconYou } from "./icons.tsx";

const tabs = [
  { to: "/", label: "Today", icon: <IconToday />, end: true },
  { to: "/health", label: "Vitals", icon: <IconVitals /> },
  { to: "/protocol", label: "Protocol", icon: <IconProtocol /> },
  { to: "/account", label: "You", icon: <IconYou /> },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <nav className="rail chrome" aria-label="Helix">
        <div className="brand">
          <BrandMark />
          Helix
        </div>
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={"end" in t ? t.end : false}>
            {t.icon}
            {t.label}
          </NavLink>
        ))}
        <div className="sub">
          <NavLink to="/calendar">
            <IconCal />
            Calendar
          </NavLink>
          <NavLink to="/account#sources">
            <IconVitals />
            Sources
          </NavLink>
        </div>
      </nav>
      <nav className="dock chrome" aria-label="Primary">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={"end" in t ? t.end : false}
            className={({ isActive }) => (isActive ? "active" : undefined)}
          >
            {t.icon}
            {t.label}
          </NavLink>
        ))}
      </nav>
      <main className="page">{children}</main>
    </div>
  );
}

export function Runway(props: {
  remaining: number | null;
  tone: "ok" | "amber" | "red" | null;
}) {
  if (props.remaining == null) return null;
  const n = Math.min(8, Math.max(0, props.remaining));
  return (
    <div className={`runway ${props.tone ?? "ok"}`} title={`${props.remaining} left`}>
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} className={i < n ? "on" : undefined} />
      ))}
      <span className="runway-count">{props.remaining}</span>
    </div>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span className="swatch" style={{ background: color }} />;
}
