"use client";

// Phones (and narrow windows): the app-style tab bar along the bottom of
// every page. Home · New · Search · Local Cuts · You (your profile, the
// control room in admin mode, or log in).

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useIsAdmin } from "./useIsAdmin";

const ICONS: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  new: <><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  local: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  you: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
};

export default function MobileTabBar() {
  const path = usePathname();
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  // Full-screen flows have their own bottom bar.
  if (path === "/start" || path.startsWith("/year")) return null;
  const youHref = !user ? "/login" : isAdmin ? "/control" : `/profile/${user.id}`;
  const youLabel = !user ? "Log in" : isAdmin ? "Control" : "You";
  const tabs: [string, string, string, (p: string) => boolean][] = [
    ["home", "/", "Home", (p) => p === "/"],
    ["new", "/new", "New", (p) => p === "/new" || p === "/radar" || p === "/weekly"],
    ["search", "/search", "Search", (p) => p.startsWith("/search")],
    ["local", "/local", "Local Cuts", (p) => p.startsWith("/local")],
    ["you", youHref, youLabel, (p) => p.startsWith("/profile") || p.startsWith("/settings") || p === "/login" || p.startsWith("/control")],
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map(([icon, href, label, active]) => (
        <Link key={icon} href={href} className={active(path) ? "on" : undefined} aria-current={active(path) ? "page" : undefined}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[icon]}</svg>
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
