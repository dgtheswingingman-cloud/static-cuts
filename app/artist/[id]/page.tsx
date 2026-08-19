"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import AuthBar from "./AuthBar";

type Artist = {
  id: string;
  name: string;
  status: string | null;
  trackCount: number;
};

export default function HomePage() {
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
        let allArtistIds: string[] = [];
        let from = 0;
        while (true) {
          const { data: page, error: trackErr } = await supabase
            .from("tracks")
            .select("artist_id")
            .range(from, from + PAGE_SIZE - 1);
          if (trackErr) throw trackErr;
          allArtistIds = allArtistIds.concat((page ?? []).map((t) => t.artist_id));
          if (!page || page.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }

        const counts: Record<string, number> = {};
        for (const id of allArtistIds) counts[id] = (counts[id] ?? 0) + 1;

        setArtists(
          (artistRows ?? []).map((a) => ({
            ...a,
            trackCount: counts[a.id] ?? 0,
          }))
        );
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    }
    load();
  }, []);

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
            filtered.map((a) => (
              <Link key={a.id} href={`/artist/${a.id}`} className="card">
                <div className="count">
                  {String(a.trackCount).padStart(4, "0")} TRACKS LOGGED
                </div>
                <div className="name">{a.name}</div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: "0%" }} />
                </div>
                <div className="pct">collection tracking coming soon</div>
              </Link>
            ))
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
        every load. Accounts are live now — log in to get ready for collection
        tracking and submissions, coming next.
      </div>
    </div>
  );
}
