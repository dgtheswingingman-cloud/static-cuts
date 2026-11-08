"use client";

// The one search: artists (names and nicknames), people and songs, with song
// filters. Typing in the home page box or the header lands here. The
// filters live in the address, so a search can be shared ("every Carti leak
// from 2019 without a link").

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Supporter from "../components/Supporter";
import Strip from "../components/Strip";
import { thumb } from "@/lib/thumb";

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
  // Which results to show: everything, or one kind in full.
  const type = (params.get("type") ?? "all") as "all" | "songs" | "artists" | "albums" | "producers" | "people";
  const [showFilters, setShowFilters] = useState(false);

  const [results, setResults] = useState<Song[] | null>(null);
  const [total, setTotal] = useState(0);
  const [fuzzy, setFuzzy] = useState(false);
  // Very common or very short searches return the best matches only.
  const [capped, setCapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // People whose name matches, so you can find friends.
  const [people, setPeople] = useState<{ id: string; display_name: string | null; avatar_url: string | null }[]>([]);
  // Artists whose name or nickname matches.
  const [artists, setArtists] = useState<{ id: string; name: string; image_url: string | null }[] | null>(null);
  // Albums and projects whose name matches, and producers.
  const [albums, setAlbums] = useState<{ key: string; name: string; artist_id: string; artist: string; cover: string | null; year: string | null; songs: number; released: number }[]>([]);
  const [producers, setProducers] = useState<{ name: string; songs: number }[]>([]);
  // The top artist's numbers, and artists like them.
  const [topStats, setTopStats] = useState<{ songs: number; unreleased: number; followers: number } | null>(null);
  const [related, setRelated] = useState<{ id: string; name: string; image_url: string | null; why: string | null }[]>([]);
  // Song covers for the result rows.
  const [covers, setCovers] = useState<Record<string, string>>({});

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
    return data as { total: number; items: Song[]; fuzzy?: boolean; capped?: boolean };
  }

  const key = params.toString();
  useEffect(() => {
    const words = (params.get("q") ?? "").trim().replace(/[%_,()\\]/g, " ").trim();
    if (words.length < 2) { setPeople([]); setArtists(null); setAlbums([]); setProducers([]); return; }
    supabase.from("tracks").select("album, artist_id, cover_url, release_date, release_status, artists(name)").ilike("album", `%${words}%`).is("parent_track_id", null).limit(600)
      .then(({ data }) => {
        const m = new Map<string, { key: string; name: string; artist_id: string; artist: string; cover: string | null; year: string | null; songs: number; released: number }>();
        for (const t of (data ?? []) as unknown as { album: string; artist_id: string; cover_url: string | null; release_date: string | null; release_status: string | null; artists: { name: string } | null }[]) {
          const key = `${t.artist_id}|${t.album.toLowerCase()}`;
          const a = m.get(key) ?? { key, name: t.album, artist_id: t.artist_id, artist: t.artists?.name ?? "", cover: null, year: null, songs: 0, released: 0 };
          a.songs++;
          if (t.release_status === "released") a.released++;
          if (!a.cover && t.cover_url) a.cover = t.cover_url;
          if (t.release_date && (!a.year || t.release_date.slice(0, 4) < a.year)) a.year = t.release_date.slice(0, 4);
          m.set(key, a);
        }
        setAlbums([...m.values()].sort((a, b) => b.songs - a.songs).slice(0, 40));
      });
    supabase.from("tracks").select("producers").ilike("producers", `%${words}%`).limit(500).then(({ data }) => {
      const w = words.toLowerCase();
      const c = new Map<string, { name: string; songs: number }>();
      for (const t of (data ?? []) as { producers: string | null }[]) {
        for (const n of (t.producers ?? "").split(/\s*(?:,|&|\band\b|\+|\/)\s*/i).map((x) => x.trim()).filter(Boolean)) {
          if (!n.toLowerCase().includes(w)) continue;
          const r = c.get(n.toLowerCase()) ?? { name: n, songs: 0 };
          r.songs++;
          c.set(n.toLowerCase(), r);
        }
      }
      setProducers([...c.values()].sort((a, b) => b.songs - a.songs).slice(0, 30));
    });
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
      setTopStats(null); setRelated([]);
      const top = list[0];
      if (top) {
        Promise.all([
          supabase.from("tracks").select("id", { count: "exact", head: true }).eq("artist_id", top.id).is("parent_track_id", null),
          supabase.from("tracks").select("id", { count: "exact", head: true }).eq("artist_id", top.id).is("parent_track_id", null).neq("release_status", "released"),
          supabase.from("follows").select("artist_id", { count: "exact", head: true }).eq("artist_id", top.id),
        ]).then(([a, b, c]) => setTopStats({ songs: a.count ?? 0, unreleased: b.count ?? 0, followers: c.count ?? 0 }));
        supabase.rpc("rpc_similar_artists", { p_artist: top.id, p_limit: 10 }).then(({ data }) => setRelated((data as typeof related) ?? []));
      }
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
      setCapped(!!d.capped);
      // Nothing at all for plain words: counted (just the words) so missing
      // songs can be added.
      const words = (params.get("q") ?? "").trim();
      if (d.total === 0 && words.length >= 3 && !statuses.length && !from && !to && !link) {
        supabase.rpc("rpc_log_search_miss", { p_query: words, p_kind: "songs" });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const ids = (results ?? []).map((r) => r.id).filter((id) => !(id in covers)).slice(0, 200);
    if (!ids.length) return;
    supabase.from("tracks").select("id, cover_url").in("id", ids).then(({ data }) => {
      const m: Record<string, string> = {};
      for (const r of (data ?? []) as { id: string; cover_url: string | null }[]) m[r.id] = r.cover_url ?? "";
      setCovers((p) => ({ ...p, ...m }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

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

  const words = (params.get("q") ?? "").trim();
  const nArtists = artists?.length ?? 0;
  const counts: [typeof type, string, number | null][] = [
    ["all", "All", results ? total + nArtists + albums.length + producers.length + people.length : null],
    ["songs", "Songs", results ? total : null],
    ["artists", "Artists", nArtists],
    ["albums", "Albums", albums.length],
    ["producers", "Producers", producers.length],
    ["people", "People", people.length],
  ];
  const songRow = (s: Song) => (
    <Link key={s.id} href={`/song/${s.id}`} className="sp-version sr-song" data-st={s.status}>
      {covers[s.id]
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={thumb(covers[s.id])} alt="" width={52} height={52} className="sp-thumb sr-thumb" loading="lazy" />
        : <span className="sp-thumb sp-thumb-empty sr-thumb">SC//</span>}
      <span className="sp-version-text">
        <span className="sp-version-title">{s.title}</span>
        <span className="sp-sub">{[s.artist, s.album ?? (s.parent_track_id ? "version" : null), s.release_date?.slice(0, 4)].filter(Boolean).join("  •  ")}</span>
      </span>
      <span className={`feature-tag st st-${s.status}`}>{s.status}</span>
      {s.spotify_url && (
        <a className="tab sr-listen" href={s.spotify_url} target="_blank" rel="noopener noreferrer" aria-label="Listen on Spotify" onClick={(e) => e.stopPropagation()}>↗</a>
      )}
    </Link>
  );
  const albumTile = (a: (typeof albums)[number]) => (
    <Link key={a.key} href={`/artist/${a.artist_id}/eras#${encodeURIComponent(`album:${a.name.toLowerCase()}`)}`} className="hf-cover sr-album">
      {a.cover
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={thumb(a.cover)} alt="" loading="lazy" />
        : <span className="hf-cover-blank">SC//</span>}
      <span className="hf-cover-artist">{a.name}</span>
      <span className="hf-cover-title">{a.artist}</span>
      <span className="hf-cover-meta">{[a.year, a.released >= a.songs / 2 ? "album" : "project", `${a.songs} songs`].filter(Boolean).join(" · ")}</span>
    </Link>
  );
  const Sec = ({ icon, title, n, to }: { icon: string; title: string; n: number; to?: typeof type }) => (
    <div className="sp-head sr-head">
      <h2><span className="sr-icon" aria-hidden="true">{icon}</span>{title} ({n.toLocaleString("en-GB")})</h2>
      {to && type === "all" && <button onClick={() => update({ type: to })}>View all →</button>}
    </div>
  );
  const top = artists?.[0];

  // On computers the box is ready to type in; on phones it isn't, so the
  // keyboard doesn't cover the browse options.
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => { if (window.innerWidth >= 1024) box.current?.focus(); }, []);

  const BROWSE = [
    ["/genres", "Genres", "every style in the archive"],
    ["/producers", "Producers", "who made the beats"],
    ["/collabs", "Collab map", "who's worked with who"],
    ["/lists", "Lists", "collections people made"],
    ["/local", "Local Cuts", "your own files"],
  ] as const;

  return (
    <div className="wrap">
      <div className="sr-top">
        <div className="sr-title" aria-hidden="true">SEARCH<span>//</span></div>
        <div className="rd-sub">Find / discover / archive</div>
      </div>
      <h1 className="sr-h1">Search</h1>

      <div className="sr-box">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input
          placeholder="Artist, song, album, producer or person…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search"
          ref={box}
        />
        {q && <button aria-label="Clear" onClick={() => setQ("")}>✕</button>}
      </div>
      {/* Always one tap away, even mid-search. */}
      {hasAnything && (
        <nav className="sr-browse-row" aria-label="Browse">
          <span>Browse<em>//</em></span>
          {BROWSE.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
      )}

      <nav className="rd-chips sr-types" aria-label="Show">
        {counts.map(([k, label, n]) => (
          <button key={k} className={type === k ? "on" : undefined} aria-pressed={type === k} onClick={() => update({ type: k === "all" ? null : k })}>
            {label}{n !== null && words ? <span className="sr-count">({n.toLocaleString("en-GB")})</span> : null}
          </button>
        ))}
      </nav>

      <div className="sr-filterbar">
        <button className={`sr-filters-btn ${showFilters ? "on" : ""}`} aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
          Filters{statuses.length + (from ? 1 : 0) + (to ? 1 : 0) + (link ? 1 : 0) + (versions ? 0 : 1) > 0 ? ` (${statuses.length + (from ? 1 : 0) + (to ? 1 : 0) + (link ? 1 : 0) + (versions ? 0 : 1)})` : ""}
        </button>
        <select className="sr-select" value={statuses.length === 1 ? statuses[0] : statuses.length ? "many" : ""} aria-label="Status"
          onChange={(e) => update({ status: e.target.value && e.target.value !== "many" ? e.target.value : null })}>
          <option value="">Status: all</option>
          {statuses.length > 1 && <option value="many">Status: {statuses.length} picked</option>}
          {STATUSES.map((st) => <option key={st} value={st}>Status: {st}</option>)}
        </select>
        <select className="sr-select" value={from && from === to ? from : ""} aria-label="Year"
          onChange={(e) => update({ from: e.target.value || null, to: e.target.value || null })}>
          <option value="">Year: all</option>
          {years.map((y) => <option key={y} value={y}>Year: {y}</option>)}
        </select>
        <select className="sr-select" value={sort} onChange={(e) => update({ sort: e.target.value === "best" ? null : e.target.value })} aria-label="Sort">
          {SORTS.map(([v, label]) => <option key={v} value={v}>Sort: {label}</option>)}
        </select>
      </div>

      {showFilters && (
        <div className="search-filters">
          <span className="search-filters-label">status</span>
          <div className="search-filters-row">
            {STATUSES.map((st) => (
              <button key={st} className={`tab ${statuses.includes(st) ? "active" : ""}`} onClick={() => toggleStatus(st)}>{st}</button>
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
          </div>
        </div>
      )}

      {error && <div className="empty-state">Search failed: {error}</div>}
      {!hasAnything && (
        <>
          <div className="empty-state">Type an artist, a song, an album, a producer or someone&apos;s name, or pick a filter (try “leaked” and “no link”).</div>
          <div className="sp-head sr-head"><h2><span className="sr-icon" aria-hidden="true">✦</span>Browse</h2></div>
          <div className="sr-browse">
            {BROWSE.map(([href, label, sub]) => (
              <Link key={href} href={href} className="sr-browse-tile"><strong>{label}<em>//</em></strong><span>{sub}</span></Link>
            ))}
          </div>
        </>
      )}
      {hasAnything && !error && !results && <div className="empty-state">searching…</div>}

      {words && results && type === "all" && (
        <div className="sr-results-head">Results for &ldquo;{words}&rdquo; ({counts[0][2]?.toLocaleString("en-GB")})</div>
      )}

      {/* Songs */}
      {results && (type === "all" || type === "songs") && (
        <>
          <Sec icon="♫" title={fuzzy ? "Close matches" : capped ? "Top matches" : "Songs"} n={total} to="songs" />
          {results.length === 0 && <div className="empty-state">Nothing matches. Try fewer filters.</div>}
          {results.length > 0 && <div className="sp-versions">{(type === "all" ? results.slice(0, 5) : results).map(songRow)}</div>}
          {type === "songs" && results.length < total && (
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <button className="tab" disabled={loadingMore} onClick={more}>{loadingMore ? "loading…" : "more"}</button>
            </div>
          )}
        </>
      )}

      {/* Artists */}
      {artists && artists.length > 0 && (type === "all" || type === "artists") && (
        <>
          <Sec icon="◯" title="Artists" n={artists.length} to="artists" />
          {top && (
            <Link href={`/artist/${top.id}`} className="sr-top-artist">
              {top.image_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={thumb(top.image_url)} alt="" />
                : <span className="sp-thumb-empty">SC//</span>}
              <span className="sr-top-name">
                <strong>{top.name}</strong>
                <span>Artist</span>
              </span>
              {topStats && (
                <span className="sr-top-stats">
                  <span><b>{topStats.songs.toLocaleString("en-GB")}</b>songs</span>
                  <span><b>{topStats.unreleased.toLocaleString("en-GB")}</b>unreleased</span>
                  <span><b>{topStats.followers.toLocaleString("en-GB")}</b>followers</span>
                </span>
              )}
              <span className="sr-go" aria-hidden="true">→</span>
            </Link>
          )}
          {(type === "artists" ? artists.slice(1) : artists.slice(1, 7)).length > 0 && (
            <div className="sr-artists">
              {(type === "artists" ? artists.slice(1) : artists.slice(1, 7)).map((a) => (
                <Link key={a.id} href={`/artist/${a.id}`} className="sr-artist">
                  {a.image_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={thumb(a.image_url)} alt="" loading="lazy" />
                    : <span className="sr-artist-blank">{a.name.slice(0, 1)}</span>}
                  <span>{a.name}</span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {/* Albums & projects */}
      {albums.length > 0 && (type === "all" || type === "albums") && (
        <>
          <Sec icon="◎" title="Albums / projects" n={albums.length} to="albums" />
          {type === "all"
            ? <Strip className="hf-covers">{albums.slice(0, 12).map(albumTile)}</Strip>
            : <div className="sr-album-grid">{albums.map(albumTile)}</div>}
        </>
      )}

      {/* Producers */}
      {producers.length > 0 && (type === "all" || type === "producers") && (
        <>
          <Sec icon="⌁" title="Producers" n={producers.length} to="producers" />
          <div className="sp-versions">
            {(type === "all" ? producers.slice(0, 4) : producers).map((pr) => (
              <Link key={pr.name} href={`/producer/${encodeURIComponent(pr.name)}`} className="hf-trend">
                <span className="hf-trend-name">{pr.name}</span>
                <span className="sp-sub">{pr.songs} song{pr.songs === 1 ? "" : "s"}</span>
                <span aria-hidden="true" className="hf-chev">›</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* People */}
      {people.length > 0 && (type === "all" || type === "people") && (
        <>
          <Sec icon="☺" title="People" n={people.length} to="people" />
          <div className="sr-artists">
            {people.map((p) => (
              <Link key={p.id} href={`/profile/${p.id}`} className="sr-artist">
                {p.avatar_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={thumb(p.avatar_url)} alt="" loading="lazy" />
                  : <span className="sr-artist-blank">{(p.display_name ?? "?").slice(0, 1)}</span>}
                <span>{p.display_name ?? "anonymous"}<Supporter id={p.id} /></span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* Discover */}
      {top && related.length > 0 && type === "all" && (
        <>
          <div className="sp-head sr-head">
            <h2><span className="sr-icon" aria-hidden="true">✦</span>Discover <span className="sr-related">related to &ldquo;{top.name}&rdquo;</span></h2>
          </div>
          <Strip className="hf-covers">
            {related.map((a) => (
              <Link key={a.id} href={`/artist/${a.id}`} className="hf-cover">
                {a.image_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={thumb(a.image_url)} alt="" loading="lazy" />
                  : <span className="hf-cover-blank">{a.name.slice(0, 1)}</span>}
                <span className="hf-cover-artist">{a.name}</span>
                <span className="hf-cover-meta">{a.why ?? "related artist"}</span>
              </Link>
            ))}
          </Strip>
        </>
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
