"use client";

// The Collabs tab on an artist page: everyone they've made songs with, most
// songs together first. Tap a row to see the songs.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { thumb } from "@/lib/thumb";

type Node = { key: string; artist_id: string | null; name: string };
type Edge = { a: string; b: string; songs: number; tracks: string[] };
type Row = { key: string; artistId: string | null; name: string; songs: number; tracks: string[] };

export default function ArtistCollabs({ artistId }: { artistId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [shown, setShown] = useState(40);

  useEffect(() => {
    let alive = true;
    setRows(null);
    supabase.rpc("rpc_collab_graph", { p_artist: artistId }).then(({ data }) => {
      if (!alive) return;
      const g = (data ?? { nodes: [], edges: [] }) as { nodes: Node[]; edges: Edge[] };
      const byKey = new Map(g.nodes.map((n) => [n.key, n]));
      const list = g.edges.map((e) => {
        const other = e.a === artistId ? e.b : e.a;
        const n = byKey.get(other);
        return { key: other, artistId: n?.artist_id ?? null, name: n?.name ?? other, songs: e.songs, tracks: e.tracks ?? [] };
      }).sort((x, y) => y.songs - x.songs || x.name.localeCompare(y.name));
      setRows(list);
      const ids = list.map((r) => r.artistId).filter(Boolean).slice(0, 200) as string[];
      if (ids.length) {
        supabase.from("artists").select("id, image_url").in("id", ids).then(({ data: a }) => {
          if (!alive) return;
          const m: Record<string, string> = {};
          for (const x of (a ?? []) as { id: string; image_url: string | null }[]) if (x.image_url) m[x.id] = x.image_url;
          setPhotos(m);
        });
      }
    });
    return () => { alive = false; };
  }, [artistId]);

  function toggle(r: Row) {
    if (open === r.key) { setOpen(null); return; }
    setOpen(r.key);
    const missing = r.tracks.filter((t) => !titles[t]).slice(0, 100);
    if (missing.length) {
      supabase.from("tracks").select("id, title").in("id", missing).then(({ data }) => {
        const m: Record<string, string> = {};
        for (const x of (data ?? []) as { id: string; title: string }[]) m[x.id] = x.title;
        setTitles((p) => ({ ...p, ...m }));
      });
    }
  }

  if (!rows) return <div className="empty-state">loading…</div>;
  if (rows.length === 0) return <div className="empty-state">No collabs logged yet.</div>;

  return (
    <>
      <div className="sp-head">
        <h2>Collabs ({rows.length})</h2>
        <Link href={`/collabs?artist=${artistId}`}>Map →</Link>
      </div>
      <div className="sp-versions">
        {rows.slice(0, shown).map((r, i) => (
          <div key={r.key} className="ap-collab">
            <button className="ap-collab-row" aria-expanded={open === r.key} onClick={() => toggle(r)}>
              <span className="ap-collab-rank">{String(i + 1).padStart(2, "0")}</span>
              {r.artistId && photos[r.artistId]
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={thumb(photos[r.artistId])} alt="" width={44} height={44} className="sp-thumb ap-collab-photo" loading="lazy" />
                : <span className="sp-thumb sp-thumb-empty ap-collab-photo">{r.name.slice(0, 2).toUpperCase()}</span>}
              <span className="sp-version-text">
                <span className="sp-version-title">{r.name}</span>
                <span className="sp-sub">{r.songs} song{r.songs === 1 ? "" : "s"} together</span>
              </span>
              <span className="ap-collab-count">{r.songs}</span>
            </button>
            {open === r.key && (
              <div className="ap-collab-songs">
                {r.tracks.slice(0, 100).map((t) => (
                  <Link key={t} href={`/song/${t}`} className="text-link">{titles[t] ?? "…"}</Link>
                ))}
                {r.artistId && <Link href={`/artist/${r.artistId}`} className="ap-collab-go">Go to {r.name} →</Link>}
              </div>
            )}
          </div>
        ))}
      </div>
      {rows.length > shown && (
        <button className="tab" style={{ marginTop: 10 }} onClick={() => setShown(shown + 60)}>show more ({rows.length - shown})</button>
      )}
    </>
  );
}
