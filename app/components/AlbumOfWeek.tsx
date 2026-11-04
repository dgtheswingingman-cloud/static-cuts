"use client";

// Album of the week: the owner's pick (from a shortlist the site makes, with
// Claude's blurbs). On the home page and /weekly. Links to the album's era
// on the artist's timeline.

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export type Aotw = {
  week_start: string; artist_id: string; artist: string; title: string; year: number | null; cover: string | null;
  era_key: string | null; unreleased: number; blurb: string | null;
};

export const eraHref = (a: { artist_id: string; era_key: string | null }) =>
  a.era_key ? `/artist/${a.artist_id}/eras#${encodeURIComponent(a.era_key)}` : `/artist/${a.artist_id}`;

export default function AlbumOfWeek({ week, hero = false }: { week?: string; hero?: boolean }) {
  const [a, setA] = useState<Aotw | null | undefined>(undefined);
  useEffect(() => {
    supabase.rpc("rpc_album_of_week", week ? { p_week: week } : {}).then(({ data }) => setA((data as Aotw | null) ?? null));
  }, [week]);
  if (!a) return null;
  if (hero) {
    // Homepage: a big card, cover on the left, the pick on the right.
    return (
      <section className="aotw-hero" style={a.cover ? ({ "--aotw-img": `url("${a.cover}")` } as CSSProperties) : undefined}>
        <Link href={eraHref(a)} className="aotw-hero-cover" aria-label={`${a.title} by ${a.artist}`}>
          {a.cover
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={a.cover} alt="" />
            : <span className="era-card-blank" />}
        </Link>
        <div className="aotw-hero-body">
          <span className="aotw-hero-tag">Album of the week</span>
          <Link href={eraHref(a)} className="aotw-hero-title">{a.title}</Link>
          <Link href={`/artist/${a.artist_id}`} className="aotw-hero-artist">{a.artist}</Link>
          <div className="aotw-hero-meta">
            {[a.year, a.unreleased > 0 ? `${a.unreleased.toLocaleString("en-GB")} unreleased` : null].filter(Boolean).join("  /  ")}
          </div>
          {a.blurb && <p className="aotw-hero-blurb">{a.blurb}</p>}
          <div className="aotw-hero-actions">
            <Link href={eraHref(a)} className="tab aotw-hero-go">▶ Explore the era</Link>
            <Link href="/weekly" className="tab aotw-hero-more">This week</Link>
          </div>
        </div>
      </section>
    );
  }
  return (
    <div className="aotw">
      <div className="section-label" style={{ marginTop: 0 }}>Album of the week</div>
      <div className="aotw-card">
        <Link href={eraHref(a)} className="aotw-cover">
          {a.cover
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={a.cover} alt="" />
            : <div className="era-card-blank" />}
        </Link>
        <div style={{ minWidth: 0 }}>
          <Link href={eraHref(a)} className="aotw-title">{a.title}</Link>
          <div className="comment-meta">
            <Link href={`/artist/${a.artist_id}`} className="text-link">{a.artist}</Link>
            {a.year ? ` · ${a.year}` : ""}
            {a.unreleased > 0 ? ` · ${a.unreleased.toLocaleString("en-GB")} unreleased from the era` : ""}
          </div>
          {a.blurb && <p className="aotw-blurb">{a.blurb}</p>}
        </div>
      </div>
    </div>
  );
}
