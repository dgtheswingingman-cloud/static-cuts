"use client";

// Album of the week: the owner's pick (from a shortlist the site makes, with
// Claude's blurbs). On the home page and /weekly. Links to the album's era
// on the artist's timeline.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export type Aotw = {
  week_start: string; artist_id: string; artist: string; title: string; year: number | null; cover: string | null;
  era_key: string | null; unreleased: number; blurb: string | null;
};

export const eraHref = (a: { artist_id: string; era_key: string | null }) =>
  a.era_key ? `/artist/${a.artist_id}/eras#${encodeURIComponent(a.era_key)}` : `/artist/${a.artist_id}`;

export default function AlbumOfWeek({ week }: { week?: string }) {
  const [a, setA] = useState<Aotw | null | undefined>(undefined);
  useEffect(() => {
    supabase.rpc("rpc_album_of_week", week ? { p_week: week } : {}).then(({ data }) => setA((data as Aotw | null) ?? null));
  }, [week]);
  if (!a) return null;
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
