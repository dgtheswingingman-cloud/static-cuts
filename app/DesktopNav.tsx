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
  { href: "/search", label: "Search", icon: I(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>), on: (p) => ["/search", "/genre", "/producer", "/collabs", "/lists", "/list/"].some((x) => p.startsWith(x)) },
  { href: "/library", label: "My Library", icon: I(<><path d="M5 4v16M10 4v16" /><path d="m14.5 4.5 5 15" /></>), on: (p) => p.startsWith("/library") || p.startsWith("/local") || p.startsWith("/listening") || p.startsWith("/collection") },
  { href: "/submit", label: "Suggest", icon: I(<><path d="M12 15V4M7 9l5-5 5 5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>), on: (p) => p.startsWith("/submit") || p.startsWith("/my-submissions") },
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
        {/* Account, at the bottom of the side menu. */}
        <nav className="dnav-links dnav-foot" aria-label="Account">
          {user ? (
            <>
              <Link href="/settings" className={path.startsWith("/settings") ? "on" : undefined}>
                {I(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>)}<span>Settings</span>
              </Link>
              <button type="button" className="dnav-btn" onClick={async () => { await supabase.auth.signOut(); window.location.assign("/"); }}>
                {I(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>)}<span>Log out</span>
              </button>
            </>
          ) : (
            <Link href="/login" className={path.startsWith("/login") ? "on" : undefined}>
              {I(<><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M10 17l5-5-5-5M15 12H3" /></>)}<span>Log in</span>
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
