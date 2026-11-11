"use client";

import { useEffect, useState, FormEvent } from "react";

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
import HeroCollage from "../components/HeroCollage";

export default function LoginPage() {
  const { signUp, signIn } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [banner, setBanner] = useState<string[]>([]);

  useEffect(() => {
    try { if (new URLSearchParams(window.location.search).get("mode") === "signup") setMode("signup"); } catch { /* ignore */ }
    supabase.from("artists").select("image_url").not("image_url", "is", null).limit(24)
      .then(({ data, error: err }) => {
        if (err) return;
        setBanner(((data ?? []) as { image_url: string }[]).map((r) => r.image_url));
      });
  }, []);

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

  const switchMode = (m: "login" | "signup") => { setMode(m); setError(null); setMessage(null); };

  return (
    <div className="wrap wl-page wl-login">
      <header className="wl-hero">
        {banner.length >= 3 && <HeroCollage images={banner} className="pf-collage ah2-collage wl-collage" />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.webp" alt="Static-Cuts//" className="logo-img wl-logo" width={1200} height={200} />
      </header>

      <div className="wl-card">
        <div className="st-seg wl-tabs" role="tablist">
          <button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "on" : undefined} onClick={() => switchMode("login")}>Log in//</button>
          <button role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "on" : undefined} onClick={() => switchMode("signup")}>Sign up//</button>
        </div>

        {/* Spotify only lets new apps like ours have a handful of Spotify
            accounts (added by hand in its developer dashboard), so logging in
            with Spotify is for invited testers; sign-up is email only. */}
        {mode === "login" && (
          <>
            <button className="wl-spotify" disabled={busy} onClick={() => handleOAuth()}>
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#1DB954" /><path d="M6.5 9.3c3.6-1.1 7.8-.8 11 1M7.2 12.3c3-.9 6.4-.6 9 .9M7.8 15.1c2.4-.6 5-.4 7 .8" stroke="#070707" strokeWidth="1.6" strokeLinecap="round" fill="none" /></svg>
              Continue with Spotify
            </button>
            <small className="wl-note">Spotify log-in is for invited testers for now (Spotify limits new sites). Everyone else: email.</small>
            <div className="wl-or"><span>or with email</span></div>
          </>
        )}

        <form onSubmit={handleSubmit} className="wl-form">
          <label className="wl-field">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1" /><path d="m3 7 9 6 9-6" /></svg>
            <input type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="wl-field">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="1" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
            <input type={showPw ? "text" : "password"} placeholder={mode === "signup" ? "Password (6+ characters)" : "Password"}
              autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            <button type="button" className="wl-eye" aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw(!showPw)}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />{showPw && <path d="M3 3l18 18" />}</svg>
            </button>
          </label>
          {mode === "login" && <button type="button" className="wl-forgot" disabled={busy} onClick={handleForgot}>Forgot your password?</button>}
          {error && <div className="sb-error">{error}</div>}
          {message && <div className="wl-message">{message}</div>}
          <button type="submit" disabled={busy} className="sb-submit wl-submit">{busy ? "…" : mode === "login" ? "Log in//" : "Create account//"}</button>
        </form>
        <p className="wl-small">Browsing doesn&apos;t need an account. An account saves your library, follows and alerts.</p>
      </div>
    </div>
  );
}
