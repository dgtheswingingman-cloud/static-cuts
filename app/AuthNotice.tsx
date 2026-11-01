"use client";

// After "Log in with Spotify" the visitor comes back here. If they're not
// signed in, say why instead of leaving them wondering:
//  - Spotify doesn't vouch for email addresses, so a new account has to be
//    confirmed from the email we send first;
//  - Spotify only lets invited testers use our Spotify login for now.
// Errors Supabase puts in the address (?error_description=… or #…) show too.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";

export const OAUTH_FLAG = "sc_oauth_started";

export default function AuthNotice() {
  const { user, loading } = useAuth();
  const [note, setNote] = useState<{ title: string; body: ReactNode } | null>(null);

  useEffect(() => {
    if (loading) return;
    let started = 0;
    try { started = Number(sessionStorage.getItem(OAUTH_FLAG) || 0); } catch { /* storage blocked */ }
    const params = new URLSearchParams(window.location.search + "&" + window.location.hash.replace(/^#/, ""));
    const err = params.get("error_description") || params.get("error");
    if (user) { try { sessionStorage.removeItem(OAUTH_FLAG); } catch { /* ignore */ } return; }
    if (!err && !(started && Date.now() - started < 15 * 60_000)) return;
    try { sessionStorage.removeItem(OAUTH_FLAG); } catch { /* ignore */ }

    const text = (err || "").replace(/\+/g, " ");
    if (/not registered|developer dashboard|access[_ ]denied|user not approved/i.test(text)) {
      setNote({
        title: "Spotify login is invite-only for now",
        body: <>Spotify only lets a handful of invited accounts use our Spotify login while the site is new. Sign up with your email
          instead. You can still bring in your Spotify music: on <Link href="/collection/import" className="text-link">Import</Link>,
          use Exportify (takes a minute, no invite needed).</>,
      });
    } else {
      setNote({
        title: "Almost there: confirm your email",
        body: <>We&apos;ve emailed you a link to confirm your account (Spotify doesn&apos;t confirm email addresses for us). Click it
          (check your spam folder too), then log in again.{text && !/confirm/i.test(text) ? <> Spotify said: &ldquo;{text}&rdquo;.</> : null}</>,
      });
    }
    if (err) {
      // Tidy the address bar so a refresh doesn't show it again.
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [user, loading]);

  if (!note) return null;
  return (
    <div className="wrap" style={{ paddingTop: 12, paddingBottom: 0 }}>
      <div className="mod-notice info" role="status">
        <div><b>{note.title}.</b> {note.body}</div>
        <button className="mod-link" aria-label="close" onClick={() => setNote(null)}>✕</button>
      </div>
    </div>
  );
}
