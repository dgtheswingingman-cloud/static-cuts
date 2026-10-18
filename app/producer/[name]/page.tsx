"use client";

// One producer: every song they're credited on, across artists.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Song = {
  track_id: string; title: string; artist_id: string; artist: string; status: string; release_date: string | null;
  album: string | null; spotify_url: string | null; cover_url: string | null; co_producers: string | null;
};

export default function ProducerPage() {
  const params = useParams<{ name: string }>();
  const name = decodeURIComponent(params.name);
  const router = useRouter();
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [artistFilter, setArtistFilter] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("rpc_producer", { p_name: name }).then(({ data }) => setSongs((data as Song[]) ?? []));
  }, [name]);

  const artists = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number }>();
    (songs ?? []).forEach((s) => {
      const a = m.get(s.artist_id) ?? { id: s.artist_id, name: s.artist, n: 0 };
      a.n++;
      m.set(s.artist_id, a);
    });
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [songs]);
  const shown = (songs ?? []).filter((s) => !artistFilter || s.artist_id === artistFilter);

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/producers")}>← producers</button>
      <h1 className="detail-name song-title">{name}</h1>
      <div className="detail-meta">
        {songs ? `Producer on ${songs.length} song${songs.length === 1 ? "" : "s"} for ${artists.length} artist${artists.length === 1 ? "" : "s"}.` : ""}
      </div>
      {artists.length > 1 && (
        <div className="tabs">
          <button className={`tab ${artistFilter ? "" : "active"}`} onClick={() => setArtistFilter(null)}>everyone</button>
          {artists.map((a) => (
            <button key={a.id} className={`tab ${artistFilter === a.id ? "active" : ""}`} onClick={() => setArtistFilter(a.id)}>
              {a.name} ({a.n})
            </button>
          ))}
        </div>
      )}
      {!songs && <div className="empty-state">loading…</div>}
      {songs && songs.length === 0 && <div className="empty-state">No songs credited to {name} yet.</div>}
      {shown.map((s) => (
        <div key={s.track_id} className="review-row" style={{ gridTemplateColumns: "auto minmax(0, 1fr) auto", alignItems: "center" }}>
          {s.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.cover_url} alt="" className="thumb-cover" width={44} height={44} loading="lazy" style={{ width: 44, height: 44 }} />
          ) : <span style={{ width: 44 }} />}
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title"><Link href={`/song/${s.track_id}`}>{s.title}</Link></div>
            <div className="review-row-meta">
              <Link href={`/artist/${s.artist_id}`}>{s.artist}</Link>
              <span className="feature-tag">{s.status}</span>
              {s.release_date && <span>{s.release_date.slice(0, 4)}</span>}
              {s.co_producers && <span>with {s.co_producers}</span>}
            </div>
          </div>
          {s.spotify_url && <a className="listen-link" href={s.spotify_url} target="_blank" rel="noopener noreferrer">listen</a>}
        </div>
      ))}
    </div>
  );
}
