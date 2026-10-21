"use client";

// Phones (and narrow windows): the homepage's side-swipe rows -- Live (what
// just changed) and Coming up (next releases). Computers show these as
// columns instead (LiveFeed, RadarColumn).

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Group = { kind: "added" | "status"; artist_id: string; artist: string | null; to_status: string | null; count: number; at: string; tracks: { id: string; title: string }[] };
type Radar = { section: string; track_id: string; title: string; artist_id: string; artist: string; release_date: string | null; cover_url: string | null };

function ago(at: string) {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(at)) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}
function when(d: string) {
  const days = Math.round((Date.parse(`${d}T12:00:00`) - Date.now()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1 && days < 14) return `in ${days} days`;
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function MobileStrips({ photos }: { photos: Record<string, string> }) {
  const [live, setLive] = useState<Group[]>([]);
  const [soon, setSoon] = useState<Radar[]>([]);
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    supabase.rpc("rpc_whats_new", { p_before: null, p_kind: "all", p_following: false, p_days: 2 }).then(({ data }) => {
      const days = (data as { days?: { groups: Group[] }[] } | null)?.days ?? [];
      setLive(days.flatMap((d) => d.groups).slice(0, 12));
    });
    supabase.rpc("rpc_release_radar").then(({ data }) => {
      setSoon(((data as Radar[]) ?? []).filter((r) => r.section === "upcoming" && r.release_date)
        .sort((a, b) => a.release_date!.localeCompare(b.release_date!)).slice(0, 10));
    });
  }, []);
  return (
    <div className="mstrips">
      {live.length > 0 && (
        <section>
          <div className="mstrip-head"><span><span className="live-dot" /> Live</span><Link href="/new">see all</Link></div>
          <div className="mstrip">
            {live.map((g, i) => (
              <Link key={i} href={`/artist/${g.artist_id}`} className="mcard">
                <span className="mcard-img">
                  {photos[g.artist_id]
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={photos[g.artist_id]} alt="" loading="lazy" />
                    : <span>{(g.artist ?? "?").slice(0, 1)}</span>}
                </span>
                <span className="mcard-title">{g.artist ?? g.artist_id}</span>
                <span className="mcard-sub">
                  {g.kind === "added" ? `${g.count} new song${g.count === 1 ? "" : "s"}` : `${g.count} now ${g.to_status}`}
                </span>
                <span className="mcard-when">{ago(g.at)} ago</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {soon.length > 0 && (
        <section>
          <div className="mstrip-head"><span>Coming up</span><Link href="/radar">radar</Link></div>
          <div className="mstrip">
            {soon.map((r) => (
              <Link key={r.track_id} href={`/song/${r.track_id}`} className="mcard">
                <span className="mcard-img">
                  {r.cover_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={r.cover_url} alt="" loading="lazy" />
                    : <span>{r.title.slice(0, 1)}</span>}
                </span>
                <span className="mcard-title">{r.title}</span>
                <span className="mcard-sub">{r.artist}</span>
                <span className="mcard-when">{when(r.release_date!)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
