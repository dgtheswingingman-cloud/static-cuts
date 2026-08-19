"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import AuthBar from "./AuthBar";
import { useAuth } from "./AuthProvider";

type Artist = {
  id: string;
  name: string;
  status: string | null;
  trackCount: number;
  collectedCount: number;
};

type TrackResult = {
  id: string;
  title: string;
  artist_id: string;
  spotify_url: string | null;
  artists: { name: string } | null;
};

type ArtistSortKey = "name-asc" | "name-desc" | "count-desc" | "count-asc" | "pct-desc" | "pct-asc";

export default function HomePage() {
  const { user } = useAuth();
  const [artists, setArtists] = useState<Artist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [trackResults, setTrackResults] = useState<TrackResult[]>([]);
  const [trackSearchLoading, setTrackSearchLoading] = useState(false);
  const [artistSort, setArtistSort] = useState<ArtistSortKey>("name-asc");
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [followBusyId, setFollowBusyId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const { data: artistRows, error: artistErr } = await supabase
          .from("artists")
          .select("id, name, status")
          .order("name");
        if (artistErr) throw artistErr;

        const PAGE_SIZE = 1000;
        let allTracks: { id: string; artist_id: string }[] = [];
        let from = 0;
        while (true) {
          const { data: page, error: trackErr } = await supabase
            .from("tracks")
            .select("id, artist_id")
            .range(from, from + PAGE_SIZE - 1);
          if (trackErr) throw trackErr;
          allTracks = allTracks.concat(page ?? []);
          if (!page || page.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }

        const counts: Record<string, number> = {};
        const artistByTrackId: Record<string, string> = {};
        allTracks.forEach((t) => {
          counts[t.artist_id] = (counts[t.artist_id] ?? 0) + 1;
          artistByTrackId[t.id] = t.artist_id;
        });

        const collectedCounts: Record<string, number> = {};
        if (user) {
          let ownedIds: string[] = [];
          let ownedFrom = 0;
          while (true) {
            const { data: page, error: ownedErr } = await supabase
              .from("track_ownership")
              .select("track_id")
              .eq("user_id", user.id)
              .range(ownedFrom, ownedFrom + PAGE_SIZE - 1);
            if (ownedErr) throw ownedErr;
            ownedIds = ownedIds.concat((page ?? []).map((r) => r.track_id));
            if (!page || page.length < PAGE_SIZE) break;
            ownedFrom += PAGE_SIZE;
          }
          ownedIds.forEach((trackId) => {
            const artistId = artistByTrackId[trackId];
            if (artistId) collectedCounts[artistId] = (collectedCounts[artistId] ?? 0) + 1;
          });
        }

        setArtists(
          (artistRows ?? []).map((a) => ({
            ...a,
            trackCount: counts[a.id] ?? 0,
            collectedCount: collectedCounts[a.id] ?? 0,
          }))
        );
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    }
    load();
  }, [user]);

  useEffect(() => {
    async function loadFollowed() {
      if (!user) { setFollowedIds(new Set()); return; }
      const { data } = await supabase.from("follows").select("artist_id").eq("user_id", user.id);
      setFollowedIds(new Set((data ?? []).map((r) => r.artist_id)));
    }
    loadFollowed();
  }, [user]);

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
        .select("id, title, artist_id, spotify_url, artists(name)")
        .ilike("title", `%${q}%`)
        .limit(25);
      setTrackSearchLoading(false);
      if (!searchErr) {
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
    if (q) return artists.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()));
    if (user) return artists.filter((a) => followedIds.has(a.id));
    return artists;
  })();

  const matchedArtists = (() => {
    if (!baseList) return null;
    const sorted = [...baseList];
    const pct = (a: Artist) => (a.trackCount > 0 ? a.collectedCount / a.trackCount : 0);
    switch (artistSort) {
      case "name-asc": sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "name-desc": sorted.sort((a, b) => b.name.localeCompare(a.name)); break;
      case "count-desc": sorted.sort((a, b) => b.trackCount - a.trackCount); break;
      case "count-asc": sorted.sort((a, b) => a.trackCount - b.trackCount); break;
      case "pct-desc": sorted.sort((a, b) => pct(b) - pct(a)); break;
      case "pct-asc": sorted.sort((a, b) => pct(a) - pct(b)); break;
    }
    return sorted;
  })();

  const sectionLabel = q ? "Search results" : user ? "Artists you follow" : "In the archive";

  return (
    <div className="wrap">
      <div className="hero">
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
      </div>

      {showTrackSection && (
        <>
          <div className="section-label">Tracks matching &quot;{q}&quot;</div>
          {trackSearchLoading && <div className="empty-state">searching…</div>}
          {!trackSearchLoading && trackResults.length === 0 && (
            <div className="empty-state">No tracks match &quot;{q}&quot;.</div>
          )}
          {!trackSearchLoading && trackResults.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {trackResults.map((t) => (
                <div key={t.id} className="track-row">
                  <span className="track-title" style={{ flex: "0 1 auto" }}>{t.title}</span>
                  <Link href={`/artist/${t.artist_id}`} className="feature-tag" style={{ textDecoration: "none" }}>
                    {t.artists?.name ?? "unknown artist"}
                  </Link>
                  <span style={{ flex: 1 }} />
                  {t.spotify_url && (
                    <a className="listen-link" href={t.spotify_url} target="_blank" rel="noopener noreferrer">listen</a>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="section-label">{sectionLabel}</div>

      <div className="sort-row">
        <select className="sort-select" value={artistSort} onChange={(e) => setArtistSort(e.target.value as ArtistSortKey)}>
          <option value="name-asc">Name (A–Z)</option>
          <option value="name-desc">Name (Z–A)</option>
          <option value="count-desc">Most tracks logged</option>
          <option value="count-asc">Fewest tracks logged</option>
          {user && <option value="pct-desc">My completion % (high–low)</option>}
          {user && <option value="pct-asc">My completion % (low–high)</option>}
        </select>
      </div>

      {error && (
        <div className="empty-state" style={{ borderColor: "#a33" }}>
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
                <Link key={a.id} href={`/artist/${a.id}`} className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div className="count">{String(a.trackCount).padStart(4, "0")} TRACKS LOGGED</div>
                    {user && (
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
                  <div className="name">{a.name}</div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="pct">{user ? `${pct}% collected` : "log in to track your collection"}</div>
                </Link>
              );
            })
          ) : q ? (
            <div className="empty-state">
              <b>{query}</b> isn&apos;t in the archive yet
              {trackResults.length > 0 ? ", but some of their tracks turned up above." : "."} Every
              artist here got added because someone wanted to track them — you could be the one to
              start theirs.{" "}
              {user && (
                <a href={`/submit?prefill_name=${encodeURIComponent(query)}`} style={{ color: "var(--bone)" }}>
                  Suggest &quot;{query}&quot; as a new artist →
                </a>
              )}
            </div>
          ) : user ? (
            <div className="empty-state">
              You&apos;re not following anyone yet. Search above for an artist and hit{" "}
              <b>+ follow</b> to add them here.
            </div>
          ) : (
            <div className="empty-state">Nothing in the archive yet.</div>
          )}
        </div>
      )}

      <div className="note">
        <b>Live data</b> — 35 artists, 22,158 tracks, fetched fresh from Supabase on every
        load. {user ? "Your home feed only shows artists you follow — search finds anyone in the archive." : "Log in to build a personal feed of artists you follow."}
      </div>
    </div>
  );
}
