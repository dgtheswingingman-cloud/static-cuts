"use client";

// Computers only: the homepage's right column. What's coming out next (with
// a countdown) and what just dropped, from the release radar.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Row = {
  section: "upcoming" | "dropped" | "tba"; track_id: string; title: string; artist_id: string; artist: string;
  release_date: string | null; cover_url: string | null;
};

function when(d: string) {
  const days = Math.round((Date.parse(`${d}T12:00:00`) - Date.now()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1 && days < 14) return `in ${days} days`;
  if (days < 0 && days > -14) return days === -1 ? "yesterday" : `${-days} days ago`;
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: days > 300 || days < -300 ? "numeric" : undefined });
}

function Item({ r }: { r: Row }) {
  return (
    <div className="live-item">
      <Link href={`/song/${r.track_id}`} className="live-thumb" aria-hidden="true" tabIndex={-1}>
        {r.cover_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={r.cover_url} alt="" loading="lazy" />
          : <span>{r.title.slice(0, 1)}</span>}
      </Link>
      <div className="live-body">
        <div className="live-line">
          <Link href={`/song/${r.track_id}`} className="live-artist">{r.title}</Link>
          {r.release_date && <span className="live-when">{when(r.release_date)}</span>}
        </div>
        <div className="live-songs"><Link href={`/artist/${r.artist_id}`}>{r.artist}</Link></div>
      </div>
    </div>
  );
}

export default function RadarColumn() {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1440px)").matches) return;
    supabase.rpc("rpc_release_radar").then(({ data }) => setRows((data as Row[]) ?? []));
  }, []);
  if (!rows) return null;
  const upcoming = rows.filter((r) => r.section === "upcoming" && r.release_date)
    .sort((a, b) => a.release_date!.localeCompare(b.release_date!)).slice(0, 7);
  const dropped = rows.filter((r) => r.section === "dropped" && r.release_date)
    .sort((a, b) => b.release_date!.localeCompare(a.release_date!)).slice(0, 5);
  if (upcoming.length === 0 && dropped.length === 0) return null;
  return (
    <aside className="live radar-col" aria-label="Release radar">
      <div className="live-head">
        <span className="live-title">Coming up</span>
        <Link href="/radar" className="text-link">release radar →</Link>
      </div>
      {upcoming.map((r) => <Item key={r.track_id} r={r} />)}
      {dropped.length > 0 && (
        <>
          <div className="live-head" style={{ marginTop: 14 }}><span className="live-title">Just dropped</span></div>
          {dropped.map((r) => <Item key={r.track_id} r={r} />)}
        </>
      )}
    </aside>
  );
}
