"use client";

import { useState, FormEvent } from "react";

// Where to go after logging in. Only same-site paths, so ?next= can't be
// used to bounce people to another website.
function nextPath(): string {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
import { useRouter } from "next/navigation";
import { useAuth } from "../AuthProvider";
import { supabase } from "@/lib/supabase";
import { OAUTH_FLAG } from "../AuthNotice";

export default function LoginPage() {
  const { signUp, signIn } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const result = mode === "signup" ? await signUp(email, password) : await signIn(email, password);
    setBusy(false);
    if (result.error) {
      setError(result.error);
    } else if (mode === "signup") {
      setMessage("Check your email to confirm your account, then log in.");
    } else {
      router.push(nextPath());
    }
  }

  async function handleForgot() {
    setError(null);
    setMessage(null);
    if (!email.trim()) { setError("Type your email above first, then press this again."); return; }
    setBusy(true);
    // The link brings you back to the site, which then asks for a new password.
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    setBusy(false);
    if (err) setError(err.message);
    else setMessage("If there's an account with that email, a link to set a new password is on its way. Check your spam folder too.");
  }

  async function handleOAuth() {
    setError(null);
    // So the site can explain if they come back not signed in (AuthNotice).
    try { sessionStorage.setItem(OAUTH_FLAG, String(Date.now())); } catch { /* storage blocked */ }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "spotify",
      // user-follow-read: so the first-visit page can tick the artists you
      // already follow on Spotify.
      options: { redirectTo: window.location.origin + nextPath(), scopes: "user-follow-read" },
    });
    if (error) setError(error.message);
    // On success, Supabase redirects away to the provider automatically --
    // nothing else to do here.
  }

  return (
    <div className="wrap">
      <h1 className="detail-name page-title">{mode === "login" ? "Log in" : "Sign up"}</h1>

      <div className="search-shell" style={{ marginTop: 20, marginLeft: 0 }}>
        <form onSubmit={handleSubmit}>
          <input
            className="search-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ marginBottom: 10 }}
          />
          <input
            className="search-input"
            type="password"
            placeholder="Password (6+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <button
            type="submit"
            disabled={busy}
            className="tab active"
            style={{ marginTop: 14, width: "100%", padding: "12px", textAlign: "center" }}
          >
            {busy ? "…" : mode === "login" ? "Log in" : "Sign up"}
          </button>
        </form>
        {mode === "login" && (
          <button className="back-btn" style={{ marginTop: 10 }} disabled={busy} onClick={handleForgot}>
            Forgot your password?
          </button>
        )}

        {/* Spotify only lets new apps like ours have a handful of Spotify
            accounts (added by hand in its developer dashboard), and it often
            refuses even those when busy. Sign-up is email only; invited
            testers can still log in with Spotify from a small link. */}
        {mode === "login" && (
          <div style={{ marginTop: 26, paddingTop: 12, borderTop: "1px solid var(--hair)" }}>
            <button className="inline-link-btn comment-meta" onClick={() => handleOAuth()}>
              Invited Spotify tester? Log in with Spotify
            </button>
            <div className="comment-meta" style={{ marginTop: 6 }}>
              Only for accounts we&apos;ve invited (Spotify limits new sites). Everyone else: sign up with email. You can still
              bring in your Spotify music afterwards from Collection › Import, using Exportify.
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="empty-state error" style={{ marginTop: 16, maxWidth: 520 }}>
          {error}
        </div>
      )}
      {message && (
        <div className="empty-state" style={{ marginTop: 16, maxWidth: 520 }}>
          {message}
        </div>
      )}

      <button
        className="back-btn"
        style={{ marginTop: 20 }}
        onClick={() => {
          setMode(mode === "login" ? "signup" : "login");
          setError(null);
          setMessage(null);
        }}
      >
        {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
      </button>
    </div>
  );
}
