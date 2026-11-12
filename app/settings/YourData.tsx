"use client";

// Your data: download everything you've put in, reset your collection (kept
// 30 days so it can be put back), or delete your account.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function YourData() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetWord, setResetWord] = useState("");
  const [backup, setBackup] = useState<{ n: number; until: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("rpc_my_collection_backup").then(({ data }) => setBackup((data as { n: number; until: string } | null) ?? null));
  }, []);

  async function reset() {
    setBusy(true); setError(null); setMsg(null);
    const { data, error: err } = await supabase.rpc("rpc_reset_my_collection", { p_confirm: resetWord });
    setBusy(false);
    if (err) { setError(err.message); return; }
    const n = (data as number) ?? 0;
    setResetting(false); setResetWord("");
    setMsg(n ? `Collection reset: ${n.toLocaleString("en-GB")} songs taken out. You can put them back for 30 days.` : "Your collection was already empty.");
    if (n) setBackup({ n, until: new Date(Date.now() + 30 * 86400000).toISOString() });
  }

  async function restore() {
    setBusy(true); setError(null); setMsg(null);
    const { data, error: err } = await supabase.rpc("rpc_restore_my_collection");
    setBusy(false);
    if (err) { setError(err.message); return; }
    setBackup(null);
    setMsg(`${((data as number) ?? 0).toLocaleString("en-GB")} songs put back in your collection.`);
  }

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

  const Down = <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>;
  const Undo = <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4v6h6" /><path d="M20 20a8 8 0 0 0-14.9-6" /></svg>;
  const Bin = <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>;
  return (
    <>
      <button className="st-link-row" disabled={busy} onClick={download}>
        <span className="st-icon">{Down}</span>
        <span className="st-row-text">
          <span>{busy && !deleting ? "Getting your data…" : "Download my data"}</span>
          <small>A copy of everything you&apos;ve put in: follows, collection, ratings, comments, lists and suggestions, as one file.</small>
        </span>
        <span className="hf-chev" aria-hidden="true">›</span>
      </button>
      {backup ? (
        <button className="st-link-row" disabled={busy} onClick={restore}>
          <span className="st-icon">{Undo}</span>
          <span className="st-row-text">
            <span>{busy && !deleting ? "Putting it back…" : "Put my collection back"}</span>
            <small>Restores the {backup.n.toLocaleString("en-GB")} songs from your last reset (until {new Date(backup.until).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}). Songs you&apos;ve collected since stay too.</small>
          </span>
          <span className="hf-chev" aria-hidden="true">›</span>
        </button>
      ) : !resetting ? (
        <button className="st-link-row" onClick={() => setResetting(true)}>
          <span className="st-icon">{Undo}</span>
          <span className="st-row-text">
            <span>Reset my collection</span>
            <small>Untick every song you&apos;ve collected, e.g. to start again with a fresh Spotify or Exportify import. You can put it back for 30 days.</small>
          </span>
          <span className="hf-chev" aria-hidden="true">›</span>
        </button>
      ) : (
        <div className="st-delete">
          <small>This takes every song out of your collection. Follows, ratings and lists stay. A copy is kept for 30 days so you can put it back.</small>
          <input className="st-input" placeholder='Type "reset"' value={resetWord} onChange={(e) => setResetWord(e.target.value)} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="st-btn st-btn-danger" disabled={busy || resetWord.trim().toLowerCase() !== "reset"} onClick={reset}>
              {busy ? "Resetting…" : "Reset collection"}
            </button>
            <button className="st-btn" onClick={() => { setResetting(false); setResetWord(""); }}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <div className="st-msg">{msg}</div>}
      {!deleting ? (
        <button className="st-link-row st-danger" onClick={() => setDeleting(true)}>
          <span className="st-icon">{Bin}</span>
          <span className="st-row-text">
            <span>Delete account//</span>
            <small>Permanently removes your account and your data.</small>
          </span>
        </button>
      ) : (
        <div className="st-delete">
          <small>
            This removes your follows, collection, ratings, lists, votes and settings for good. Songs and fixes you suggested that were
            approved stay without your name, and your comments become &ldquo;[deleted]&rdquo;.
          </small>
          <input className="st-input" placeholder='Type "delete my account"' value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="st-btn st-btn-danger" disabled={busy || confirm.trim().toLowerCase() !== "delete my account"} onClick={remove}>
              {busy ? "Deleting…" : "Delete it"}
            </button>
            <button className="st-btn" onClick={() => { setDeleting(false); setConfirm(""); }}>Cancel</button>
          </div>
        </div>
      )}
      {error && <div className="st-msg">{error}</div>}
    </>
  );
}
