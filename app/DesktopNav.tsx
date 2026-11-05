"use client";

// Computers only: a menu down the left side with the wordmark, a search box,
// the main sections and messages. Phones use the top bar (SiteHome) and the
// tab bar along the bottom (MobileTabBar) instead.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { usePersonalUser } from "./useIsAdmin";
import { RADAR_PATHS } from "./components/RadarTabs";

const I = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

const LINKS: { href: string; label: string; icon: ReactNode; on?: (p: string) => boolean }[] = [
  { href: "/", label: "Home", icon: I(<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />), on: (p) => p === "/" },
  { href: "/radar", label: "Radar", icon: I(<><path d="M12 12 19 5" /><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /></>), on: (p) => RADAR_PATHS.includes(p) },
  { href: "/search", label: "Search", icon: I(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>), on: (p) => p.startsWith("/search") },
  { href: "/library", label: "My Library", icon: I(<><path d="M5 4v16M10 4v16" /><path d="m14.5 4.5 5 15" /></>), on: (p) => p.startsWith("/library") || p.startsWith("/local") || p.startsWith("/listening") || p.startsWith("/collection") },
  { href: "/lists", label: "Lists", icon: I(<><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>), on: (p) => p.startsWith("/lists") || p.startsWith("/list/") },
  { href: "/genres", label: "Genres", icon: I(<><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>), on: (p) => p.startsWith("/genre") },
  { href: "/collabs", label: "Collabs", icon: I(<><circle cx="8" cy="9" r="3.5" /><circle cx="16" cy="9" r="3.5" /><path d="M2 20c1-3.5 3.5-5 6-5s5 1.5 6 5M12.5 15.3c1-.2 2.3-.3 3.5-.3 2.5 0 5 1.5 6 5" /></>) },
  { href: "/help", label: "Help wanted", icon: I(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01" /></>) },
];

export default function DesktopNav() {
  const path = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  const user = usePersonalUser();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!user) { setUnread(0); return; }
    supabase.rpc("rpc_unread_messages").then(({ data }) => setUnread(typeof data === "number" ? data : 0));
  }, [user, path]);
  return (
    <header className="dnav">
      <div className="dnav-inner">
        <Link href="/" className="dnav-logo" aria-label="Static Cuts// home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.webp" alt="Static Cuts//" className="logo-img" width={1200} height={200} />
        </Link>
        <form className="dnav-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }}>
          <input type="search" placeholder="Search Static Cuts//…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </form>
        <nav className="dnav-links" aria-label="Main">
          {LINKS.map((l) => {
            const on = l.on ? l.on(path) : path === l.href;
            return (
              <Link key={l.href} href={l.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
                {l.icon}<span>{l.label}</span>
              </Link>
            );
          })}
          {user && (
            <Link href="/messages" className={path.startsWith("/messages") ? "on" : undefined} aria-label={`Messages${unread ? `, ${unread} unread` : ""}`}>
              {I(<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" />)}<span>Messages</span>
              {unread > 0 && <span className="dnav-count">{unread > 9 ? "9+" : unread}</span>}
            </Link>
          )}
          {user && (
            <Link href={`/profile/${user.id}`} className={path.startsWith("/profile") ? "on" : undefined}>
              {I(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>)}<span>You</span>
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
