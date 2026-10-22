"use client";

// Every genre in the archive, biggest first. Genres come from Last.fm's tags
// for each artist plus the tags people add and vote on artist pages.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Genre = { slug: string; tag: string; artists: number };

export default function GenresPage() {
  const [genres, setGenres] = useState<Genre[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    supabase.rpc("rpc_genres").then(({ data }) => setGenres((data as Genre[]) ?? []));
  }, []);
  const needle = q.trim().toLowerCase();
  const shown = (genres ?? []).filter((g) => !needle || g.tag.toLowerCase().includes(needle));
  const max = Math.max(1, ...(genres ?? []).map((g) => g.artists));

  return (
    <div className="wrap">
      <h1 className="detail-name page-title">Genres</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        Every genre in the archive. They come from Last.fm and from the tags people add on artist pages.
      </div>
      <input className="search-input" style={{ width: "100%", maxWidth: 420, marginBottom: 18 }} placeholder="Find a genre…"
        value={q} onChange={(e) => setQ(e.target.value)} />
      {genres === null && <div className="empty-state">loading genres…</div>}
      {genres && shown.length === 0 && <div className="empty-state">No genres found.</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {shown.map((g) => (
          <Link key={g.slug} href={`/genre/${g.slug}`} className="rating-chip"
            style={{ textDecoration: "none", fontSize: `${0.72 + 0.5 * Math.sqrt(g.artists / max)}rem`, color: "var(--bone)" }}>
            {g.tag} <span style={{ color: "var(--smoke)" }}>{g.artists}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
