"use client";

// Songs found by the Genius and Last.fm imports, waiting for a look before
// they're added. Spotify imports don't come here: official songs are added
// straight away. Approved songs go into the undo history as one batch.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsRealAdmin } from "../../useIsAdmin";

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
  extra: { listeners?: number; playcount?: number; pageviews?: number } | null;
  created_at: string;
};

const STATUSES = ["unconfirmed", "rumored", "teased", "snippet", "leaked", "announced", "released"];
const SOURCE_NAMES: Record<string, string> = { genius: "Genius", lastfm: "Last.fm", spotify: "Spotify" };

export default function ImportReviewPage() {
  const { user, loading: authLoading } = useAuth();
  const isRealAdmin = useIsRealAdmin();
  const router = useRouter();
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [artistFilter, setArtistFilter] = useState("");
  const [statusOverride, setStatusOverride] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && (!user || !isRealAdmin)) router.push("/");
  }, [authLoading, user, isRealAdmin, router]);

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
  const shown = useMemo(() => (items ?? []).filter((s) => !artistFilter || s.artist_name === artistFilter), [items, artistFilter]);
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
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { data, error: err } = kind === "approve"
        ? await supabase.rpc("admin_apply_import_suggestions", { p_ids: chunk, p_status: statusOverride || null })
        : await supabase.rpc("admin_dismiss_import_suggestions", { p_ids: chunk });
      if (err) { setMessage(`Stopped: ${err.message}`); break; }
      done += (data as number) ?? 0;
    }
    setBusy(false);
    setMessage(kind === "approve"
      ? `${done} song${done === 1 ? "" : "s"} added. You can reverse this from the undo history.`
      : `${done} dismissed. They won't be suggested again.`);
    load();
  }

  if (!isRealAdmin) return null;
  const selectedHere = shown.filter((s) => selected.has(s.id)).map((s) => s.id);

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/review")}>← back to review</button>
      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>Imported Songs</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        Songs the Genius and Last.fm imports found that aren&apos;t on the page yet. Genius often lists unreleased songs;
        Last.fm titles come from what people play, so leaks show up (with listener counts). Approve adds them; versions
        like &quot;(Demo)&quot; are filed under their main song automatically.{" "}
        <Link href="/admin/batches" className="listen-link">undo history</Link>
      </div>

      {message && <div className="comments-panel" style={{ marginBottom: 12 }}>{message}</div>}
      {error && <div className="comment-meta" style={{ marginBottom: 12 }}>Couldn&apos;t load imports: {error}</div>}
      {items === null && <div className="empty-state">loading…</div>}
      {items && items.length === 0 && !error && (
        <div className="empty-state">Nothing waiting. Imports from Genius and Last.fm will show up here.</div>
      )}

      {items && items.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <select id="import-artist-filter" className="sort-select" value={artistFilter} onChange={(e) => { setArtistFilter(e.target.value); setSelected(new Set()); }}>
            <option value="">all artists ({items.length})</option>
            {artists.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className="tab" onClick={() => setSelected(new Set(shown.map((s) => s.id)))}>select all</button>
          <button className="tab" onClick={() => setSelected(new Set())}>select none</button>
          <label className="comment-meta" htmlFor="import-status">add as</label>
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
      )}

      {Object.keys(groups).map((g) => (
        <div key={g} style={{ marginBottom: 16 }}>
          <div className="section-label" style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            {g}
            <button className="rating-chip" onClick={() => setSelected((prev) => new Set([...prev, ...groups[g].map((s) => s.id)]))}>
              select these
            </button>
          </div>
          {groups[g].map((s) => (
            <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "3px 0", flexWrap: "wrap" }}>
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} aria-label={`select ${s.title}`} />
              <span className="comment-body" style={{ minWidth: 0 }}>
                {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--bone)" }}>{s.title}</a> : s.title}
              </span>
              {s.status_guess !== "unconfirmed" && <span className="feature-tag">{s.status_guess}</span>}
              {s.main_artist_name && <span className="comment-meta">feature on {s.main_artist_name}&apos;s song</span>}
              {s.release_date && <span className="comment-meta">{s.release_date}</span>}
              {s.extra?.listeners != null && <span className="comment-meta">{s.extra.listeners.toLocaleString("en-GB")} listeners</span>}
              {s.extra?.pageviews != null && <span className="comment-meta">{s.extra.pageviews.toLocaleString("en-GB")} views</span>}
              <span style={{ display: "inline-flex", gap: 6 }}>
                <button className="rating-chip" disabled={busy} onClick={() => run("approve", [s.id])}>add</button>
                <button className="rating-chip" disabled={busy} onClick={() => run("dismiss", [s.id])}>dismiss</button>
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
