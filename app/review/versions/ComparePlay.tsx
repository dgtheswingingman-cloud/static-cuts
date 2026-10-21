"use client";

// Sub-versions: play the version and its main song side by side before
// approving. Uses each song's listen link, or its first possible link.

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { embedFor } from "../../components/InlinePlayer";

type Side = { id: string; title: string; url: string | null; possible: boolean };

async function linkFor(id: string): Promise<{ url: string | null; possible: boolean }> {
  const { data: t } = await supabase.from("tracks").select("spotify_url").eq("id", id).maybeSingle();
  const url = (t as { spotify_url?: string | null } | null)?.spotify_url ?? null;
  if (url) return { url, possible: false };
  const { data: c } = await supabase.from("track_link_candidates").select("url").eq("track_id", id).limit(5);
  const first = ((c as { url: string }[] | null) ?? []).find((x) => embedFor(x.url));
  return { url: first?.url ?? null, possible: !!first };
}

export default function ComparePlay({ trackId, trackTitle, parentId, parentTitle }: {
  trackId: string; trackTitle: string; parentId: string | null; parentTitle: string | null;
}) {
  const [sides, setSides] = useState<Side[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    if (sides) { setSides(null); return; }
    setBusy(true);
    const want: [string, string][] = [[trackId, trackTitle], ...(parentId ? [[parentId, parentTitle ?? "main song"] as [string, string]] : [])];
    const out = await Promise.all(want.map(async ([id, title]) => ({ id, title, ...(await linkFor(id)) })));
    setSides(out);
    setBusy(false);
  }

  return (
    <>
      <button className="rating-chip" disabled={busy} onClick={open}>{busy ? "…" : sides ? "■ close" : "▶ compare"}</button>
      {sides && (
        <div className="compare-play">
          {sides.map((s, i) => {
            const e = embedFor(s.url);
            return (
              <div key={s.id} style={{ minWidth: 0 }}>
                <div className="comment-meta" style={{ marginBottom: 4 }}>
                  {i === 0 ? "this one" : "main song"}: <Link href={`/song/${s.id}`} className="text-link">{s.title}</Link>
                  {s.possible && <span className="feature-tag" style={{ marginLeft: 6 }}>possible link</span>}
                </div>
                {e ? (
                  <div className="inline-player">
                    <iframe src={e.src} height={e.height} loading="lazy" title={`Play ${s.title}`}
                      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />
                  </div>
                ) : (
                  <div className="comment-meta">{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-link">open link ↗</a> : "No listen link yet."}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
