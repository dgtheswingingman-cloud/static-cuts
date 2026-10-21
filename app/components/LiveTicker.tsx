"use client";

// Computers only: a slow scrolling strip of what's just changed in the
// archive (new songs, status changes). Pauses when the mouse is over it.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Group = { kind: "added" | "status"; artist_id: string; artist: string | null; to_status: string | null; count: number; tracks: { id: string; title: string }[] };

export default function LiveTicker() {
  const [items, setItems] = useState<Group[]>([]);
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    const load = () => supabase.rpc("rpc_whats_new", { p_before: null, p_kind: "all", p_following: false, p_days: 2 }).then(({ data }) => {
      const days = (data as { days?: { groups: Group[] }[] } | null)?.days ?? [];
      setItems(days.flatMap((d) => d.groups).slice(0, 20));
    });
    load();
    const t = setInterval(load, 120000);
    return () => clearInterval(t);
  }, []);
  if (items.length === 0) return null;
  const strip = items.map((g, i) => (
    <span key={i} className="ticker-item">
      <Link href={`/artist/${g.artist_id}`} className="ticker-artist">{g.artist ?? g.artist_id}</Link>{" "}
      {g.kind === "added" ? `${g.count} new song${g.count === 1 ? "" : "s"}` : `${g.count} now ${g.to_status}`}
      {g.tracks[0] && <> · <Link href={`/song/${g.tracks[0].id}`}>{g.tracks[0].title}</Link></>}
    </span>
  ));
  return (
    <div className="ticker">
      <Link href="/new" className="ticker-label"><span className="ticker-dot" /> LIVE</Link>
      <div className="ticker-window">
        <div className="ticker-track" style={{ animationDuration: `${Math.max(40, items.length * 6)}s` }}>
          {strip}{strip}
        </div>
      </div>
    </div>
  );
}
