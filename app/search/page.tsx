"use client";

// The one search: artists (names and nicknames), people and songs, with song
// filters. Typing in the home page box or the header lands here. The
// filters live in the address, so a search can be shared ("every Carti leak
// from 2019 without a link").

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Supporter from "../components/Supporter";

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
  const [fuzzy, setFuzzy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // People whose name matches, so you can find friends.
  const [people, setPeople] = useState<{ id: string; display_name: string | null; avatar_url: string | null }[]>([]);
  // Artists whose name or nickname matches.
  const [artists, setArtists] = useState<{ id: string; name: string; image_url: string | null }[] | null>(null);

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
    return data as { total: number; items: Song[]; fuzzy?: boolean };
  }

  const key = params.toString();
  useEffect(() => {
    const words = (params.get("q") ?? "").trim().replace(/[%_,()\\]/g, " ").trim();
    if (words.length < 2) { setPeople([]); setArtists(null); return; }
    supabase.from("profiles").select("id, display_name, avatar_url").ilike("display_name", `%${words}%`).limit(6)
      .then(({ data }) => setPeople((data as typeof people) ?? []));
    setArtists(null);
    Promise.all([
      supabase.from("artists").select("id, name, image_url").ilike("name", `%${words}%`).limit(12),
      supabase.from("artist_aliases").select("artist_id, artists!artist_id(id, name, image_url)").ilike("alias", `%${words}%`).limit(12),
    ]).then(([byName, byAlias]) => {
      const seen = new Map<string, { id: string; name: string; image_url: string | null }>();
      for (const a of (byName.data ?? []) as { id: string; name: string; image_url: string | null }[]) seen.set(a.id, a);
      for (const r of (byAlias.data ?? []) as unknown as { artists: { id: string; name: string; image_url: string | null } | null }[]) {
        if (r.artists && !seen.has(r.artists.id)) seen.set(r.artists.id, r.artists);
      }
      // Exact names first, then names that start with the words.
      const w = words.toLowerCase();
      const list = [...seen.values()].sort((a, b) => {
        const rank = (n: string) => (n.toLowerCase() === w ? 0 : n.toLowerCase().startsWith(w) ? 1 : 2);
        return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
      }).slice(0, 12);
      setArtists(list);
      // An artist people look for that isn't here: counted, so they get added sooner.
      if (list.length === 0 && words.length >= 3) supabase.rpc("rpc_log_search_miss", { p_query: words, p_kind: "artists" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("q")]);
  const hasAnything = !!(params.get("q") || statuses.length || from || to || link);
  useEffect(() => {
    setError(null);
    if (!hasAnything) { setResults(null); setTotal(0); return; }
    setResults(null);
    fetchPage(0).then((d) => {
      if (!d) return;
      setResults(d.items);
      setTotal(d.total);
      setFuzzy(!!d.fuzzy);
      // Nothing at all for plain words: counted (just the words) so missing
      // songs can be added.
      const words = (params.get("q") ?? "").trim();
      if (d.total === 0 && words.length >= 3 && !statuses.length && !from && !to && !link) {
        supabase.rpc("rpc_log_search_miss", { p_query: words, p_kind: "songs" });
      }
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
      <h1 className="detail-name page-title">Search</h1>

      <input
        className="search-input"
        style={{ width: "100%", marginBottom: 14 }}
        placeholder="Artist, song, album, producer or person…"
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
      {!hasAnything && <div className="empty-state">Type an artist, a song or someone&apos;s name, or pick a filter (try “leaked” and “no link”).</div>}
      {hasAnything && !error && !results && <div className="empty-state">searching…</div>}
      {artists && artists.length > 0 && (
        <>
          <div className="section-label">Artists</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
            {artists.map((a) => (
              <Link key={a.id} href={`/artist/${a.id}`} style={{ display: "flex", gap: 8, alignItems: "center", textDecoration: "none", color: "var(--bone)" }}>
                {a.image_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={a.image_url} alt="" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} />
                  : <span style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--surface)", display: "inline-block" }} />}
                <span style={{ fontFamily: "var(--font-inter)", fontSize: "0.95rem" }}>{a.name}</span>
              </Link>
            ))}
          </div>
        </>
      )}
      {people.length > 0 && (
        <>
          <div className="section-label">People</div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
            {people.map((p) => (
              <Link key={p.id} href={`/profile/${p.id}`} style={{ display: "flex", gap: 8, alignItems: "center", textDecoration: "none", color: "var(--bone)" }}>
                {p.avatar_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} />
                  : <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--surface)", display: "inline-block" }} />}
                <span style={{ fontFamily: "var(--font-inter)", fontSize: "0.9rem" }}>{p.display_name ?? "anonymous"}<Supporter id={p.id} /></span>
              </Link>
            ))}
          </div>
        </>
      )}
      {results && (
        <div className="section-label">
          {fuzzy
            ? `No exact matches. ${total.toLocaleString("en-GB")} close one${total === 1 ? "" : "s"}:`
            : `${total.toLocaleString("en-GB")} song${total === 1 ? "" : "s"}`}
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
