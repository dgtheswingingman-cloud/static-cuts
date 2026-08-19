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

export default function HomePage() {
  const { user } = useAuth();
  const [artists, setArtists] = useState<Artist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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

  const filtered =
    artists?.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase())) ?? null;

  return (
    <div className="wrap">
      <div className="hero">
        <h1 className="wordmark">
          STATIC CUTS<span className="slash">//</span>
        </h1>
        <div className="tagline">cut through the noise</div>
        <AuthBar />
        <div className="search-shell">
          <input
            className="search-input"
            type="text"
            placeholder="Search any artist — Playboi Carti, Ed Sheeran, anyone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="section-label">In the archive</div>

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
          {filtered && filtered.length > 0 ? (
            filtered.map((a) => {
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
              <b>{query}</b> isn&apos;t in the archive yet. Every artist here got added
              because someone wanted to track them — you could be the one to start
              theirs.
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
