"use client";

// Songs found by the Genius and Last.fm imports, waiting for a look before
// they're added. Spotify imports don't come here: official songs are added
// straight away. Approved songs go into the undo history as one batch.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";

type Suggestion = {
  id: string;
  artist_id: string;
  artist_name: string;
  source: string;
  title: string;
  status_guess: string;
  url: string | null;
  album: string | null;
  release_date: string | null;
  main_artist_name: string | null;
  extra: { listeners?: number; playcount?: number; pageviews?: number; featuring?: string | null; already_on_page?: string; length_sec?: number; producers?: string } | null;
  created_at?: string;
  version_of?: string | null;
  decided_at?: string | null;
};

const SOURCE_NAMES: Record<string, string> = { genius: "Genius", lastfm: "Last.fm", spotify: "Spotify", sheet: "Community sheet", local: "Someone's music files" };

export default function ImportReviewPage() {
  const { user, loading: authLoading } = useAuth();
  const isRealAdmin = useIsModerator();
  const router = useRouter();
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Waiting songs, or ones dismissed before (kept so mistakes can be undone).
  const [view, setView] = useState<"waiting" | "dismissed">("waiting");

  async function load(which = view) {
    const { data, error: err } = await supabase.rpc(
      which === "waiting" ? "admin_import_suggestions" : "admin_dismissed_import_suggestions", { p_limit: 5000 });
    if (err) { setError(err.message); setItems([]); return; }
    setError(null);
    setItems((data as Suggestion[]) ?? []);
    setSelected(new Set());
  }

  useEffect(() => {
    if (isRealAdmin) load();
  }, [isRealAdmin]);

  const popularity = (s: Suggestion) => s.extra?.listeners ?? s.extra?.pageviews ?? -1;
  // Waiting: most popular first. Dismissed: most recently dismissed first.
  const shown = useMemo(() => view === "dismissed" ? (items ?? [])
    : [...(items ?? [])].sort((a, b) => popularity(b) - popularity(a) || a.title.localeCompare(b.title)), [items, view]);
  const groups = useMemo(() => {
    const out: Record<string, Suggestion[]> = {};
    shown.forEach((s) => {
      const k = `${s.artist_name} · ${SOURCE_NAMES[s.source] ?? s.source}`;
      (out[k] = out[k] || []).push(s);
    });
    return out;
  }, [shown]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function switchView(v: "waiting" | "dismissed") {
    if (v === view) return;
    setView(v); setItems(null); setMessage(null); setSelected(new Set());
    load(v);
  }

  async function run(kind: "approve" | "dismiss" | "restore", ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    setMessage(null);
    let done = 0;
    let skipped = 0; // approve: already on the site, so not added again
    let problem: string | null = null;
    // Small batches: big artists (Kanye, Carti) take longer to check for
    // duplicates, and each call has an 8-second limit.
    const size = kind === "approve" ? 20 : 100;
    for (let i = 0; i < ids.length; i += size) {
      const chunk = ids.slice(i, i + size);
      if (ids.length > size) setMessage(`${kind === "approve" ? "Adding" : kind === "restore" ? "Restoring" : "Dismissing"}… ${Math.min(i, ids.length)} of ${ids.length}`);
      const { data, error: err } = kind === "approve"
        ? await supabase.rpc("admin_apply_import_suggestions", { p_ids: chunk, p_status: null })
        : kind === "restore"
        ? await supabase.rpc("admin_restore_import_suggestions", { p_ids: chunk })
        : await supabase.rpc("admin_dismiss_import_suggestions", { p_ids: chunk });
      if (err) { problem = err.message; break; }
      const n = (data as number) ?? 0;
      done += n;
      if (kind === "approve") skipped += Math.max(0, chunk.length - n);
    }
    setBusy(false);
    const summary = kind === "approve"
      ? `${done} song${done === 1 ? "" : "s"} added.` +
        (skipped > 0 ? ` ${skipped} ${skipped === 1 ? "was" : "were"} already on the site (same song, maybe written slightly differently), so ${skipped === 1 ? "it wasn't" : "they weren't"} added again. ${skipped === 1 ? "It's" : "They're"} under "dismissed", marked "already on the site".` : "") +
        (done > 0 ? " You can reverse this from the undo history." : "")
      : kind === "restore"
      ? `${done} put back on the waiting list.`
      : `${done} dismissed. They won't be suggested again (they're kept under "dismissed" if you change your mind).`;
    setMessage(problem ? `Stopped after ${done}: ${problem}` : summary);
    load();
  }

  if (!isRealAdmin) return <NoAccess loading={authLoading} who="moderators" />;
  const selectedHere = shown.filter((s) => selected.has(s.id)).map((s) => s.id);
  // Dismissed because they're already on the site: restoring them would only
  // see them dismissed again on approval, so "restore all" leaves them out.
  const restorable = shown.filter((s) => !s.extra?.already_on_page);

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/control")}>← control room</button>
      <h1 className="detail-name page-title">Imported Songs</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        Songs the Genius, Last.fm and spreadsheet imports, and people&apos;s own music files (Local Cuts), found that aren&apos;t on the page yet. Genius often lists unreleased songs;
        Last.fm titles come from what people play, so leaks show up. Added songs are filed under their main song
        automatically when they&apos;re a version, and can be reversed from the{" "}
        <UndoHistoryLink />.
      </div>

      <div className="tabs" style={{ marginBottom: 12 }}>
        <button className={`tab ${view === "waiting" ? "active" : ""}`} onClick={() => switchView("waiting")}>waiting</button>
        <button className={`tab ${view === "dismissed" ? "active" : ""}`} onClick={() => switchView("dismissed")}>dismissed</button>
      </div>

      {message && <div className="comments-panel" style={{ marginBottom: 12 }}>{message}</div>}
      {error && <div className="comment-meta" style={{ marginBottom: 12 }}>Couldn&apos;t load imports: {error}</div>}
      {items === null && <div className="empty-state">loading…</div>}
      {items && items.length === 0 && !error && (
        <div className="empty-state">{view === "waiting" ? "Nothing waiting. Imports from Genius and Last.fm will show up here." : "Nothing dismissed."}</div>
      )}

      {items && items.length > 0 && view === "dismissed" && (
        <div className="review-toolbar import-actions">
          <button className="tab active" disabled={busy || selectedHere.length === 0} onClick={() => run("restore", selectedHere)}>
            {busy ? "working…" : `restore selected (${selectedHere.length})`}
          </button>
          <button className="tab" disabled={busy || restorable.length === 0}
            onClick={() => { if (confirm(`Put all ${restorable.length} dismissed songs back on the waiting list?${restorable.length < shown.length ? ` (${shown.length - restorable.length} already on the site are left out.)` : ""}`)) run("restore", restorable.map((s) => s.id)); }}>
            restore all ({restorable.length})
          </button>
        </div>
      )}

      {items && items.length > 0 && view === "waiting" && (
        <div className="review-toolbar import-actions">
          <button className="tab active" disabled={busy || selectedHere.length === 0} onClick={() => run("approve", selectedHere)}>
            {busy ? "working…" : `approve selected (${selectedHere.length})`}
          </button>
          <button className="tab" disabled={busy || selectedHere.length === 0} onClick={() => run("dismiss", selectedHere)}>
            dismiss selected
          </button>
          <button className="tab" disabled={busy || shown.length === 0}
            onClick={() => { if (confirm(`Approve all ${shown.length} songs?`)) run("approve", shown.map((s) => s.id)); }}>
            approve all ({shown.length})
          </button>
          <button className="tab danger-tab" disabled={busy || shown.length === 0}
            onClick={() => {
              if (confirm(`Dismiss all ${shown.length} songs? They won't be suggested again (you can bring them back from "dismissed").`)) run("dismiss", shown.map((s) => s.id));
            }}>
            dismiss all
          </button>
        </div>
      )}

      {Object.keys(groups).map((g) => (
        <div key={g}>
          <div className="review-group-head">
            <span className="section-label" style={{ margin: 0 }}>{g} ({groups[g].length})</span>
          </div>
          {groups[g].map((s) => (
            <label key={s.id} data-row-id={s.id} className="review-row" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} aria-label={`select ${s.title}`} />
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title">
                  {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{s.title}</a> : s.title}
                </div>
                <div className="review-row-meta">
                  {s.status_guess !== "unconfirmed" && <span className="feature-tag">{s.status_guess}</span>}
                  {s.version_of && <span className="feature-tag">version of {s.version_of}</span>}
                  {s.main_artist_name && <span>feature on {s.main_artist_name}&apos;s song</span>}
                  {s.extra?.featuring && <span>feat. {s.extra.featuring}</span>}
                  {s.extra?.producers && <span>prod. {s.extra.producers}</span>}
                  {s.extra?.length_sec != null && <span>{Math.floor(s.extra.length_sec / 60)}:{String(s.extra.length_sec % 60).padStart(2, "0")}</span>}
                  {s.release_date && <span>{s.release_date}</span>}
                  {view === "dismissed" && s.extra?.already_on_page && (
                    <span className="feature-tag">
                      {s.extra.already_on_page === "yes" ? "already on the site" : `already on the site as “${s.extra.already_on_page}”`}
                    </span>
                  )}
                  {view === "dismissed" && s.decided_at && <span>dismissed {new Date(s.decided_at).toLocaleDateString("en-GB")}</span>}
                  {s.extra?.listeners != null && <span>{s.extra.listeners.toLocaleString("en-GB")} listeners</span>}
                  {s.extra?.pageviews != null && <span>{s.extra.pageviews.toLocaleString("en-GB")} views</span>}
                </div>
              </div>
            </label>
          ))}
        </div>
      ))}

    </div>
  );
}
