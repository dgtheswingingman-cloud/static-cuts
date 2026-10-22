"use client";

// Account links under the wordmark on the home page. In admin mode it shows
// admin jobs only; your own account (profile, notifications, settings,
// submissions) is in the regular view. The admin/account switch itself is
// in the bar at the top of every page (ModeBar).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import { useIsAdmin, useIsModerator } from "./useIsAdmin";

export default function AuthBar() {
  const { user, loading, signOut } = useAuth();
  const isAdmin = useIsAdmin();
  const isModerator = useIsModerator();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [unreadMsgs, setUnreadMsgs] = useState(0);

  useEffect(() => {
    if (!user || isAdmin) { setUnread(0); return; }
    supabase.rpc("rpc_unread_notifications", { p_admin: false }).then(({ data }) => setUnread(typeof data === "number" ? data : 0));
    supabase.rpc("rpc_unread_messages").then(({ data }) => setUnreadMsgs(typeof data === "number" ? data : 0));
  }, [user, isAdmin]);

  useEffect(() => {
    if (!user) { setDisplayName(null); return; }
    supabase.from("profiles").select("display_name").eq("id", user.id).single()
      .then(({ data }) => setDisplayName(data?.display_name ?? user.email ?? ""));
  }, [user]);

  if (loading) return <div className="auth-bar" aria-hidden />;

  if (!user) {
    return (
      <div className="auth-bar">
        <Link href="/login" className="auth-link">log in / sign up</Link>
      </div>
    );
  }

  // Admin mode: the admin shortcuts are in the bar at the top of every page.
  if (isAdmin) {
    return (
      <div className="auth-bar">
        <span className="auth-who">admin</span>
        <button onClick={() => signOut()} className="auth-link">log out</button>
      </div>
    );
  }

  return (
    <div className="auth-bar">
      <span className="auth-who">{displayName ?? user.email}</span>
      <Link href={`/profile/${user.id}`} className="auth-link">profile</Link>
      <Link href="/notifications" className="auth-link" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
        notifications{unread > 0 && <span className="notif-count">{unread}</span>}
      </Link>
      <Link href="/messages" className="auth-link" aria-label={`Messages${unreadMsgs ? `, ${unreadMsgs} unread` : ""}`}>
        messages{unreadMsgs > 0 && <span className="notif-count">{unreadMsgs}</span>}
      </Link>
      <Link href="/my-submissions" className="auth-link">my submissions</Link>
      {isModerator && <Link href="/control" className="auth-link">control room</Link>}
      <Link href="/settings" className="auth-link">settings</Link>
      <button onClick={() => signOut()} className="auth-link">log out</button>
    </div>
  );
}
