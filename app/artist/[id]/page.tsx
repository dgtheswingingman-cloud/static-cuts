"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../AuthProvider";
import { supabase } from "@/lib/supabase";

const oauthButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px",
  marginTop: 10,
  fontFamily: "var(--font-inter)",
  fontSize: "0.9rem",
  border: "1.5px solid var(--hair)",
  background: "var(--surface)",
  color: "var(--bone)",
  cursor: "pointer",
  textAlign: "center",
};

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
      router.push("/");
    }
  }

  async function handleOAuth(provider: "google" | "spotify") {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
    // On success, Supabase redirects away to the provider automatically --
    // nothing else to do here.
  }

  return (
    <div className="wrap">
      <h1 className="detail-name">{mode === "login" ? "Log in" : "Sign up"}</h1>

      <div className="search-shell" style={{ marginTop: 20, marginLeft: 0 }}>
        <button onClick={() => handleOAuth("google")} style={oauthButtonStyle}>
          Continue with Google
        </button>
        <button onClick={() => handleOAuth("spotify")} style={oauthButtonStyle}>
          Continue with Spotify
        </button>

        <div
          style={{
            textAlign: "center",
            color: "var(--smoke)",
            fontFamily: "var(--font-mono)",
            fontSize: "0.68rem",
            margin: "18px 0",
            letterSpacing: "0.08em",
          }}
        >
          OR USE EMAIL
        </div>

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
      </div>

      {error && (
        <div className="empty-state" style={{ borderColor: "#a33", marginTop: 16, maxWidth: 520 }}>
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
