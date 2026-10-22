"use client";

// "Fans also like": Last.fm's similar artists that are in the archive, then
// artists sharing the most genres.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Similar = { id: string; name: string; image_url: string | null; why: string | null };

export default function SimilarArtists({ artistId }: { artistId: string }) {
  const [list, setList] = useState<Similar[]>([]);
  useEffect(() => {
    supabase.rpc("rpc_similar_artists", { p_artist: artistId, p_limit: 12 }).then(({ data }) => setList((data as Similar[]) ?? []));
  }, [artistId]);
  if (list.length === 0) return null;
  return (
    <div style={{ marginBottom: 24 }}>
      <div className="section-label" style={{ marginBottom: 10 }}>Fans also like</div>
      <div className="similar-row">
        {list.map((a) => (
          <Link key={a.id} href={`/artist/${a.id}`} className="similar-item" title={a.why ?? undefined}>
            {a.image_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={a.image_url} alt="" loading="lazy" />
              : <span className="similar-blank">{a.name.slice(0, 1)}</span>}
            <span className="similar-name">{a.name}</span>
            {a.why && <span className="similar-why">{a.why}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
