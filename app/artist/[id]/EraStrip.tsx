"use client";

// A sideways strip of an artist's eras (albums and projects), each in the
// colour of its cover. Tapping one opens the eras page at that era.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { buildEras, span, type Song } from "@/lib/eras";
import { accentCss, deepCss, swatch, type Rgb } from "@/lib/swatch";

export default function EraStrip({ artistId }: { artistId: string }) {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [colours, setColours] = useState<Record<string, Rgb>>({});
  useEffect(() => {
    supabase.rpc("rpc_artist_eras", { p_artist: artistId }).then(({ data }) => setSongs((data as { songs: Song[] } | null)?.songs ?? []));
  }, [artistId]);
  // Albums and projects only (years without an album aren't an era to show here).
  const eras = useMemo(() => buildEras(songs ?? []).filter((e) => e.kind === "album" && e.songs.length >= 2), [songs]);
  useEffect(() => {
    let alive = true;
    for (const e of eras.slice(0, 24)) {
      if (e.cover) swatch(e.cover).then((c) => { if (alive && c) setColours((p) => ({ ...p, [e.key]: c })); });
    }
    return () => { alive = false; };
  }, [eras]);
  if (eras.length < 2) return null;

  return (
    <div style={{ marginBottom: 22 }}>
      <div className="section-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span>Eras</span>
        <Link href={`/artist/${artistId}/eras`} className="comment-meta">timeline →</Link>
      </div>
      <div className="era-strip">
        {eras.slice(0, 24).map((e) => {
          const c = colours[e.key];
          return (
            <Link key={e.key} href={`/artist/${artistId}/eras#${encodeURIComponent(e.key)}`} className="era-card"
              style={c ? ({ "--era": accentCss(c), "--era-deep": deepCss(c) } as CSSProperties) : undefined}>
              {e.cover
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={e.cover} alt="" loading="lazy" />
                : <span className="era-card-blank" />}
              <span className="era-card-name">{e.name}</span>
              <span className="era-card-meta">{[span(e), `${e.songs.length} songs`].filter(Boolean).join(" · ")}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
