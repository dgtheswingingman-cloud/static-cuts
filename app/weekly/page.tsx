"use client";
import "../styles/pages.css";

// This week on Static-Cuts: what leaked and what came out (by date), what
// the archive newly marked, how much was added.
// Each week has its own link (?week=2026-10-19).

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import RadarTabs from "../components/RadarTabs";
import { supabase } from "@/lib/supabase";
import AlbumOfWeek from "../components/AlbumOfWeek";
import { useIsAdmin } from "../useIsAdmin";
import { thumb } from "@/lib/thumb";

type Song = { id: string; title: string; artist_id: string; artist: string; day?: string; kind?: string; spotify_url: string | null };
type Week = {
  week_start: string;
  leaked: Song[]; released: Song[]; marked: Song[];
  added_total: number; added_top: { artist_id: string; artist: string; n: number }[];
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

// Songs as rows: cover, title, artist and day, coloured by status.
function SongList({ songs, showDay, status, covers }: { songs: Song[]; showDay?: boolean; status?: string; covers: Record<string, string> }) {
  const [all, setAll] = useState(false);
  const shown = all ? songs : songs.slice(0, 12);
  return (
    <>
    <div className="sp-versions pg-songgrid">
      {shown.map((s) => {
        const st = status ?? s.kind ?? "";
        return (
          <Link key={`${s.id}-${s.kind ?? ""}`} href={`/song/${s.id}`} className="sp-version rd-row" data-st={st}>
            {covers[s.id]
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={thumb(covers[s.id])} alt="" width={48} height={48} className="sp-thumb" loading="lazy" />
              : <span className="sp-thumb sp-thumb-empty">SC//</span>}
            <span className="sp-version-text">
              <span className="sp-version-title">{s.title}</span>
              <span className="sp-sub">{s.artist}{showDay && s.day ? `  ·  ${nice(s.day)}` : ""}</span>
            </span>
            {st && <span className={`feature-tag st st-${st}`}>{st}</span>}
          </Link>
        );
      })}
    </div>
    {songs.length > 12 && (
      <button className="pg-more" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${songs.length}`}</button>
    )}
    </>
  );
}

function WeeklyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const thisWeek = monday(new Date());
  const week = params.get("week") ?? thisWeek;
  const [data, setData] = useState<Week | null>(null);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const isAdmin = useIsAdmin();

  useEffect(() => {
    setData(null);
    supabase.rpc("rpc_weekly", { p_week_start: week }).then(({ data: d }) => {
      const w = d as Week;
      setData(w);
      // Covers for the rows.
      const ids = [...new Set([...(w?.leaked ?? []), ...(w?.released ?? []), ...(w?.marked ?? [])].map((s) => s.id))].slice(0, 300);
      if (ids.length) {
        supabase.from("tracks").select("id, cover_url").in("id", ids).then(({ data: rows }) => {
          const m: Record<string, string> = {};
          for (const r of (rows ?? []) as { id: string; cover_url: string | null }[]) if (r.cover_url) m[r.id] = r.cover_url;
          setCovers(m);
        });
      }
    });
  }, [week]);

  const go = (w: string) => router.push(w === thisWeek ? "/weekly" : `/weekly?week=${w}`);
  const empty = data && !data.leaked.length && !data.released.length && !data.marked.length && !data.added_total;

  const counts: [string, number, string][] = data ? [
    ["Leaked", data.leaked.length, "leaked"],
    ["Came out", data.released.length, "released"],
    ["Newly marked", data.marked.length, "teased"],
    ["Songs added", Number(data.added_total), "added"],
  ] : [];
  return (
    <div className="wrap pg-page pg-wide pg-weekly">
      <RadarTabs active="week" />
      <div className="pg-head">
        <h1 className="detail-name page-title pg-title">{week === thisWeek ? "This Week" : `Week of ${nice(week)}`}</h1>
        <div className="pg-arrows">
          <button onClick={() => go(shift(week, -7))}>← Earlier</button>
          {week < thisWeek && <button onClick={() => go(shift(week, 7))}>Later →</button>}
          {week !== thisWeek && <button onClick={() => go(thisWeek)}>This week</button>}
        </div>
      </div>
      <p className="pg-lead">
        {nice(week)} to {nice(shift(week, 6))}: what leaked, what came out, and what changed in the archive.
        {isAdmin && (
          <span className="pg-admin">
            {" "}Slides:{" "}
            {[1, 2, 3].map((n) => (
              <a key={n} className="text-link" style={{ marginRight: 6 }} href={`/weekly/slide?n=${n}&week=${week}`} target="_blank" rel="noopener noreferrer">{n}</a>
            ))}
          </span>
        )}
      </p>

      {data && !empty && (
        <div className="pg-tiles">
          {counts.map(([label, v, st]) => (
            <div key={label} className="pg-tile" data-st={st}>
              <div className="pg-tile-label">{label}</div>
              <div className="pg-tile-n">{v.toLocaleString("en-GB")}</div>
            </div>
          ))}
        </div>
      )}

      <AlbumOfWeek week={week} hero />
      {!data && <div className="empty-state">loading…</div>}
      {empty && <div className="empty-state">A quiet week. Nothing leaked, came out or changed.</div>}

      {data && !empty && (
        <div className="pg-stack">
          {data.leaked.length > 0 && (
            <section className="pg-box"><div className="pg-box-head"><h2>Leaked this week</h2><span className="pg-num">{data.leaked.length}</span></div>
              <SongList songs={data.leaked} showDay status="leaked" covers={covers} /></section>
          )}
          {data.released.length > 0 && (
            <section className="pg-box"><div className="pg-box-head"><h2>Out this week</h2><span className="pg-num">{data.released.length}</span></div>
              <SongList songs={data.released} showDay status="released" covers={covers} /></section>
          )}
          {data.marked.length > 0 && (
            <section className="pg-box"><div className="pg-box-head"><h2>Newly marked</h2><span className="pg-num">{data.marked.length}</span></div>
              <SongList songs={data.marked} covers={covers} /></section>
          )}
          {data.added_total > 0 && (
            <section className="pg-box">
              <div className="pg-box-head"><h2>Added to the archive</h2><span className="pg-num">{Number(data.added_total).toLocaleString("en-GB")} songs</span></div>
              <div className="comment-meta pg-note">Most added for:</div>
              <div className="pg-chips">
                {data.added_top.map((a) => (
                  <Link key={a.artist_id} href={`/artist/${a.artist_id}`} className="pg-chip">{a.artist}<span>+{a.n}</span></Link>
                ))}
              </div>
            </section>
          )}
        </div>
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
