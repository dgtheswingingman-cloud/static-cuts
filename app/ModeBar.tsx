"use client";

// A thin bar at the top of every page, shown only to the admin account, so
// it's always clear which mode you're in and switching is one tap:
//   admin mode   -> admin jobs only (no ratings, comments, follows...)
//   your account -> the site exactly as a regular user sees it
// Nobody else sees this bar.

import { useAuth } from "./AuthProvider";
import { useAdminView } from "./AdminViewContext";
import { useIsRealAdmin } from "./useIsAdmin";

export default function ModeBar() {
  const { loading } = useAuth();
  const isRealAdmin = useIsRealAdmin();
  const { viewAsNonAdmin, setViewAsNonAdmin } = useAdminView();
  if (loading || !isRealAdmin) return null;
  const adminMode = !viewAsNonAdmin;
  return (
    <div className={`mode-bar ${adminMode ? "is-admin" : "is-user"}`} role="status">
      <span className="mode-bar-label">{adminMode ? "Admin mode" : "Your account"}</span>
      <span className="mode-bar-hint">
        {adminMode ? "admin jobs only" : "what regular users see"}
      </span>
      <button className="mode-bar-switch" onClick={() => setViewAsNonAdmin(adminMode)}>
        {adminMode ? "switch to my account" : "switch to admin mode"}
      </button>
    </div>
  );
}
