"use client";

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
    <div className="wrap" style={{ maxWidth: 520 }}>
      <h1 className="detail-name page-title">Set a new password</h1>
      {loading ? (
        <div className="empty-state">loading…</div>
      ) : done ? (
        <div className="empty-state">Done. Your new password works from now on. <Link href="/" className="text-link">Go to the home page →</Link></div>
      ) : !session ? (
        <div className="empty-state">
          This page works from the link in a &ldquo;forgot your password?&rdquo; email. The link may have run out:
          ask for a new one on the <Link href="/login" className="text-link">log in page</Link>.
        </div>
      ) : (
        <form onSubmit={save}>
          <input className="search-input" type="password" placeholder="New password (6+ characters)" value={password}
            onChange={(e) => setPassword(e.target.value)} required minLength={6} style={{ marginBottom: 10, width: "100%" }} />
          <input className="search-input" type="password" placeholder="Same again" value={again}
            onChange={(e) => setAgain(e.target.value)} required minLength={6} style={{ width: "100%" }} />
          <button type="submit" className="tab active" disabled={busy} style={{ marginTop: 14, width: "100%", padding: 12 }}>
            {busy ? "…" : "save new password"}
          </button>
          {error && <div className="empty-state error" style={{ marginTop: 14 }}>{error}</div>}
        </form>
      )}
    </div>
  );
}
