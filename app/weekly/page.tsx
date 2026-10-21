"use client";

// This week on Static Cuts: what leaked and what came out (by date), what
// the archive newly marked, how much was added, and the most wanted songs.
// Each week has its own link (?week=2026-10-19), made for sharing.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Song = { id: string; title: string; artist_id: string; artist: string; day?: string; kind?: string; spotify_url: string | null };
type Week = {
  week_start: string;
  leaked: Song[]; released: Song[]; marked: Song[];
  added_total: number; added_top: { artist_id: string; artist: string; n: number }[];
  wanted_top: { track_id: string; title: string; artist: string; votes: number }[];
};

function monday(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x.toLocaleDateString("en-CA");
}
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
};
const nice = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

function SongList({ songs, showDay }: { songs: Song[]; showDay?: boolean }) {
  return (
    <>
      {songs.map((s) => (
        <div key={`${s.id}-${s.kind ?? ""}`} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title"><Link href={`/song/${s.id}`}>{s.title}</Link></div>
            <div className="review-row-meta">
              <Link href={`/artist/${s.artist_id}`}>{s.artist}</Link>
              {showDay && s.day && <span>{nice(s.day)}</span>}
              {!showDay && s.kind && <span className="feature-tag">{s.kind}</span>}
            </div>
          </div>
          {s.spotify_url && <a className="listen-link" href={s.spotify_url} target="_blank" rel="noopener noreferrer">listen</a>}
        </div>
      ))}
    </>
  );
}

function WeeklyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const thisWeek = monday(new Date());
  const week = params.get("week") ?? thisWeek;
  const [data, setData] = useState<Week | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setData(null);
    supabase.rpc("rpc_weekly", { p_week_start: week }).then(({ data: d }) => setData(d as Week));
  }, [week]);

  function share() {
    const url = `${window.location.origin}/weekly?week=${week}`;
    if (navigator.share) navigator.share({ title: `This week on Static Cuts (${nice(week)})`, url }).catch(() => {});
    else navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  const go = (w: string) => router.push(w === thisWeek ? "/weekly" : `/weekly?week=${w}`);
  const empty = data && !data.leaked.length && !data.released.length && !data.marked.length && !data.added_total;

  return (
    <div className="wrap">
      <h1 className="detail-name page-title">{week === thisWeek ? "This Week" : `Week of ${nice(week)}`}</h1>
      <div className="detail-meta" style={{ marginBottom: 12 }}>
        {nice(week)} to {nice(shift(week, 6))}: what leaked, what came out, and what changed in the archive.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <button className="tab" onClick={() => go(shift(week, -7))}>← earlier week</button>
        {week < thisWeek && <button className="tab" onClick={() => go(shift(week, 7))}>later week →</button>}
        <button className="tab" onClick={share}>{copied ? "link copied" : "share this week"}</button>
      </div>

      {!data && <div className="empty-state">loading…</div>}
      {empty && <div className="empty-state">A quiet week. Nothing leaked, came out or changed.</div>}

      {data && data.leaked.length > 0 && (<><div className="section-label">Leaked this week ({data.leaked.length})</div><SongList songs={data.leaked} showDay /></>)}
      {data && data.released.length > 0 && (<><div className="section-label">Out this week ({data.released.length})</div><SongList songs={data.released} showDay /></>)}
      {data && data.marked.length > 0 && (<><div className="section-label">Newly marked in the archive</div><SongList songs={data.marked} /></>)}
      {data && data.added_total > 0 && (
        <>
          <div className="section-label">Added to the archive</div>
          <div className="comment-meta" style={{ marginBottom: 6 }}>{Number(data.added_total).toLocaleString("en-GB")} songs added this week, most for:</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {data.added_top.map((a) => (
              <Link key={a.artist_id} href={`/artist/${a.artist_id}`} className="feature-tag" style={{ textDecoration: "none" }}>
                {a.artist} +{a.n}
              </Link>
            ))}
          </div>
        </>
      )}
      {data && data.wanted_top.length > 0 && (
        <>
          <div className="section-label">Most wanted right now</div>
          {data.wanted_top.map((w, i) => (
            <div key={w.track_id} className="comment-meta" style={{ padding: "4px 0" }}>
              {i + 1}. <Link href={`/song/${w.track_id}`} className="text-link">{w.title}</Link> · {w.artist} · {w.votes} vote{w.votes === 1 ? "" : "s"}
            </div>
          ))}
          <Link href="/wanted" className="text-link comment-meta">full list →</Link>
        </>
      )}
    </div>
  );
}

export default function WeeklyPage() {
  return (
    <Suspense fallback={<div className="wrap"><div className="empty-state">loading…</div></div>}>
      <WeeklyInner />
    </Suspense>
  );
}
