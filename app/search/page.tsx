"use client";

// Site-wide song search with filters. The filters live in the address, so a
// search can be shared ("every Carti leak from 2019 without a link").

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Song = {
  id: string; title: string; artist_id: string; artist: string; spotify_url: string | null;
  album: string | null; release_date: string | null; status: string; parent_track_id: string | null;
};

const STATUSES = ["released", "leaked", "snippet", "teased", "announced", "rumored", "removed", "unconfirmed"];
const SORTS: [string, string][] = [["best", "best match"], ["new", "recently added"], ["released", "release date"], ["az", "A–Z"]];

function SearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const statuses = (params.get("status") ?? "").split(",").filter(Boolean);
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const link = params.get("link") ?? ""; // "", "yes", "no"
  const versions = params.get("versions") !== "no";
  const sort = params.get("sort") ?? "best";

  const [results, setResults] = useState<Song[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    router.replace(`/search?${next.toString()}`, { scroll: false });
  }

  // Typing updates the address after a short pause.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q.trim()) update({ q: q.trim() || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function fetchPage(offset: number) {
    const { data, error: err } = await supabase.rpc("rpc_search_songs", {
      p_q: params.get("q") ?? "",
      p_statuses: statuses.length ? statuses : null,
      p_year_from: from ? Number(from) : null,
      p_year_to: to ? Number(to) : null,
      p_has_link: link === "yes" ? true : link === "no" ? false : null,
      p_versions: versions,
      p_sort: sort,
      p_offset: offset,
    });
    if (err) { setError(err.message); return null; }
    return data as { total: number; items: Song[] };
  }

  const key = params.toString();
  const hasAnything = !!(params.get("q") || statuses.length || from || to || link);
  useEffect(() => {
    setError(null);
    if (!hasAnything) { setResults(null); setTotal(0); return; }
    setResults(null);
    fetchPage(0).then((d) => {
      if (!d) return;
      setResults(d.items);
      setTotal(d.total);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function more() {
    setLoadingMore(true);
    const d = await fetchPage(results?.length ?? 0);
    setLoadingMore(false);
    if (d) setResults((prev) => [...(prev ?? []), ...d.items]);
  }

  function toggleStatus(s: string) {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    update({ status: next.join(",") || null });
  }

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 1979 }, (_, i) => String(thisYear - i));

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← home</button>
      <h1 className="detail-name page-title">Search songs</h1>

      <input
        className="search-input"
        style={{ width: "100%", marginBottom: 14 }}
        placeholder="Song title, album or producer…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />

      <div className="search-filters">
        <span className="search-filters-label">status</span>
        <div className="search-filters-row">
          {STATUSES.map((s) => (
            <button key={s} className={`tab ${statuses.includes(s) ? "active" : ""}`} onClick={() => toggleStatus(s)}>{s}</button>
          ))}
        </div>
        <span className="search-filters-label">released</span>
        <div className="search-filters-row">
          <select className="sort-select" value={from} onChange={(e) => update({ from: e.target.value || null })} aria-label="From year">
            <option value="">from any year</option>
            {years.map((y) => <option key={y} value={y}>from {y}</option>)}
          </select>
          <select className="sort-select" value={to} onChange={(e) => update({ to: e.target.value || null })} aria-label="To year">
            <option value="">to any year</option>
            {years.map((y) => <option key={y} value={y}>to {y}</option>)}
          </select>
        </div>
        <span className="search-filters-label">link</span>
        <div className="search-filters-row">
          {[["", "any"], ["yes", "has a link"], ["no", "no link"]].map(([v, label]) => (
            <button key={v} className={`tab ${link === v ? "active" : ""}`} onClick={() => update({ link: v || null })}>{label}</button>
          ))}
        </div>
        <span className="search-filters-label">show</span>
        <div className="search-filters-row">
          <button className={`tab ${versions ? "" : "active"}`} onClick={() => update({ versions: versions ? "no" : null })}>
            {versions ? "" : "✓ "}main songs only
          </button>
          <select className="sort-select" value={sort} onChange={(e) => update({ sort: e.target.value === "best" ? null : e.target.value })} aria-label="Sort">
            {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="empty-state">Search failed: {error}</div>}
      {!hasAnything && <div className="empty-state">Type a song name, or pick a filter (try “leaked” and “no link”).</div>}
      {hasAnything && !error && !results && <div className="empty-state">searching…</div>}
      {results && (
        <div className="section-label">
          {total.toLocaleString("en-GB")} song{total === 1 ? "" : "s"}
        </div>
      )}
      {results && results.length === 0 && <div className="empty-state">Nothing matches. Try fewer filters.</div>}
      {results?.map((s) => (
        <div key={s.id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title"><Link href={`/song/${s.id}`}>{s.title}</Link></div>
            <div className="review-row-meta">
              <Link href={`/artist/${s.artist_id}`}>{s.artist}</Link>
              <span className="feature-tag">{s.status}</span>
              {s.parent_track_id && <span className="feature-tag">version</span>}
              {s.album && <span>{s.album}</span>}
              {s.release_date && <span>{s.release_date.slice(0, 4)}</span>}
            </div>
          </div>
          {s.spotify_url && <a className="listen-link" href={s.spotify_url} target="_blank" rel="noopener noreferrer">listen</a>}
        </div>
      ))}
      {results && results.length < total && (
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button className="tab" disabled={loadingMore} onClick={more}>{loadingMore ? "loading…" : "more"}</button>
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="wrap"><div className="empty-state">loading…</div></div>}>
      <SearchInner />
    </Suspense>
  );
}
