// Radar is one section: the overview (/radar), followed artists only
// (/new?following=1), the release list (/radar/releases), everything new
// (/new) and this week's round-up (/weekly). Big RADAR// header on top.

import Link from "next/link";

export const RADAR_PATHS = ["/radar", "/radar/releases", "/weekly", "/new"];

export type RadarTab = "all" | "following" | "releases" | "new" | "week";

export default function RadarTabs({ active }: { active: RadarTab }) {
  const tabs: [RadarTab, string, string][] = [
    ["all", "/radar", "All"],
    ["following", "/new?following=1", "Following"],
    ["releases", "/radar/releases", "Releases"],
    ["new", "/new", "What's new"],
    ["week", "/weekly", "This week"],
  ];
  return (
    <div className="rd-top">
      <div className="rd-title" aria-hidden="true">RADAR<span>//</span></div>
      <div className="rd-sub">Updates / releases / discoveries</div>
      <nav className="rd-chips" aria-label="Radar">
        {tabs.map(([k, href, label]) => (
          <Link key={k} href={href} aria-current={active === k ? "page" : undefined} className={active === k ? "on" : undefined}>{label}</Link>
        ))}
      </nav>
    </div>
  );
}
