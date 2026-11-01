"use client";

// Tracker disagrees: songs where a community tracker gives a different
// status from the one on the site. Blank ("unconfirmed") statuses are filled
// from trackers automatically; this list is only for real disagreements.
// "Use tracker" changes the song (in the undo history); "keep ours" leaves it
// and the tracker won't ask about that status again.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";
import { ModPage, ModToolbar, ModRow, ModButton, ModBulkBar, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

type Row = {
  id: string; track_id: string; title: string; artist_id: string; artist: string;
  current_status: string; tracker_status: string; tracker_title: string | null;
  source_title: string; source_url: string; spotify_url: string | null; created_at: string;
};

export default function TrackerDisagreementsPage() {
  const { loading: authLoading } = useAuth();
  const canModerate = useIsModerator();
  const [items, setItems] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [artistFilter, setArtistFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [limit, setLimit] = useState(200);

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
  const toggle = (id: string, on: boolean) => setSelected((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });

  return (
    <ModPage
      title="Tracker disagrees"
      intro={<>
        A community tracker gives a different status from ours. Blank statuses are filled from trackers automatically;
        these are the ones where both sides say something different. A song Spotify confirms as released is never
        changed by a tracker. Changes can be reversed from the <UndoHistoryLink />.
      </>}
    >
      {items && items.length > 0 && (
        <ModToolbar
          sticky
          right={<select className="sort-select" aria-label="Artist" value={artistFilter}
            onChange={(e) => { setArtistFilter(e.target.value); setSelected(new Set()); setLimit(200); }}>
            <option value="">all artists ({items.length.toLocaleString()})</option>
            {artists.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>}
        >
          <ModButton onClick={() => setSelected(new Set(shown.map((r) => r.id)))}>tick all ({shown.length.toLocaleString()})</ModButton>
        </ModToolbar>
      )}
      <ModBulkBar count={selectedHere.length} onClear={() => setSelected(new Set())}>
        <ModButton kind="approve" busy={busy} onClick={() => decide(true, selectedHere)}>use tracker</ModButton>
        <ModButton kind="dismiss" busy={busy} onClick={() => decide(false, selectedHere)}>keep ours</ModButton>
      </ModBulkBar>

      {message && <ModNotice onClose={() => setMessage(null)}>{message}</ModNotice>}
      {error && <ModNotice kind="error">Couldn&apos;t load: {error}</ModNotice>}
      {items === null && <ModLoading />}
      {items && items.length === 0 && !error && <ModEmpty>No disagreements. Trackers and the site agree.</ModEmpty>}

      {shown.slice(0, limit).map((r) => (
        <ModRow
          key={r.id}
          check={{ checked: selected.has(r.id), onChange: (on) => toggle(r.id, on) }}
          title={<Link href={`/song/${r.track_id}`}>{r.title}</Link>}
          meta={<>
            <span>{r.artist}</span>
            <span>ours: <strong>{r.current_status}</strong></span>
            <span>tracker: <strong>{r.tracker_status}</strong></span>
            <a href={r.source_url} target="_blank" rel="noopener noreferrer">{r.source_title}</a>
          </>}
          actions={<>
            <ModButton kind="approve" busy={busy} onClick={() => decide(true, [r.id])}>use tracker</ModButton>
            <ModButton kind="dismiss" busy={busy} onClick={() => decide(false, [r.id])}>keep ours</ModButton>
          </>}
        />
      ))}
      {shown.length > limit && (
        <div style={{ marginTop: 14 }}>
          <ModButton onClick={() => setLimit(limit + 200)}>show 200 more ({(shown.length - limit).toLocaleString()} left)</ModButton>
        </div>
      )}
    </ModPage>
  );
}
