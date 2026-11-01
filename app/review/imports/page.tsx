"use client";

// Songs found by the Genius and Last.fm imports, waiting for a look before
// they're added. Spotify imports don't come here: official songs are added
// straight away. Approved songs go into the undo history as one batch.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";
import { ModPage, ModToolbar, ModTabs, ModRow, ModButton, ModTag, ModBulkBar, ModNotice, ModLoading, ModEmpty, ModSection } from "../../components/Mod";

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
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Waiting songs, or ones dismissed before (kept so mistakes can be undone).
  const [view, setView] = useState<"waiting" | "dismissed">("waiting");
  const [artistFilter, setArtistFilter] = useState("");
  const [limit, setLimit] = useState(300);

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
  const artists = useMemo(() => {
    const n: Record<string, number> = {};
    (items ?? []).forEach((s) => { n[s.artist_name] = (n[s.artist_name] ?? 0) + 1; });
    return Object.entries(n).sort((a, b) => b[1] - a[1]);
  }, [items]);
  const shown = useMemo(() => {
    const list = (items ?? []).filter((s) => !artistFilter || s.artist_name === artistFilter);
    return view === "dismissed" ? list
      : [...list].sort((a, b) => popularity(b) - popularity(a) || a.title.localeCompare(b.title));
  }, [items, view, artistFilter]);
  const groups = useMemo(() => {
    const out: Record<string, Suggestion[]> = {};
    shown.slice(0, limit).forEach((s) => {
      const k = `${s.artist_name} · ${SOURCE_NAMES[s.source] ?? s.source}`;
      (out[k] = out[k] || []).push(s);
    });
    return out;
  }, [shown, limit]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function switchView(v: "waiting" | "dismissed") {
    if (v === view) return;
    setView(v); setItems(null); setMessage(null); setSelected(new Set()); setArtistFilter(""); setLimit(300);
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
    <ModPage
      title="Imported songs"
      intro={<>
        Songs the Genius, Last.fm and spreadsheet imports, and people&apos;s own music files (Local Cuts), found that aren&apos;t on the page yet. Genius often lists unreleased songs;
        Last.fm titles come from what people play, so leaks show up. Added songs are filed under their main song
        automatically when they&apos;re a version, and can be reversed from the <UndoHistoryLink />.
      </>}
    >
      <ModToolbar
        sticky
        right={items && items.length > 0 ? (
          <select className="sort-select" aria-label="Artist" value={artistFilter}
            onChange={(e) => { setArtistFilter(e.target.value); setSelected(new Set()); setLimit(300); }}>
            <option value="">all artists ({items.length.toLocaleString()})</option>
            {artists.map(([a, n]) => <option key={a} value={a}>{a} ({n.toLocaleString()})</option>)}
          </select>
        ) : undefined}
      >
        <ModTabs value={view} onChange={switchView} tabs={[
          { key: "waiting", label: "waiting", count: view === "waiting" ? items?.length ?? null : null },
          { key: "dismissed", label: "dismissed", count: view === "dismissed" ? items?.length ?? null : null },
        ]} />
        {items && items.length > 0 && (
          <>
            <ModButton onClick={() => setSelected(new Set(shown.map((s) => s.id)))}>tick all ({shown.length.toLocaleString()})</ModButton>
            {view === "waiting" ? (
              <>
                <ModButton kind="approve" busy={busy} disabled={shown.length === 0}
                  confirm={`Approve all ${shown.length.toLocaleString()} songs${artistFilter ? ` by ${artistFilter}` : ""}?`}
                  onClick={() => run("approve", shown.map((s) => s.id))}>approve all</ModButton>
                <ModButton kind="danger" busy={busy} disabled={shown.length === 0}
                  confirm={`Dismiss all ${shown.length.toLocaleString()} songs${artistFilter ? ` by ${artistFilter}` : ""}? They won't be suggested again (you can bring them back from "dismissed").`}
                  onClick={() => run("dismiss", shown.map((s) => s.id))}>dismiss all</ModButton>
              </>
            ) : (
              <ModButton busy={busy} disabled={restorable.length === 0}
                confirm={`Put all ${restorable.length} dismissed songs back on the waiting list?${restorable.length < shown.length ? ` (${shown.length - restorable.length} already on the site are left out.)` : ""}`}
                onClick={() => run("restore", restorable.map((s) => s.id))}>restore all ({restorable.length.toLocaleString()})</ModButton>
            )}
          </>
        )}
      </ModToolbar>

      <ModBulkBar count={selectedHere.length} onClear={() => setSelected(new Set())}>
        {view === "waiting" ? (
          <>
            <ModButton kind="approve" busy={busy} onClick={() => run("approve", selectedHere)}>approve</ModButton>
            <ModButton kind="dismiss" busy={busy} onClick={() => run("dismiss", selectedHere)}>dismiss</ModButton>
          </>
        ) : (
          <ModButton kind="approve" busy={busy} onClick={() => run("restore", selectedHere)}>restore</ModButton>
        )}
      </ModBulkBar>

      {message && <ModNotice onClose={() => setMessage(null)}>{message}</ModNotice>}
      {error && <ModNotice kind="error">Couldn&apos;t load imports: {error}</ModNotice>}
      {items === null && <ModLoading />}
      {items && items.length === 0 && !error && (
        <ModEmpty>{view === "waiting" ? "Nothing waiting. New imports will show up here." : "Nothing dismissed."}</ModEmpty>
      )}

      {Object.keys(groups).map((g) => (
        <div key={g}>
          <ModSection right={
            <button className="mod-link" onClick={() => setSelected((prev) => { const n = new Set(prev); groups[g].forEach((s) => n.add(s.id)); return n; })}>tick these</button>
          }>{g} ({groups[g].length})</ModSection>
          {groups[g].map((s) => (
            <ModRow
              key={s.id}
              check={{ checked: selected.has(s.id), onChange: () => toggle(s.id) }}
              title={s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}
              meta={<>
                {s.status_guess !== "unconfirmed" && <ModTag>{s.status_guess}</ModTag>}
                {s.version_of && <ModTag>version of {s.version_of}</ModTag>}
                {s.main_artist_name && <span>feature on {s.main_artist_name}&apos;s song</span>}
                {s.extra?.featuring && <span>feat. {s.extra.featuring}</span>}
                {s.extra?.producers && <span>prod. {s.extra.producers}</span>}
                {s.extra?.length_sec != null && <span>{Math.floor(s.extra.length_sec / 60)}:{String(s.extra.length_sec % 60).padStart(2, "0")}</span>}
                {s.album && <span>{s.album}</span>}
                {s.release_date && <span>{s.release_date}</span>}
                {view === "dismissed" && s.extra?.already_on_page && (
                  <ModTag>{s.extra.already_on_page === "yes" ? "already on the site" : `already on the site as “${s.extra.already_on_page}”`}</ModTag>
                )}
                {view === "dismissed" && s.decided_at && <span>dismissed {new Date(s.decided_at).toLocaleDateString("en-GB")}</span>}
                {s.extra?.listeners != null && <span>{s.extra.listeners.toLocaleString("en-GB")} listeners</span>}
                {s.extra?.pageviews != null && <span>{s.extra.pageviews.toLocaleString("en-GB")} views</span>}
              </>}
              actions={view === "waiting" ? <>
                <ModButton kind="approve" busy={busy} onClick={() => run("approve", [s.id])}>approve</ModButton>
                <ModButton kind="dismiss" busy={busy} onClick={() => run("dismiss", [s.id])}>dismiss</ModButton>
              </> : !s.extra?.already_on_page ? (
                <ModButton busy={busy} onClick={() => run("restore", [s.id])}>restore</ModButton>
              ) : undefined}
            />
          ))}
        </div>
      ))}
      {shown.length > limit && (
        <div style={{ marginTop: 14 }}>
          <ModButton onClick={() => setLimit(limit + 300)}>show 300 more ({(shown.length - limit).toLocaleString()} left)</ModButton>
        </div>
      )}
    </ModPage>
  );
}
