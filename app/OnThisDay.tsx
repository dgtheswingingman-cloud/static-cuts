"use client";

// "On this day": songs released or leaked on today's date in past years.
// Home page (featured): the day's three picks (the same as the day's post),
// with "More" when there are others. Radar: a longer list. The full list
// (with other days) is /on-this-day.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export type Anniversary = {
  kind: "released" | "leaked"; on_date: string; years_ago: number; track_id: string; title: string;
  artist_id: string; artist: string; status: string; spotify_url: string | null; album: string | null;
};

export function AnniversaryRow({ a }: { a: Anniversary }) {
  return (
    <div className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
      <div style={{ minWidth: 0 }}>
        <div className="review-row-title"><Link href={`/song/${a.track_id}`}>{a.title}</Link></div>
        <div className="review-row-meta">
          <Link href={`/artist/${a.artist_id}`}>{a.artist}</Link>
          <span className="feature-tag">{a.kind}</span>
          <span>{a.years_ago} year{a.years_ago === 1 ? "" : "s"} ago ({a.on_date.slice(0, 4)})</span>
          {a.album && <span>{a.album}</span>}
        </div>
      </div>
      {a.spotify_url && <a className="listen-link" href={a.spotify_url} target="_blank" rel="noopener noreferrer">listen</a>}
    </div>
  );
}

type PostSong = { id: string; title: string; artist: string; artist_id: string; status: string; album: string | null;
  leak_date: string | null; release_date: string | null; years_ago: number };

export default function OnThisDay({ limit = 5, featured = false }: { limit?: number; featured?: boolean }) {
  const [items, setItems] = useState<Anniversary[] | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    (async () => {
      if (featured) {
        const { data } = await supabase.rpc("rpc_social_today");
        const otd = (data as { otd: { songs?: PostSong[]; total?: number } | null } | null)?.otd;
        if (otd?.songs?.length) {
          setItems(otd.songs.map((x) => {
            const released = x.status === "released";
            return { kind: released ? "released" : "leaked", on_date: (released ? x.release_date : x.leak_date) ?? "", years_ago: x.years_ago,
              track_id: x.id, title: x.title, artist_id: x.artist_id, artist: x.artist, status: x.status, spotify_url: null, album: x.album } as Anniversary;
          }));
          setMore((otd.total ?? 0) > otd.songs.length);
          return;
        }
      }
      const { data } = await supabase.rpc("rpc_on_this_day", { p_limit: limit + 1 });
      const list = (data as Anniversary[]) ?? [];
      setItems(list.slice(0, limit));
      setMore(list.length > limit);
    })();
  }, [limit, featured]);
  if (!items || items.length === 0) return null;
  return (
    <div className="otd" style={{ marginBottom: 10 }}>
      <div className="sp-head hf-head">
        <h2>On this day</h2>
        {more && <Link href="/on-this-day">More →</Link>}
      </div>
      <div className="otd-list">{items.map((a) => <AnniversaryRow key={a.kind + a.track_id} a={a} />)}</div>
    </div>
  );
}
