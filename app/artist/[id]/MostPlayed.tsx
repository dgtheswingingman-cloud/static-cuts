"use client";

// Artist page: the artist's most played songs, by ListenBrainz play counts.
// Shows nothing when there are no counts yet.

import { useEffect, useState } from "react";
import Link from "next/link";
import "../../styles/artist-extras.css";
import { supabase } from "@/lib/supabase";
import { thumb } from "@/lib/thumb";

type Row = { id: string; title: string; album: string | null; cover: string | null; status: string; listens: number; listeners: number };

const compact = (n: number) => new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export default function MostPlayed({ artistId }: { artistId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    setRows(null);
    supabase.rpc("rpc_artist_most_played", { p_artist: artistId, p_limit: 10 })
      .then(({ data }) => setRows((data as Row[] | null) ?? []));
  }, [artistId]);
  if (!rows || rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, 5);
  return (
    <>
      <div className="sp-head">
        <h2>Most played</h2>
        {rows.length > 5 && <button onClick={() => setAll(!all)}>{all ? "Show less" : "Top 10 →"}</button>}
      </div>
      <ol className="mp-list">
        {shown.map((r, i) => (
          <li key={r.id}>
            <Link href={`/song/${r.id}`} className="sp-version mp-row" data-st={r.status}>
              <span className="mp-rank">{i + 1}</span>
              {r.cover
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={thumb(r.cover)} alt="" width={40} height={40} className="sp-thumb" loading="lazy" />
                : <span className="sp-thumb sp-thumb-empty">SC//</span>}
              <span className="sp-version-text">
                <span className="sp-version-title">{r.title}</span>
                <span className="sp-sub">{r.album ?? "Single"}</span>
              </span>
              <span className="mp-plays" title={`${r.listens.toLocaleString("en-GB")} plays by ${r.listeners.toLocaleString("en-GB")} ListenBrainz listeners`}>
                {compact(r.listens)} <small>plays</small>
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <div className="comment-meta mp-src">Play counts from <a href="https://listenbrainz.org" target="_blank" rel="noopener noreferrer" className="text-link">ListenBrainz</a> listeners.</div>
    </>
  );
}
