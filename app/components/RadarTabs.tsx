"use client";

// Radar is one section with three tabs: what's coming and just dropped
// (/radar), this week's round-up (/weekly) and everything new (/new).

import Link from "next/link";
import { usePathname } from "next/navigation";

export const RADAR_PATHS = ["/radar", "/weekly", "/new"];

export default function RadarTabs() {
  const path = usePathname();
  const tabs: [string, string][] = [["/radar", "Coming up"], ["/weekly", "This week"], ["/new", "What's new"]];
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }} role="tablist" aria-label="Radar">
      {tabs.map(([href, label]) => (
        <Link key={href} href={href} role="tab" aria-selected={path === href} className={`tab${path === href ? " active" : ""}`} style={{ textDecoration: "none" }}>
          {label}
        </Link>
      ))}
    </div>
  );
}
