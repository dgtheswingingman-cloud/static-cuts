"use client";

// Pinned at the top of an artist page: key facts at a glance and a "start
// here" pick (best rated and most collected songs, ones you can play first).

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Pick = { id: string; title: string; status: string | null; spotify_url: string | null; cover_url: string | null; avg: number | null; ratings: number; collected: number };
type Intro = {
  songs: number; released: number; unreleased: number; leaked: number; first_year: number | null; last_year: number | null;
  followers: number; collectors: number; start_here: Pick[];
};

const n = (x: number) => x.toLocaleString("en-GB");

export default function ArtistIntro({ artistId }: { artistId: string }) {
  const [intro, setIntro] = useState<Intro | null>(null);
  useEffect(() => {
    supabase.rpc("rpc_artist_intro", { p_artist: artistId }).then(({ data }) => setIntro((data as Intro) ?? null));
  }, [artistId]);
  if (!intro || intro.songs === 0) return null;

  const years = intro.first_year ? (intro.last_year && intro.last_year !== intro.first_year ? `${intro.first_year}–${intro.last_year}` : `${intro.first_year}`) : null;
  const facts: [string, string][] = [
    ["songs", n(intro.songs)],
    ["released", n(intro.released)],
    ["unreleased", n(intro.unreleased)],
    ...(years ? [["active", years] as [string, string]] : []),
    ["followers", n(intro.followers)],
    ["collectors", n(intro.collectors)],
  ];

  return (
    <section className="artist-intro">
      <div className="artist-facts">
        {facts.map(([label, value]) => (
          <div key={label} className="artist-fact">
            <div className="artist-fact-value">{value}</div>
            <div className="artist-fact-label">{label}</div>
          </div>
        ))}
      </div>
      {intro.start_here.length > 0 && (
        <div className="start-here">
          <div className="section-label" style={{ marginBottom: 8 }}>Start here</div>
          <div className="start-here-list">
            {intro.start_here.map((s, i) => (
              <Link key={s.id} href={`/song/${s.id}`} className="start-here-item">
                <span className="start-here-num">{i + 1}</span>
                {s.cover_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={s.cover_url} alt="" width={44} height={44} loading="lazy" />
                  : <span className="start-here-blank" />}
                <span style={{ minWidth: 0 }}>
                  <span className="start-here-title">{s.title}</span>
                  <span className="start-here-meta">
                    {s.status ?? "unconfirmed"}
                    {s.avg !== null && s.ratings > 0 ? ` · ★ ${s.avg}` : ""}
                    {s.collected > 0 ? ` · ${n(s.collected)} collected` : ""}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
