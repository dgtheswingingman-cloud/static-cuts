"use client";
import "../styles/pages.css";

// Set a new password, after following the link in a "forgot your password?"
// email (the link signs you in for this one job).

import { FormEvent, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";

export default function ResetPasswordPage() {
  const { session, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) return setError("At least 6 characters, please.");
    if (password !== again) return setError("The two passwords don't match.");
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) setError(err.message);
    else setDone(true);
  }

  return (
    <div className="wrap pg-page pg-narrow">
      <section className="pg-box pg-auth">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.webp" alt="Static Cuts//" className="pg-auth-logo" />
        <h1 className="detail-name page-title pg-title pg-auth-title">New password</h1>
        {loading ? (
          <div className="comment-meta">loading…</div>
        ) : done ? (
          <>
            <p className="pg-lead">Done. Your new password works from now on.</p>
            <Link href="/" className="st-btn pg-full">Go to the home page →</Link>
          </>
        ) : !session ? (
          <>
            <p className="pg-lead">
              This page works from the link in a &ldquo;forgot your password?&rdquo; email. The link may have run out,
              so ask for a new one on the log in page.
            </p>
            <Link href="/login" className="st-btn pg-full">Log in page →</Link>
          </>
        ) : (
          <form onSubmit={save} className="pg-form">
            <p className="pg-lead">Pick a new password for your account.</p>
            <label className="pg-field">
              <span>New password</span>
              <input className="search-input" type="password" placeholder="6+ characters" value={password} autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </label>
            <label className="pg-field">
              <span>Same again</span>
              <input className="search-input" type="password" placeholder="Type it again" value={again} autoComplete="new-password"
                onChange={(e) => setAgain(e.target.value)} required minLength={6} />
            </label>
            {error && <div className="pg-error">{error}</div>}
            <button type="submit" className="st-btn pg-full pg-primary" disabled={busy}>{busy ? "…" : "Save new password"}</button>
          </form>
        )}
      </section>
    </div>
  );
}
