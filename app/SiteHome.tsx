"use client";

// Phones (and narrow windows): a slim app bar at the top of every page --
// the wordmark (tap for home), and search and notifications on the right.
// Computers have the full top bar (DesktopNav) instead.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePersonalUser } from "./useIsAdmin";

export default function SiteHome() {
  const user = usePersonalUser();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!user) { setUnread(0); return; }
    supabase.rpc("rpc_unread_notifications", { p_admin: false }).then(({ data }) => setUnread(typeof data === "number" ? data : 0));
  }, [user]);
  return (
    <div className="site-top">
      <Link href="/" className="site-home" aria-label="Static Cuts// home">
        STATIC CUTS<span className="slash">//</span>
      </Link>
      <span className="site-top-icons">
        <Link href="/search" aria-label="Search songs" className="site-icon">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        </Link>
        {user && (
          <Link href="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="site-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
            {unread > 0 && <span className="site-icon-dot">{unread > 9 ? "9+" : unread}</span>}
          </Link>
        )}
      </span>
    </div>
  );
}
