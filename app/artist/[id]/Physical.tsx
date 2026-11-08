"use client";

// Artist page (Projects tab): releases that came out on vinyl, CD or tape,
// from Discogs. Albums link to their album page here when there is one;
// every row links to its versions on Discogs. Nothing shows without data.

import { useEffect, useState } from "react";
import Link from "next/link";
import "../../styles/physical.css";
import { supabase } from "@/lib/supabase";
import { thumb } from "@/lib/thumb";

type Row = {
  id: number; kind: "master" | "release"; title: string; year: number | null; formats: string[];
  versions: number | null; url: string; album_id: string | null; cover: string | null;
};

// 7" / 12" / 10" are record sizes.
const label = (f: string) => (/^\d+"$/.test(f) ? `${f} vinyl` : f);

export default function Physical({ artistId }: { artistId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    setRows(null);
    supabase.rpc("rpc_artist_physical", { p_artist: artistId }).then(({ data }) => setRows((data as Row[] | null) ?? []));
  }, [artistId]);
  if (!rows || rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <section className="ph">
      <div className="sp-head">
        <h2>Physical releases</h2>
        {rows.length > 8 && <button onClick={() => setAll(!all)}>{all ? "Show less" : `All ${rows.length} →`}</button>}
      </div>
      <ul className="ph-list">
        {shown.map((r) => (
          <li key={`${r.kind}-${r.id}`} className="ph-row">
            {r.cover
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={thumb(r.cover)} alt="" width={44} height={44} className="ph-cover" loading="lazy" />
              : <span className="ph-cover ph-cover-empty" aria-hidden="true">◉</span>}
            <span className="ph-text">
              {r.album_id
                ? <Link href={`/album/${r.album_id}`} className="ph-title">{r.title}</Link>
                : <span className="ph-title">{r.title}</span>}
              <span className="ph-formats">
                {r.year && <span className="ph-year">{r.year}</span>}
                {r.formats.map((f) => <span key={f} className="ph-f">{label(f)}</span>)}
              </span>
            </span>
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="ph-link">
              {r.versions ? `${r.versions} version${r.versions === 1 ? "" : "s"}` : "Discogs"} ↗
            </a>
          </li>
        ))}
      </ul>
      <div className="comment-meta ph-src">Pressings from <a href="https://www.discogs.com" target="_blank" rel="noopener noreferrer" className="text-link">Discogs</a>.</div>
    </section>
  );
}
