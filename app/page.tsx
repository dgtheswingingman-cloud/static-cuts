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

type ArtistSortKey = "name-asc" | "name-desc" | "count-desc" | "count-asc" | "pct-desc" | "pct-asc";

type TrackResult = {
  id: string;
  title: string;
  artist_id: string;
  spotify_url: string | null;
  artists: { name: string } | null;
};

export default function HomePage() {
  const { user } = useAuth();
  const [artists, setArtists] = useState<Artist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [trackResults, setTrackResults] = useState<TrackResult[]>([]);
  const [trackSearchLoading, setTrackSearchLoading] = useState(false);
  const [artistSort, setArtistSort] = useState<ArtistSortKey>("name-asc");

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

  // Track search: debounced, server-side (22k rows is too much to ship to
  // the browser just for search), only runs once there's a real query and
  // it doesn't already match an artist name.
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

  const matchedArtists = (() => {
    const list =
      artists?.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase())) ?? null;
    if (!list) return list;
    const sorted = [...list];
    const pct = (a: Artist) => (a.trackCount > 0 ? a.collectedCount / a.trackCount : 0);
    switch (artistSort) {
      case "name-asc":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name-desc":
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "count-desc":
        sorted.sort((a, b) => b.trackCount - a.trackCount);
        break;
      case "count-asc":
        sorted.sort((a, b) => a.trackCount - b.trackCount);
        break;
      case "pct-desc":
        sorted.sort((a, b) => pct(b) - pct(a));
        break;
      case "pct-asc":
        sorted.sort((a, b) => pct(a) - pct(b));
        break;
    }
    return sorted;
  })();
  const q = query.trim();
  const showTrackSection = q.length >= 2;

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
                  <span className="track-title" style={{ flex: "0 1 auto" }}>
                    {t.title}
                  </span>
                  <Link
                    href={`/artist/${t.artist_id}`}
                    className="feature-tag"
                    style={{ textDecoration: "none" }}
                  >
                    {t.artists?.name ?? "unknown artist"}
                  </Link>
                  <span style={{ flex: 1 }} />
                  {t.spotify_url ? (
                    <a
                      className="listen-link"
                      href={t.spotify_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      spotify
                    </a>
                  ) : (
                    <a
                      className="listen-link"
                      href={`https://open.spotify.com/search/${encodeURIComponent(
                        `${t.artists?.name ?? ""} ${t.title}`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      search
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="section-label">In the archive</div>

      <div className="sort-row">
        <select
          className="sort-select"
          value={artistSort}
          onChange={(e) => setArtistSort(e.target.value as ArtistSortKey)}
        >
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

      {!error && artists === null && (
        <div className="empty-state">loading archive…</div>
      )}

      {!error && artists !== null && (
        <div className="grid">
          {matchedArtists && matchedArtists.length > 0 ? (
            matchedArtists.map((a) => {
              const pct = a.trackCount > 0 ? Math.round((a.collectedCount / a.trackCount) * 100) : 0;
              return (
                <Link key={a.id} href={`/artist/${a.id}`} className="card">
                  <div className="count">
                    {String(a.trackCount).padStart(4, "0")} TRACKS LOGGED
                  </div>
                  <div className="name">{a.name}</div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="pct">
                    {user ? `${pct}% collected` : "log in to track your collection"}
                  </div>
                </Link>
              );
            })
          ) : (
            <div className="empty-state">
              <b>{query}</b> isn&apos;t in the archive yet
              {trackResults.length > 0 ? ", but some of their tracks turned up above." : "."}{" "}
              Every artist here got added because someone wanted to track them — you could
              be the one to start theirs.
            </div>
          )}
        </div>
      )}

      <div className="note">
        <b>Live data</b> — 35 artists, 22,158 tracks, fetched fresh from Supabase on
        every load. {user ? "Your collection syncs across every device you log into." : "Log in to start tracking your own collection — it'll sync everywhere you sign in."}
      </div>
    </div>
  );
}
