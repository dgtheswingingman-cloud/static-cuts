"use client";

// Your data: download everything you've put in, or delete your account.

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function YourData() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState("");

  async function download() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("rpc_my_data");
    setBusy(false);
    if (err || !data) { setError(err?.message ?? "Couldn't get your data. Try again in a minute."); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `static-cuts-my-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("rpc_delete_my_account", { p_confirm: confirm.trim().toLowerCase() });
    if (err) { setBusy(false); setError(err.message); return; }
    await supabase.auth.signOut();
    window.location.assign("/?account=deleted");
  }

  return (
    <>
      <div className="section-label">Your data</div>
      <div className="comments-panel">
        <div className="comment-meta" style={{ marginBottom: 10 }}>
          Download everything you&apos;ve put in: who you follow, your collection, ratings, comments, lists and
          suggestions, as one file.
        </div>
        <button className="tab" disabled={busy} onClick={download}>{busy && !deleting ? "…" : "download my data"}</button>

        <div className="comment-meta" style={{ margin: "18px 0 10px" }}>
          Deleting your account removes your follows, collection, ratings, lists, votes and settings for good. Songs
          and fixes you suggested that were approved stay in the archive without your name, and your comments are
          replaced with &ldquo;[deleted]&rdquo;.
        </div>
        {!deleting ? (
          <button className="tab" onClick={() => setDeleting(true)}>delete my account…</button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}>
            <input className="search-input" placeholder='Type "delete my account"' value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="tab active" disabled={busy || confirm.trim().toLowerCase() !== "delete my account"} onClick={remove}>
                {busy ? "deleting…" : "delete it"}
              </button>
              <button className="tab" onClick={() => { setDeleting(false); setConfirm(""); }}>cancel</button>
            </div>
          </div>
        )}
        {error && <div className="empty-state error" style={{ marginTop: 10 }}>{error}</div>}
      </div>
    </>
  );
}
