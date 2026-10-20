"use client";

// Tracker disagrees: songs where a community tracker gives a different
// status from the one on the site. Blank ("unconfirmed") statuses are filled
// from trackers automatically; this list is only for real disagreements.
// "Use tracker" changes the song (in the undo history); "keep ours" leaves it
// and the tracker won't ask about that status again.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";

type Row = {
  id: string; track_id: string; title: string; artist_id: string; artist: string;
  current_status: string; tracker_status: string; tracker_title: string | null;
  source_title: string; source_url: string; spotify_url: string | null; created_at: string;
};

export default function TrackerDisagreementsPage() {
  const { loading: authLoading } = useAuth();
  const canModerate = useIsModerator();
  const router = useRouter();
  const [items, setItems] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [artistFilter, setArtistFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data, error: err } = await supabase.rpc("admin_tracker_disagreements");
    if (err) { setError(err.message); setItems([]); return; }
    setError(null);
    setItems((data as Row[]) ?? []);
    setSelected(new Set());
  }

  useEffect(() => {
    if (canModerate) load();
  }, [canModerate]);

  const artists = useMemo(() => Array.from(new Set((items ?? []).map((r) => r.artist))).sort(), [items]);
  const shown = useMemo(() => (items ?? []).filter((r) => !artistFilter || r.artist === artistFilter), [items, artistFilter]);

  async function decide(useTracker: boolean, ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    setMessage(null);
    const { data, error: err } = await supabase.rpc("admin_decide_tracker_disagreements", { p_ids: ids, p_use_tracker: useTracker });
    setBusy(false);
    if (err) { setMessage(`Couldn't save: ${err.message}`); return; }
    const done = new Set(ids);
    setItems((prev) => (prev ?? []).filter((r) => !done.has(r.id)));
    setSelected(new Set());
    if (ids.length > 1) {
      setMessage(useTracker
        ? `${data} song${data === 1 ? "" : "s"} changed to the tracker's status. You can reverse this from the undo history.`
        : `Kept ours for ${data}. The tracker won't ask about those again.`);
    }
  }


  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;
  const selectedHere = shown.filter((r) => selected.has(r.id)).map((r) => r.id);

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/control")}>← control room</button>
      <h1 className="detail-name page-title">Tracker Disagrees</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        A community tracker gives a different status from ours. Blank statuses are filled from trackers automatically;
        these are the ones where both sides say something different. A song Spotify confirms as released is never
        changed by a tracker. Changes can be reversed from the <UndoHistoryLink />.
      </div>

      {message && <div className="comments-panel" style={{ marginBottom: 12 }}>{message}</div>}
      {error && <div className="comment-meta" style={{ marginBottom: 12 }}>Couldn&apos;t load: {error}</div>}
      {items === null && <div className="empty-state">loading…</div>}
      {items && items.length === 0 && !error && <div className="empty-state">No disagreements. Trackers and the site agree.</div>}

      {items && items.length > 0 && (
        <div className="review-toolbar">
          <div className="review-toolbar-row">
            <select className="sort-select" aria-label="Artist" value={artistFilter}
              onChange={(e) => { setArtistFilter(e.target.value); setSelected(new Set()); }}>
              <option value="">all artists ({items.length})</option>
              {artists.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <button className="tab" onClick={() => setSelected(new Set(shown.map((r) => r.id)))}>select all</button>
            <button className="tab" onClick={() => setSelected(new Set())}>select none</button>
            <button className="tab active" disabled={busy || selectedHere.length === 0} onClick={() => decide(true, selectedHere)}>
              use tracker ({selectedHere.length})
            </button>
            <button className="tab" disabled={busy || selectedHere.length === 0} onClick={() => decide(false, selectedHere)}>
              keep ours
            </button>
          </div>
        </div>
      )}

      {shown.map((r) => (
        <div key={r.id} data-row-id={r.id} className="review-row">
          <input type="checkbox" checked={selected.has(r.id)} aria-label={`select ${r.title}`}
            onChange={() => setSelected((prev) => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">
              <Link href={`/song/${r.track_id}`}>{r.title}</Link>
            </div>
            <div className="review-row-meta">
              <span>{r.artist}</span>
              <span>ours: <strong>{r.current_status}</strong></span>
              <span>tracker: <strong>{r.tracker_status}</strong></span>
              <a href={r.source_url} target="_blank" rel="noopener noreferrer">{r.source_title}</a>
            </div>
          </div>
          <div className="review-row-actions">
            <button className="rating-chip" disabled={busy} onClick={() => decide(true, [r.id])}>use tracker</button>
            <button className="rating-chip" disabled={busy} onClick={() => decide(false, [r.id])}>keep ours</button>
          </div>
        </div>
      ))}

    </div>
  );
}
