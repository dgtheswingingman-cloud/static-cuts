"use client";
import "../styles/launch-progress.css";

// Work tab: how complete each main (launch) artist's page is, so the content
// push shows week by week. Main songs only:
//   Status  songs with a status (not "unconfirmed")
//   Links   released / leaked / snippet songs with a listen link
//   Dates   leaked songs with a leak date
//   Eras    unreleased songs with an era
// Arrows compare with the nightly snapshot from up to 7 days ago
// (admin_launch_progress / launch_progress_days).

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Counts = { songs: number; status: number; link: number; link_of: number; date: number; date_of: number; era: number; era_of: number };
type Row = { artist_id: string; name: string; photo: string | null; now: Counts; then: Counts | null; then_day: string | null };

const PARTS: { key: "status" | "link" | "date" | "era"; of: keyof Counts; label: string; what: string; gap: string }[] = [
  { key: "status", of: "songs", label: "Status", what: "songs with a status", gap: "songs with no status" },
  { key: "link", of: "link_of", label: "Links", what: "out songs with a listen link", gap: "songs with no listen link" },
  { key: "date", of: "date_of", label: "Dates", what: "leaks with a leak date", gap: "leaks with no date" },
  { key: "era", of: "era_of", label: "Eras", what: "unreleased songs with an era", gap: "unreleased songs with no era" },
];
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

export default function LaunchProgress() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc("admin_launch_progress").then(({ data, error }) => {
      if (error) setErr(error.message);
      else setRows((data as Row[] | null) ?? []);
    });
  }, []);

  if (err) return null;
  const since = rows?.find((r) => r.then_day)?.then_day;
  return (
    <section className="cr-box lp-box">
      <div className="section-label">Main artists <span className="comment-meta">· how complete each page is{since ? `, change since ${new Date(since).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</span></div>
      {!rows && <div className="comment-meta">loading…</div>}
      <div className="lp-grid">
        {rows?.map((r) => {
          const scored = PARTS.map((p) => ({ ...p, n: r.now[p.key], of: r.now[p.of] as number, v: pct(r.now[p.key], r.now[p.of] as number) }));
          const weakest = scored.filter((s) => s.v !== null && s.of >= 5).sort((a, b) => (a.v ?? 0) - (b.v ?? 0))[0];
          return (
            <Link key={r.artist_id} href={`/artist/${r.artist_id}`} className="lp-card">
              <span className="lp-head">
                {r.photo ? <img src={r.photo} alt="" className="lp-photo" loading="lazy" /> : <span className="lp-photo" />}
                <span className="lp-name">{r.name}</span>
                <span className="lp-songs">{r.now.songs.toLocaleString("en-GB")} songs</span>
              </span>
              {scored.map((s) => {
                const before = r.then ? pct(r.then[s.key], r.then[s.of] as number) : null;
                const diff = s.v !== null && before !== null ? s.v - before : null;
                return (
                  <span key={s.key} className={`lp-row${weakest?.key === s.key ? " is-weak" : ""}`} title={`${s.n.toLocaleString("en-GB")} of ${s.of.toLocaleString("en-GB")} ${s.what}`}>
                    <span className="lp-label">{s.label}</span>
                    <span className="lp-bar"><span style={{ width: `${s.v ?? 0}%` }} /></span>
                    <span className="lp-pct">{s.v === null ? "—" : `${s.v}%`}</span>
                    <span className={`lp-diff${diff && diff > 0 ? " up" : diff && diff < 0 ? " down" : ""}`}>
                      {diff ? `${diff > 0 ? "+" : ""}${diff}` : ""}
                    </span>
                  </span>
                );
              })}
              <span className="lp-gap">
                {weakest ? <>Weakest: {(weakest.of - weakest.n).toLocaleString("en-GB")} {weakest.gap}</> : "Nothing big missing"}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
