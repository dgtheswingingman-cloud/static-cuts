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
  extra: { listeners?: number; playcount?: number; pageviews?: number; featuring?: string | null } | null;
  created_at: string;
  version_of: string | null;
};

const STATUSES = ["unconfirmed", "rumored", "teased", "snippet", "leaked", "announced", "released"];
const SOURCE_NAMES: Record<string, string> = { genius: "Genius", lastfm: "Last.fm", spotify: "Spotify", sheet: "Community sheet" };

export default function ImportReviewPage() {
  const { user, loading: authLoading } = useAuth();
  const isRealAdmin = useIsModerator();
  const router = useRouter();
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [artistFilter, setArtistFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "songs" | "features">("all");
  const [sort, setSort] = useState<"popular" | "az">("popular");
  const [statusOverride, setStatusOverride] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data, error: err } = await supabase.rpc("admin_import_suggestions", { p_limit: 5000 });
    if (err) { setError(err.message); setItems([]); return; }
    setError(null);
    setItems((data as Suggestion[]) ?? []);
    setSelected(new Set());
  }

  useEffect(() => {
    if (isRealAdmin) load();
  }, [isRealAdmin]);

  const artists = useMemo(() => Array.from(new Set((items ?? []).map((s) => s.artist_name))).sort(), [items]);
  const popularity = (s: Suggestion) => s.extra?.listeners ?? s.extra?.pageviews ?? -1;
  const shown = useMemo(() => {
    const list = (items ?? []).filter((s) =>
      (!artistFilter || s.artist_name === artistFilter) &&
      (kindFilter === "all" || (kindFilter === "features" ? !!s.main_artist_name : !s.main_artist_name)));
    return [...list].sort((a, b) =>
      sort === "popular" ? popularity(b) - popularity(a) || a.title.localeCompare(b.title) : a.title.localeCompare(b.title));
  }, [items, artistFilter, kindFilter, sort]);
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

  async function run(kind: "approve" | "dismiss", ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    setMessage(null);
    let done = 0;
    let problem: string | null = null;
    // Small batches: big artists (Kanye, Carti) take longer to check for
    // duplicates, and each call has an 8-second limit.
    const size = kind === "approve" ? 20 : 100;
    for (let i = 0; i < ids.length; i += size) {
      const chunk = ids.slice(i, i + size);
      if (ids.length > size) setMessage(`${kind === "approve" ? "Adding" : "Dismissing"}… ${Math.min(i, ids.length)} of ${ids.length}`);
      const { data, error: err } = kind === "approve"
        ? await supabase.rpc("admin_apply_import_suggestions", { p_ids: chunk, p_status: statusOverride || null })
        : await supabase.rpc("admin_dismiss_import_suggestions", { p_ids: chunk });
      if (err) { problem = err.message; break; }
      done += (data as number) ?? 0;
    }
    setBusy(false);
    const summary = kind === "approve"
      ? `${done} song${done === 1 ? "" : "s"} added. You can reverse this from the undo history.`
      : `${done} dismissed. They won't be suggested again.`;
    setMessage(problem ? `Stopped after ${done}: ${problem}` : summary);
    load();
  }

  if (!isRealAdmin) return <NoAccess loading={authLoading} who="moderators" />;
  const selectedHere = shown.filter((s) => selected.has(s.id)).map((s) => s.id);

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/review")}>← review</button>
      <h1 className="detail-name page-title">Imported Songs</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        Songs the Genius and Last.fm imports found that aren&apos;t on the page yet. Genius often lists unreleased songs;
        Last.fm titles come from what people play, so leaks show up. Added songs are filed under their main song
        automatically when they&apos;re a version, and can be reversed from the{" "}
        <UndoHistoryLink />.
      </div>

      {message && <div className="comments-panel" style={{ marginBottom: 12 }}>{message}</div>}
      {error && <div className="comment-meta" style={{ marginBottom: 12 }}>Couldn&apos;t load imports: {error}</div>}
      {items === null && <div className="empty-state">loading…</div>}
      {items && items.length === 0 && !error && (
        <div className="empty-state">Nothing waiting. Imports from Genius and Last.fm will show up here.</div>
      )}

      {items && items.length > 0 && (
        <div className="review-toolbar">
          <div className="review-toolbar-row">
            <span className="review-toolbar-label">show</span>
            <select id="import-artist-filter" className="sort-select" value={artistFilter}
              onChange={(e) => { setArtistFilter(e.target.value); setSelected(new Set()); }}>
              <option value="">all artists ({items.length})</option>
              {artists.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select id="import-kind-filter" className="sort-select" value={kindFilter}
              onChange={(e) => { setKindFilter(e.target.value as typeof kindFilter); setSelected(new Set()); }}>
              <option value="all">songs and features</option>
              <option value="songs">their own songs</option>
              <option value="features">features on other songs</option>
            </select>
            <select id="import-sort" className="sort-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="popular">most popular first</option>
              <option value="az">A to Z</option>
            </select>
            <span className="comment-meta">{shown.length} shown</span>
          </div>
          <div className="review-toolbar-row">
            <button className="tab" onClick={() => setSelected(new Set(shown.map((s) => s.id)))}>select all shown</button>
            <button className="tab" onClick={() => setSelected(new Set())}>select none</button>
            <span className="review-toolbar-label" style={{ marginLeft: 8 }}>add as</span>
            <select id="import-status" className="sort-select" value={statusOverride} onChange={(e) => setStatusOverride(e.target.value)}>
              <option value="">suggested status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="tab active" disabled={busy || selectedHere.length === 0} onClick={() => run("approve", selectedHere)}>
              {busy ? "working…" : `add selected (${selectedHere.length})`}
            </button>
            <button className="tab" disabled={busy || selectedHere.length === 0} onClick={() => run("dismiss", selectedHere)}>
              dismiss selected
            </button>
          </div>
        </div>
      )}

      {Object.keys(groups).map((g) => (
        <div key={g}>
          <div className="review-group-head">
            <span className="section-label" style={{ margin: 0 }}>{g} ({groups[g].length})</span>
            <button className="rating-chip" onClick={() => setSelected((prev) => new Set([...prev, ...groups[g].map((s) => s.id)]))}>
              select these
            </button>
          </div>
          {groups[g].map((s) => (
            <div key={s.id} className="review-row">
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} aria-label={`select ${s.title}`} />
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title">
                  {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}
                </div>
                <div className="review-row-meta">
                  {s.status_guess !== "unconfirmed" && <span className="feature-tag">{s.status_guess}</span>}
                  {s.version_of && <span className="feature-tag">version of {s.version_of}</span>}
                  {s.main_artist_name && <span>feature on {s.main_artist_name}&apos;s song</span>}
                  {s.extra?.featuring && <span>feat. {s.extra.featuring}</span>}
                  {s.release_date && <span>{s.release_date}</span>}
                  {s.extra?.listeners != null && <span>{s.extra.listeners.toLocaleString("en-GB")} listeners</span>}
                  {s.extra?.pageviews != null && <span>{s.extra.pageviews.toLocaleString("en-GB")} views</span>}
                </div>
              </div>
              <div className="review-row-actions">
                <button className="rating-chip" disabled={busy} onClick={() => run("approve", [s.id])}>add</button>
                <button className="rating-chip" disabled={busy} onClick={() => run("dismiss", [s.id])}>dismiss</button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
