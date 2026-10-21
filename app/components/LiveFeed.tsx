"use client";

// Computers only: the homepage's "Live" column. What just changed in the
// archive, newest first: artist photo, what happened, the first songs and
// when. Refreshes every 2 minutes.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Group = {
  kind: "added" | "status"; artist_id: string; artist: string | null; to_status: string | null;
  count: number; at: string; tracks: { id: string; title: string }[];
};

function ago(at: string) {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(at)) / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`;
}

export default function LiveFeed({ photos }: { photos: Record<string, string> }) {
  const [items, setItems] = useState<Group[] | null>(null);
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    const load = () => supabase.rpc("rpc_whats_new", { p_before: null, p_kind: "all", p_following: false, p_days: 2 }).then(({ data }) => {
      const days = (data as { days?: { groups: Group[] }[] } | null)?.days ?? [];
      setItems(days.flatMap((d) => d.groups).slice(0, 12));
    });
    load();
    const t = setInterval(load, 120000);
    return () => clearInterval(t);
  }, []);
  if (!items) return null;
  return (
    <aside className="live" aria-label="Live">
      <div className="live-head">
        <span className="live-title"><span className="live-dot" /> Live</span>
        <Link href="/new" className="text-link">everything new →</Link>
      </div>
      {items.length === 0 && <div className="comment-meta">Quiet for now.</div>}
      {items.map((g, i) => {
        const img = photos[g.artist_id];
        return (
          <div key={i} className="live-item">
            <Link href={`/artist/${g.artist_id}`} className="live-thumb" aria-hidden="true" tabIndex={-1}>
              {img
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={img} alt="" loading="lazy" />
                : <span>{(g.artist ?? "?").slice(0, 1)}</span>}
            </Link>
            <div className="live-body">
              <div className="live-line">
                <Link href={`/artist/${g.artist_id}`} className="live-artist">{g.artist ?? g.artist_id}</Link>
                <span className="live-when">{ago(g.at)}</span>
              </div>
              <div className="live-what">
                {g.kind === "added"
                  ? <><b>{g.count}</b> new song{g.count === 1 ? "" : "s"}</>
                  : <><b>{g.count}</b> → <span className="feature-tag">{g.to_status}</span></>}
              </div>
              {g.tracks.length > 0 && (
                <div className="live-songs">
                  {g.tracks.slice(0, 2).map((t, j) => (
                    <span key={t.id}>{j > 0 && " · "}<Link href={`/song/${t.id}`}>{t.title}</Link></span>
                  ))}
                  {g.count > 2 && <span className="comment-meta"> +{g.count - 2}</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </aside>
  );
}
