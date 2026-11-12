"use client";

// /discord/link?code=XXXXXX: ties the Discord account that typed /link to the
// signed-in Static-Cuts account, so /rate in Discord rates as you.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";

export default function DiscordLinkPage() {
  const { user, loading } = useAuth();
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    try { setCode((new URLSearchParams(window.location.search).get("code") ?? "").toUpperCase()); } catch { /* ignore */ }
  }, []);

  async function go() {
    setState("busy"); setErr(null);
    const { error } = await supabase.rpc("rpc_discord_link", { p_code: code });
    if (error) { setErr(error.message); setState("idle"); return; }
    setState("done");
  }

  return (
    <div className="wrap" style={{ maxWidth: 560, paddingTop: 40 }}>
      <h1 className="ls-title">LINK DISCORD<span>//</span></h1>
      {state === "done" ? (
        <p className="sb-lead">Linked. Back in Discord, <b>/rate</b> now rates songs as your Static-Cuts account. You can close this tab.</p>
      ) : loading ? (
        <p className="sb-lead">Checking…</p>
      ) : !user ? (
        <p className="sb-lead"><Link href={`/login?next=${encodeURIComponent(`/discord/link?code=${code}`)}`} className="text-link">Log in</Link> first, then come back to this link.</p>
      ) : (
        <>
          <p className="sb-lead">Link the Discord account that typed <b>/link</b> to <b>{user.email}</b>? Ratings you give with <b>/rate</b> will count as yours.</p>
          <input className="st-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code from Discord" maxLength={6}
            style={{ maxWidth: 200, letterSpacing: 4, textAlign: "center" }} aria-label="Code from Discord" />
          <div style={{ marginTop: 12 }}>
            <button className="tab active" disabled={state === "busy" || code.trim().length !== 6} onClick={go}>
              {state === "busy" ? "Linking…" : "Link my Discord"}
            </button>
          </div>
          {err && <p className="sb-lead" style={{ color: "#FF3355" }}>{err}</p>}
        </>
      )}
    </div>
  );
}
