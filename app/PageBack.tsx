"use client";

// "← back" at the top of every page that isn't a main section (those are in
// the side menu / tab bar) and doesn't already have its own way back (song
// pages, lists, the control room's pages, crumbs). Goes back to the page you
// came from on the site; opened from a link elsewhere, it goes to the page's
// parent instead.

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useIsAdmin } from "./useIsAdmin";
import { RADAR_PATHS } from "./components/RadarTabs";

// Main sections and pages that are a flow of their own.
const TOP = new Set([
  "/", "/radar", "/search", "/library", "/submit", "/contributors", "/help", "/login", "/start", "/welcome",
  "/messages", "/control", "/links", "/reset-password", "/spotify-callback", "/oauth/consent", ...RADAR_PATHS,
]);
// Pages that already have their own back link or crumb.
const OWN = [/^\/song\//, /^\/list\//, /^\/lists(\/|$)/, /^\/review(\/|$)/, /^\/admin(\/|$)/, /^\/genre\//, /^\/collection\/import/,
  /^\/artist\/[^/]+\/(eras|changelog)/, /^\/year/];

function parent(path: string, me: string | null): string {
  const m = path.match(/^\/artist\/([^/]+)\//);
  if (m) return `/artist/${m[1]}`;
  if (path.startsWith("/messages/")) return "/messages";
  if (path.startsWith("/producer/")) return "/producers";
  if (path === "/producers" || path === "/genres" || path === "/collabs") return "/search";
  if (["/local", "/listening", "/collection", "/my-submissions"].some((p) => path.startsWith(p))) return "/library";
  if (path === "/on-this-day") return "/radar";
  if ((path === "/settings" || path === "/friends") && me) return `/profile/${me}`;
  return "/";
}

// Pages seen in this tab since the site loaded (to know whether "back" stays on the site).
let seen = 0;

export default function PageBack() {
  const path = usePathname() ?? "/";
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  useEffect(() => { seen += 1; }, [path]);

  if (TOP.has(path) || OWN.some((r) => r.test(path))) return null;
  if (user && path === `/profile/${user.id}`) return null; // your own profile is the "You" section
  if (isAdmin && path === "/notifications") return null; // has a "Control room / Alerts" crumb
  return (
    <div className="page-back">
      <button type="button" className="back-btn" onClick={() => (seen > 1 ? router.back() : router.push(parent(path, user?.id ?? null)))}>
        ← back
      </button>
    </div>
  );
}
