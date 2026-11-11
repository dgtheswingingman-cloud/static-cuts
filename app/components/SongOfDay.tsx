"use client";

// Song of the day: the day's pick (chosen in the control room from a
// shortlist, or the site's own pick). On the home page next to album of the week.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { thumb } from "@/lib/thumb";

type Song = { id: string; title: string; artist: string; artist_id: string; status: string; album: string | null;
  leak_date: string | null; release_date: string | null; cover: string | null; photo: string | null; versions: number };

const when = (iso: string | null) => (!iso ? null : iso.slice(5) === "01-01" ? iso.slice(0, 4)
  : new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }));

export default function SongOfDay() {
  const [s, setS] = useState<Song | null | undefined>(undefined);
  useEffect(() => {
    supabase.rpc("rpc_social_today").then(({ data }) => setS(((data as { song: Song | null } | null)?.song) ?? null));
  }, []);
  if (!s) return null;
  const date = s.status === "released" ? s.release_date : s.leak_date;
  const cover = s.cover ?? s.photo;
  return (
    <section className="sotd">
      <Link href={`/song/${s.id}`} className="sotd-cover" aria-label={`${s.title} by ${s.artist}`}>
        {cover
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={thumb(cover, 400)} alt="" />
          : <span className="era-card-blank" />}
      </Link>
      <div className="sotd-body">
        <span className="aotw-hero-tag sotd-tag">Song of the day</span>
        <Link href={`/song/${s.id}`} className="sotd-title">{s.title}</Link>
        <Link href={`/artist/${s.artist_id}`} className="sotd-artist">{s.artist}</Link>
        <div className="sotd-meta">
          <span className={`feature-tag st st-${s.status}`}>{s.status}</span>
          {date && <span>{when(date)}</span>}
        </div>
        <div className="sotd-sub">
          {s.status === "released" ? (s.album ?? "") : "never officially released"}
          {s.versions > 0 ? `${s.status === "released" && !s.album ? "" : " · "}${s.versions} other version${s.versions === 1 ? "" : "s"}` : ""}
        </div>
        <Link href={`/song/${s.id}`} className="tab aotw-hero-go sotd-go">▶ Open the song</Link>
      </div>
    </section>
  );
}
