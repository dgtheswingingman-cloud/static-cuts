"use client";

// Computers only: a bar across the top with the wordmark, the main sections
// and a search box. Phones keep the wordmark-and-links layout.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { usePersonalUser } from "./useIsAdmin";

const LINKS: [string, string][] = [
  ["/new", "What's new"], ["/radar", "Radar"], ["/wanted", "Most wanted"], ["/lists", "Lists"],
  ["/collabs", "Collabs"], ["/genres", "Genres"], ["/local", "Local Cuts"], ["/help", "Help wanted"],
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
        <Link href="/" className="dnav-logo">STATIC CUTS<span className="slash">//</span></Link>
        <nav className="dnav-links" aria-label="Main">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className={path === href ? "on" : undefined}>{label}</Link>
          ))}
        </nav>
        <form className="dnav-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }}>
          <input type="search" placeholder="Search songs…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search songs" />
        </form>
        {user && (
          <Link href="/messages" className="dnav-msg" aria-label={`Messages${unread ? `, ${unread} unread` : ""}`} title="Messages">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" /></svg>
            {unread > 0 && <span className="site-icon-dot">{unread > 9 ? "9+" : unread}</span>}
          </Link>
        )}
      </div>
    </header>
  );
}
