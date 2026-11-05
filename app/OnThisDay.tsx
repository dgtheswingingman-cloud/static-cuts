"use client";

// "On this day": songs released or leaked on today's date in past years.
// Compact on the homepage; the full list (with other days) is /on-this-day.

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

export default function OnThisDay({ limit = 5 }: { limit?: number }) {
  const [items, setItems] = useState<Anniversary[] | null>(null);
  useEffect(() => {
    supabase.rpc("rpc_on_this_day", { p_limit: limit }).then(({ data }) => setItems((data as Anniversary[]) ?? []));
  }, [limit]);
  if (!items || items.length === 0) return null;
  return (
    <div className="otd" style={{ marginBottom: 10 }}>
      <div className="sp-head hf-head">
        <h2>On this day</h2>
        <Link href="/on-this-day">View all →</Link>
      </div>
      <div className="otd-list">{items.map((a) => <AnniversaryRow key={a.kind + a.track_id} a={a} />)}</div>
    </div>
  );
}
