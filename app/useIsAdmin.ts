"use client";

import { useAuth } from "./AuthProvider";
import { useAdminView } from "./AdminViewContext";
import { ADMIN_EMAIL } from "./adminConfig";

// Whether the current user should see admin controls right now. This is
// what everything else in the app should check -- not the raw email
// comparison -- since it respects the "view as non-admin" toggle.
// Admins: the owner (ADMIN_EMAIL) plus anyone the owner made an admin.
export function useIsAdmin() {
  const { viewAsNonAdmin } = useAdminView();
  const isRealAdmin = useIsRealAdmin();
  return isRealAdmin && !viewAsNonAdmin;
}

// Whether the account is genuinely an admin, regardless of the view-as
// toggle -- used to decide whether to show the toggle itself at all.
export function useIsRealAdmin() {
  const { user, role } = useAuth();
  return user?.email === ADMIN_EMAIL || role === "owner" || role === "admin";
}

// The owner (the site's own account): the only one who can choose admins and
// moderators, see leak file links, manage API keys and site settings.
export function useIsOwner() {
  const { user } = useAuth();
  const { viewAsNonAdmin } = useAdminView();
  return user?.email === ADMIN_EMAIL && !viewAsNonAdmin;
}

// Whether the current user can moderate: the admin (unless viewing as a
// non-admin) or someone made a moderator on /admin/moderators.
export function useIsModerator() {
  const { role } = useAuth();
  const isAdmin = useIsAdmin();
  return isAdmin || role === "moderator";
}

// The account to use for personal things: collection, ratings, follows,
// comments, votes, lists, reminders, suggestions. In admin mode this is
// null, so the site behaves as it would for a visitor plus admin tools;
// admin mode is only for admin jobs. Pair it with useIsAdmin() to hide
// "log in to…" prompts in admin mode.
export function usePersonalUser() {
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  return isAdmin ? null : user;
}
