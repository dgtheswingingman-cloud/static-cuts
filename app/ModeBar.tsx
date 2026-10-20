"use client";

// A thin bar at the top of every page, shown only to the admin account, so
// it's always clear which mode you're in and switching is one tap:
//   admin mode   -> admin jobs only (no ratings, comments, follows...), with
//                   the admin shortcuts: moderation, health, alerts, undo
//   your account -> the site exactly as a regular user sees it
// Nobody else sees this bar.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import { useAdminView } from "./AdminViewContext";
import { useIsRealAdmin } from "./useIsAdmin";

const SHORTCUTS: [string, string][] = [
  ["/control", "control room"],
  ["/notifications", "alerts"],
  ["/admin/batches", "undo history"],
];

export default function ModeBar() {
  const { loading } = useAuth();
  const isRealAdmin = useIsRealAdmin();
  const { viewAsNonAdmin, setViewAsNonAdmin } = useAdminView();
  const path = usePathname();
  const adminMode = isRealAdmin && !viewAsNonAdmin;
  const [alerts, setAlerts] = useState(0);

  useEffect(() => {
    if (!adminMode) return;
    supabase.rpc("rpc_unread_notifications", { p_admin: true }).then(({ data }) => setAlerts(typeof data === "number" ? data : 0));
  }, [adminMode, path]);

  if (loading || !isRealAdmin) return null;
  return (
    <div className={`mode-bar ${adminMode ? "is-admin" : "is-user"}`} role="status">
      <span className="mode-bar-label">{adminMode ? "Admin mode" : "Your account"}</span>
      {adminMode ? (
        <nav className="mode-bar-links" aria-label="Admin shortcuts">
          {SHORTCUTS.map(([href, label]) => (
            <Link key={href} href={href} className={path === href ? "on" : undefined}>
              {label}
              {href === "/notifications" && alerts > 0 && <span className="notif-count">{alerts}</span>}
            </Link>
          ))}
        </nav>
      ) : (
        <span className="mode-bar-hint">what regular users see</span>
      )}
      <button className="mode-bar-switch" onClick={() => setViewAsNonAdmin(adminMode)}>
        {adminMode ? "switch to my account" : "switch to admin mode"}
      </button>
    </div>
  );
}
