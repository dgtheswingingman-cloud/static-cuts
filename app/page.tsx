"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { readPicks, savePicks } from "./components/picks";
import SinceLastVisit from "./components/SinceLastVisit";
import Landing from "./components/Landing";
import AuthBar from "./AuthBar";
import { useAuth } from "./AuthProvider";
import { useIsAdmin, usePersonalUser } from "./useIsAdmin";
import OnThisDay from "./OnThisDay";
import { local as safeLocal } from "@/lib/safeStorage";
import type { CSSProperties } from "react";
import HeroCollage from "./components/HeroCollage";
import LiveFeed from "./components/LiveFeed";
import RadarColumn from "./components/RadarColumn";
import MobileStrips from "./components/MobileStrips";

type Artist = {
  id: string;
  name: string;
  status: string | null;
  trackCount: number;
  collectedCount: number;
  avgRating: number | null;
  ratingCount: number;
  aliases: string[];
  genres: { slug: string; tag: string }[];
};

type TrackResult = {
  id: string;
  title: string;
  artist_id: string;
  spotify_url: string | null;
  artists: { name: string } | null;
};

type ArtistSortKey = "name-asc" | "name-desc" | "count-desc" | "count-asc" | "pct-desc" | "pct-asc" | "rating-desc" | "rating-asc";

export default function HomePage() {
  const user = usePersonalUser();
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const [creatingArtist, setCreatingArtist] = useState(false);
  const [artists, setArtists] = useState<Artist[] | null>(null);
  const [genreFilter, setGenreFilter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [trackResults, setTrackResults] = useState<TrackResult[]>([]);
  const [trackSearchLoading, setTrackSearchLoading] = useState(false);
  const [trackSearchError, setTrackSearchError] = useState<string | null>(null);
  const [artistSort, setArtistSort] = useState<ArtistSortKey>("name-asc");
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [followBusyId, setFollowBusyId] = useState<string | null>(null);
  const [pinBusyId, setPinBusyId] = useState<string | null>(null);
  const [pickingRandom, setPickingRandom] = useState(false);
  // Artists picked on the first-visit page before signing up.
  const [picks, setPicks] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => { setPicks(readPicks()); }, []);

  const SORT_STORAGE_KEY = "static_cuts_artist_sort";

  // Artist photos for the cards and the Live rows.
  const [photos, setPhotos] = useState<Record<string, string>>({});
  useEffect(() => {
    supabase.from("artists").select("id, image_url").not("image_url", "is", null).limit(1000)
      .then(({ data }) => setPhotos(Object.fromEntries(((data ?? []) as { id: string; image_url: string }[]).map((r) => [r.id, r.image_url]))));
  }, []);

  useEffect(() => {
    const stored = safeLocal.get(SORT_STORAGE_KEY) as ArtistSortKey | null;
    if (stored) setArtistSort(stored);
  }, []);

  function updateArtistSort(sort: ArtistSortKey) {
    setArtistSort(sort);
    safeLocal.set(SORT_STORAGE_KEY, sort);
  }

  useEffect(() => {
    async function load() {
      try {
        // One call: every artist with its song count, community rating,
        // nicknames and (signed in, not admin mode) how many you've collected.
        const { data, error: err } = await supabase.rpc("rpc_home_artists", { p_mine: !!user });
        if (err) throw err;
        type Row = {
          id: string; name: string; status: string | null; track_count: number; collected: number;
          avg_rating: number | null; rating_count: number; aliases: string[] | null;
          genres: { slug: string; tag: string }[] | null;
        };
        setArtists(((data as Row[]) ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status,
          trackCount: a.track_count,
          collectedCount: a.collected,
          avgRating: a.avg_rating === null ? null : Number(a.avg_rating),
          ratingCount: a.rating_count,
          aliases: a.aliases ?? [],
          genres: a.genres ?? [],
        })));
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    }
    load();
  }, [user]);

  useEffect(() => {
    async function loadFollowed() {
      if (!user) { setFollowedIds(new Set()); setPinnedIds(new Set()); return; }
      const { data } = await supabase.from("follows").select("artist_id, pinned").eq("user_id", user.id);
      setFollowedIds(new Set((data ?? []).map((r) => r.artist_id)));
      setPinnedIds(new Set((data ?? []).filter((r) => r.pinned).map((r) => r.artist_id)));
    }
    loadFollowed();
  }, [user]);

  // Signed in with picks from before: follow them for real, once.
  useEffect(() => {
    if (!user || isAdmin) return;
    const local = readPicks();
    if (local.length === 0) return;
    supabase.rpc("rpc_follow_many", { p_artist_ids: local }).then(({ error: err }) => {
      if (err) return;
      savePicks([]);
      setPicks([]);
      setFollowedIds((prev) => new Set([...prev, ...local]));
    });
  }, [user, isAdmin]);

  // Artist searches that find nothing are counted (just the words), so
  // missing artists can be added.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 3 || !artists) return;
    const needle = term.toLowerCase();
    const found = artists.some((a) => a.name.toLowerCase().includes(needle) || a.aliases.some((x) => x.toLowerCase().includes(needle)));
    if (found) return;
    const t = setTimeout(() => {
      if (trackResults.length === 0) supabase.rpc("rpc_log_search_miss", { p_query: term, p_kind: "artists" });
    }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, artists, trackResults.length]);

  async function togglePin(artistId: string) {
    if (!user) return;
    setPinBusyId(artistId);
    const nowPinned = !pinnedIds.has(artistId);
    const { error: err } = await supabase.from("follows").update({ pinned: nowPinned }).eq("user_id", user.id).eq("artist_id", artistId);
    setPinBusyId(null);
    if (err) {
      alert("Couldn't update pin: " + err.message);
      return;
    }
    setPinnedIds((prev) => {
      const n = new Set(prev);
      if (nowPinned) n.add(artistId); else n.delete(artistId);
      return n;
    });
  }

  async function pickRandomArtist() {
    setPickingRandom(true);
    // Fetch all ids and pick one client-side -- fine at this catalog size
    // (a few dozen artists), and avoids any quirks with server-side random().
    const { data, error: err } = await supabase.from("artists").select("id");
    setPickingRandom(false);
    if (err || !data || data.length === 0) { alert("Couldn't pick a random artist."); return; }
    const pick = data[Math.floor(Math.random() * data.length)];
    router.push(`/artist/${pick.id}`);
  }

  async function toggleFollow(artistId: string) {
    if (!user) { window.location.href = "/login"; return; }
    setFollowBusyId(artistId);
    if (followedIds.has(artistId)) {
      await supabase.from("follows").delete().eq("user_id", user.id).eq("artist_id", artistId);
      setFollowedIds((prev) => { const n = new Set(prev); n.delete(artistId); return n; });
    } else {
      await supabase.from("follows").insert({ user_id: user.id, artist_id: artistId });
      setFollowedIds((prev) => new Set(prev).add(artistId));
    }
    setFollowBusyId(null);
  }

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setTrackResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setTrackSearchLoading(true);
      const { data, error: searchErr } = await supabase
        .from("tracks")
        .select("id, title, artist_id, spotify_url, artists!artist_id(name)")
        .or(`title.ilike.%${q}%,aliases.ilike.%${q}%`)
        .limit(25);
      setTrackSearchLoading(false);
      if (searchErr) {
        console.error("track search failed:", searchErr);
        setTrackSearchError(searchErr.message);
        setTrackResults([]);
      } else {
        setTrackSearchError(null);
        setTrackResults((data as any) ?? []);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  const q = query.trim();
  const showTrackSection = q.length >= 2;

  // With no search query: logged-in users see ONLY their followed artists
  // (this is the personalized home feed). Logged-out visitors, and anyone
  // actively searching, still see/search the full catalog -- search is how
  // you find something to follow in the first place.
  const baseList = (() => {
    if (!artists) return null;
    if (q) {
      const needle = q.toLowerCase();
      return artists.filter((a) => a.name.toLowerCase().includes(needle) || a.aliases.some((n) => n.toLowerCase().includes(needle)));
    }
    if (user) return artists.filter((a) => followedIds.has(a.id));
    if (picks.length > 0 && !showAll) return artists.filter((a) => picks.includes(a.id));
    return artists;
  })();

  // Genres among the artists shown, most common first, for the filter chips.
  const genreChips = (() => {
    const counts = new Map<string, { slug: string; tag: string; n: number }>();
    for (const a of baseList ?? []) for (const g of a.genres) {
      const c = counts.get(g.slug) ?? { ...g, n: 0 };
      c.n++;
      counts.set(g.slug, c);
    }
    return [...counts.values()].filter((c) => c.n >= 2 || c.slug === genreFilter).sort((a, b) => b.n - a.n).slice(0, 14);
  })();

  const matchedArtists = (() => {
    if (!baseList) return null;
    const sorted = genreFilter ? baseList.filter((a) => a.genres.some((g) => g.slug === genreFilter)) : [...baseList];
    const pct = (a: Artist) => (a.trackCount > 0 ? a.collectedCount / a.trackCount : 0);
    switch (artistSort) {
      case "name-asc": sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "name-desc": sorted.sort((a, b) => b.name.localeCompare(a.name)); break;
      case "count-desc": sorted.sort((a, b) => b.trackCount - a.trackCount); break;
      case "count-asc": sorted.sort((a, b) => a.trackCount - b.trackCount); break;
      case "pct-desc": sorted.sort((a, b) => pct(b) - pct(a)); break;
      case "pct-asc": sorted.sort((a, b) => pct(a) - pct(b)); break;
      case "rating-desc":
        sorted.sort((a, b) => {
          if (a.avgRating === null && b.avgRating === null) return 0;
          if (a.avgRating === null) return 1; // unrated always last
          if (b.avgRating === null) return -1;
          return b.avgRating - a.avgRating;
        });
        break;
      case "rating-asc":
        sorted.sort((a, b) => {
          if (a.avgRating === null && b.avgRating === null) return 0;
          if (a.avgRating === null) return 1; // unrated always last
          if (b.avgRating === null) return -1;
          return a.avgRating - b.avgRating;
        });
        break;
    }
    // Pinned artists always float to the top, regardless of the sort
    // above -- pinning is about "always show me this first", not just
    // another sort criterion.
    sorted.sort((a, b) => Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id)));
    return sorted;
  })();

  const sectionLabel = q ? "Search results" : user ? "Artists you follow" : "In the archive";

  async function createArtist() {
    const name = window.prompt("Artist name:");
    if (!name || !name.trim()) return;
    setCreatingArtist(true);
    const { data: newId, error: err } = await supabase.rpc("admin_create_artist", { p_name: name.trim() });
    setCreatingArtist(false);
    if (err || !newId) { alert(err?.message ?? "Couldn't create artist."); return; }
    router.push(`/artist/${newId}`);
  }

  return (
    <div className="wrap home-wide">
      <div className="hero">
        <HeroCollage artistIds={user ? [...followedIds] : undefined} />
        <Link href="/" onClick={() => setQuery("")} style={{ textDecoration: "none" }}>
          <h1 className="wordmark">
            STATIC CUTS<span className="slash">//</span>
          </h1>
        </Link>
        <div className="tagline">cut through the noise</div>
        <AuthBar />
        <div className="search-shell">
          <input
            className="search-input"
            type="text"
            placeholder="Search any artist or track — Playboi Carti, Location, anyone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <nav className="home-nav" aria-label="Explore">
          <Link href="/weekly">this week</Link>
          <Link href="/new">what&apos;s new</Link>
          <Link href="/wanted">most wanted</Link>
          <Link href="/search">search songs</Link>
          <Link href="/radar">release radar</Link>
          <Link href="/lists">lists</Link>
          <Link href="/collabs">collab map</Link>
          <Link href="/local">local cuts</Link>
          <Link href="/producers">producers</Link>
          <Link href="/help">help wanted</Link>
          <Link href="/faq">faq</Link>
        </nav>
      </div>
      {!q && <MobileStrips photos={photos} />}
      <div className={`home-cols ${q ? "searching" : ""}`}>
      {!q && <LiveFeed photos={photos} />}
      <div className="home-main">

      {!user && !isAdmin && !q && (
        <div className={picks.length === 0 ? "" : "comments-panel first-visit"}>
          {picks.length === 0 ? (
            <Landing artists={artists?.length ?? 0} songs={artists ? artists.reduce((t: number, a: Artist) => t + (a.trackCount ?? 0), 0) : null} />
          ) : (
            <>
              {showAll ? "Showing everyone. " : "Showing your picks. "}
              <button className="text-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
                onClick={() => setShowAll(!showAll)}>{showAll ? "back to your picks" : "see everyone"}</button>
              {" · "}<Link href="/start" className="text-link">change picks</Link>
              {" · "}<Link href="/login" className="text-link">make an account</Link> to keep them and get alerts when they leak or release.
            </>
          )}
        </div>
      )}

      {!q && !isAdmin && user && <SinceLastVisit who={user.id} />}
      {!q && !isAdmin && !user && picks.length > 0 && <SinceLastVisit who="picks" artistIds={picks} />}

      {showTrackSection && (
        <>
          <div className="section-label" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span>Tracks matching &quot;{q}&quot;</span>
            <Link href={`/search?q=${encodeURIComponent(q)}`} className="text-link" style={{ textTransform: "none", letterSpacing: 0 }}>
              all results &amp; filters →
            </Link>
          </div>
          {trackSearchLoading && <div className="empty-state">searching…</div>}
          {trackSearchError && (
            <div className="empty-state error">
              Search failed: <b>{trackSearchError}</b>
            </div>
          )}
          {!trackSearchLoading && !trackSearchError && trackResults.length === 0 && (
            <div className="empty-state">No tracks match &quot;{q}&quot;.</div>
          )}
          {!trackSearchLoading && trackResults.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {trackResults.map((t) => (
                <Link
                  key={t.id}
                  href={`/song/${t.id}`}
                  className="track-row"
                  style={{ textDecoration: "none" }}
                >
                  <span className="track-title" style={{ flex: "0 1 auto" }}>{t.title}</span>
                  <span className="feature-tag">{t.artists?.name ?? "unknown artist"}</span>
                  <span style={{ flex: 1 }} />
                  {t.spotify_url && (
                    <a
                      className="listen-link"
                      href={t.spotify_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      listen
                    </a>
                  )}
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {!showTrackSection && <OnThisDay />}

      <div className="section-head">
        <div className="section-label">{sectionLabel}</div>
        <div className="section-head-tools">
          <button className="tab" disabled={pickingRandom} onClick={pickRandomArtist}>
            {pickingRandom ? "…" : "random artist"}
          </button>
          {isAdmin && (
            <button className="tab" disabled={creatingArtist} onClick={createArtist}>
              {creatingArtist ? "…" : "+ add artist"}
            </button>
          )}
          <select className="sort-select" value={artistSort} onChange={(e) => updateArtistSort(e.target.value as ArtistSortKey)} aria-label="Sort artists">
            <option value="name-asc">Name (A–Z)</option>
            <option value="name-desc">Name (Z–A)</option>
            <option value="count-desc">Most tracks logged</option>
            <option value="count-asc">Fewest tracks logged</option>
            {user && <option value="pct-desc">My completion % (high–low)</option>}
            {user && <option value="pct-asc">My completion % (low–high)</option>}
            <option value="rating-desc">Community rating (high–low)</option>
            <option value="rating-asc">Community rating (low–high)</option>
          </select>
        </div>
      </div>

      {genreChips.length > 0 && (
        <div className="genre-chips">
          {genreChips.map((g) => (
            <button key={g.slug} className={`rating-chip ${genreFilter === g.slug ? "rated" : ""}`}
              onClick={() => setGenreFilter(genreFilter === g.slug ? null : g.slug)}>
              {g.tag} <span style={{ opacity: 0.6 }}>{g.n}</span>
            </button>
          ))}
          {genreFilter && <button className="rating-clear" onClick={() => setGenreFilter(null)}>clear</button>}
          <Link href="/genres" className="comment-meta" style={{ marginLeft: 4 }}>all genres →</Link>
        </div>
      )}

      {error && (
        <div className="empty-state error">
          Couldn&apos;t load the archive: <b>{error}</b>
        </div>
      )}

      {!error && artists === null && <div className="empty-state">loading archive…</div>}

      {!error && artists !== null && (
        <div className="grid">
          {matchedArtists && matchedArtists.length > 0 ? (
            matchedArtists.map((a) => {
              const pct = a.trackCount > 0 ? Math.round((a.collectedCount / a.trackCount) * 100) : 0;
              const following = followedIds.has(a.id);
              return (
                <Link key={a.id} href={`/artist/${a.id}`}
                  className={`card ${pinnedIds.has(a.id) ? "pinned" : ""} ${photos[a.id] ? "has-photo" : ""}`}
                  style={photos[a.id] ? ({ "--card-img": `url("${photos[a.id]}")` } as CSSProperties) : undefined}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6 }}>
                    <div className="count">{String(a.trackCount).padStart(4, "0")} TRACKS LOGGED</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {user && !isAdmin && following && (
                        <button
                          className={`rating-chip ${pinnedIds.has(a.id) ? "rated" : ""}`}
                          style={{ fontSize: "0.6rem", padding: "3px 7px" }}
                          disabled={pinBusyId === a.id}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePin(a.id); }}
                          title={pinnedIds.has(a.id) ? "Unpin" : "Pin to top"}
                        >
                          {pinnedIds.has(a.id) ? "📌 pinned" : "📌 pin"}
                        </button>
                      )}
                      {user && !isAdmin && (
                        <button
                          className={`rating-chip ${following ? "rated" : ""}`}
                          style={{ fontSize: "0.6rem", padding: "3px 7px" }}
                          disabled={followBusyId === a.id}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFollow(a.id); }}
                        >
                          {following ? "✓ following" : "+ follow"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="name">{a.name}</div>
                  {!isAdmin && (
                    <>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="pct">{user ? `${pct}% collected` : "log in to track your collection"}</div>
                    </>
                  )}
                  {a.avgRating !== null && (
                    <div className="pct" style={{ marginTop: 2 }}>
                      ★ {a.avgRating.toFixed(1)}/10 community ({a.ratingCount} rating{a.ratingCount === 1 ? "" : "s"})
                    </div>
                  )}
                </Link>
              );
            })
          ) : q ? (
            <div className="empty-state">
              <b>{query}</b> isn&apos;t in the archive yet
              {trackResults.length > 0 ? ", but some of their tracks turned up above." : "."} Every
              artist here got added because someone wanted to track them — you could be the one to
              start theirs.{" "}
              {user && !isAdmin && (
                <a href={`/submit?prefill_name=${encodeURIComponent(query)}`} style={{ color: "var(--bone)" }}>
                  Suggest &quot;{query}&quot; as a new artist →
                </a>
              )}
            </div>
          ) : user ? (
            <div className="empty-state">
              You&apos;re not following anyone yet. <Link href="/start" className="text-link">Pick a few artists</Link>, or
              search above and hit <b>+ follow</b>.
            </div>
          ) : (
            <div className="empty-state">Nothing in the archive yet.</div>
          )}
        </div>
      )}

      <div className="note">
        {artists && artists.length > 0 && (
          <>
            <b>{artists.length.toLocaleString()} artists, {artists.reduce((n, a) => n + a.trackCount, 0).toLocaleString()} songs</b>, kept up to date
            by the community.{" "}
          </>
        )}
        {isAdmin
          ? "Admin mode shows everyone in the archive."
          : user ? "Your home feed only shows artists you follow. Search finds anyone in the archive." : "Log in to build a personal feed of artists you follow."}{" "}
        New here? <Link href="/faq" className="text-link">Read the FAQ</Link>.
      </div>
      </div>
      {!q && <RadarColumn />}
      </div>
    </div>
  );
}
