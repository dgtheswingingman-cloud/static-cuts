"use client";

import { useAuth } from "./AuthProvider";
import { useAdminView } from "./AdminViewContext";
import { ADMIN_EMAIL } from "./adminConfig";

// Whether the current user should see admin controls right now. This is
// what everything else in the app should check -- not the raw email
// comparison -- since it respects the "view as non-admin" toggle.
export function useIsAdmin() {
  const { user } = useAuth();
  const { viewAsNonAdmin } = useAdminView();
  const isRealAdmin = user?.email === ADMIN_EMAIL;
  return isRealAdmin && !viewAsNonAdmin;
}

// Whether the account is genuinely the admin, regardless of the view-as
// toggle -- used to decide whether to show the toggle itself at all.
export function useIsRealAdmin() {
  const { user } = useAuth();
  return user?.email === ADMIN_EMAIL;
}
