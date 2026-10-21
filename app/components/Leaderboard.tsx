"use client";

// The leaderboard card (homepage right column): contributors ranked by
// points, this month or all time. Points: new song 10, find 8, version 5,
// status update 4, edit or fix 3, confirming a find 2. The team isn't on it.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Row = { rank: number; user_id: string; display_name: string | null; avatar_url: string | null; points: number };

export default function Leaderboard() {
  const [period, setPeriod] = useState<"month" | "all">("month");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [how, setHow] = useState(false);
  useEffect(() => {
    setRows(null);
    supabase.rpc("rpc_leaderboard", { p_days: period === "month" ? 30 : null, p_limit: 8 })
      .then(({ data }) => setRows((data as Row[]) ?? []));
  }, [period]);
  return (
    <div className="lb">
      <div className="live-head">
        <span className="live-title">Leaderboard</span>
        <span className="lb-tabs">
          <button className={period === "month" ? "on" : ""} onClick={() => setPeriod("month")}>month</button>
          <button className={period === "all" ? "on" : ""} onClick={() => setPeriod("all")}>all time</button>
        </span>
      </div>
      {rows === null && <div className="comment-meta">loading…</div>}
      {rows && rows.length === 0 && (
        <div className="comment-meta" style={{ padding: "6px 0 10px" }}>
          Nobody on the board yet. <Link href="/help" className="text-link">Help fill in a song</Link> to be first.
        </div>
      )}
      {rows?.map((r) => (
        <Link key={r.user_id} href={`/profile/${r.user_id}`} className={`lb-row ${r.rank <= 3 ? `top top-${r.rank}` : ""}`}>
          <span className="lb-rank">{r.rank}</span>
          <span className="lb-avatar">
            {r.avatar_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={r.avatar_url} alt="" loading="lazy" />
              : (r.display_name ?? "?").slice(0, 1)}
          </span>
          <span className="lb-name">{r.display_name ?? "anonymous"}</span>
          <span className="lb-points">{r.points.toLocaleString("en-GB")}</span>
        </Link>
      ))}
      <button className="text-link lb-how" onClick={() => setHow(!how)}>{how ? "hide" : "how points work"}</button>
      {how && (
        <div className="comment-meta lb-how-text">
          New song 10 · find (first to spot something new) 8 · version 5 · status update 4 · edit or link fix 3 ·
          confirming someone&apos;s find 2. Counts once it&apos;s approved. Updated hourly.
        </div>
      )}
    </div>
  );
}
