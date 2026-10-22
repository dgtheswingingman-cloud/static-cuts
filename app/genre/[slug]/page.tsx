"use client";

// One genre: its artists (the ones it fits best first) and genres that often
// go with it.

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type GenreInfo = {
  slug: string; tag: string;
  artists: { id: string; name: string; image_url: string | null; songs: number }[];
  related: { slug: string; tag: string; n: number }[];
};

export default function GenrePage() {
  const params = useParams();
  const slug = params.slug as string;
  const [info, setInfo] = useState<GenreInfo | null | undefined>(undefined);
  useEffect(() => {
    supabase.rpc("rpc_genre", { p_slug: slug }).then(({ data }) => setInfo((data as GenreInfo) ?? null));
  }, [slug]);

  if (info === undefined) return <div className="wrap"><div className="empty-state">loading…</div></div>;
  if (info === null) {
    return (
      <div className="wrap">
        <h1 className="detail-name page-title">Genre not found</h1>
        <Link href="/genres" className="text-link">All genres</Link>
      </div>
    );
  }

  return (
    <div className="wrap">
      <Link href="/genres" className="comment-meta" style={{ textDecoration: "none" }}>← all genres</Link>
      <h1 className="detail-name page-title" style={{ marginTop: 6 }}>{info.tag}</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        {info.artists.length} artist{info.artists.length === 1 ? "" : "s"} in the archive
      </div>
      {info.related.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 22, alignItems: "center" }}>
          <span className="comment-meta" style={{ marginRight: 4 }}>goes with</span>
          {info.related.map((r) => (
            <Link key={r.slug} href={`/genre/${r.slug}`} className="rating-chip" style={{ textDecoration: "none" }}>{r.tag}</Link>
          ))}
        </div>
      )}
      <div className="grid">
        {info.artists.map((a) => (
          <Link key={a.id} href={`/artist/${a.id}`} className={`card ${a.image_url ? "has-photo" : ""}`}
            style={a.image_url ? ({ "--card-img": `url("${a.image_url}")` } as CSSProperties) : undefined}>
            <div className="count">{String(a.songs).padStart(4, "0")} TRACKS LOGGED</div>
            <div className="name">{a.name}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
