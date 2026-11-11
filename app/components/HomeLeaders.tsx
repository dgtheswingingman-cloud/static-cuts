"use client";

// Home: the top 3 contributors this month and of all time, next to On this
// day. Links to the full leaderboard.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import Supporter from "./Supporter";
import { thumb } from "@/lib/thumb";

type Row = { user_id: string; display_name: string | null; avatar_url: string | null; total: number };

export default function HomeLeaders() {
  const [month, setMonth] = useState<Row[] | undefined>(undefined);
  const [ever, setEver] = useState<Row[] | undefined>(undefined);
  useEffect(() => {
    supabase.rpc("rpc_top_contributors", { p_days: 30, p_limit: 3 }).then(({ data }) => setMonth((data as Row[]) ?? []));
    supabase.rpc("rpc_top_contributors", { p_days: null, p_limit: 3 }).then(({ data }) => setEver((data as Row[]) ?? []));
  }, []);

  const who = (r: Row, i: number) => {
    const size = i === 0 ? 56 : 36;
    return (
      <Link key={r.user_id} href={`/profile/${r.user_id}`} className={`hl-who${i ? " hl-who-sm" : ""}`}>
        {r.avatar_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={thumb(r.avatar_url)} alt="" className="ms-avatar" style={{ width: size, height: size }} />
          : <span className="ms-avatar ms-avatar-blank" style={{ width: size, height: size }} />}
        <span className="hl-text">
          <strong>{r.display_name || "unnamed"}<Supporter id={r.user_id} /></strong>
          <span><b>{Number(r.total).toLocaleString("en-GB")}</b> approved contributions</span>
        </span>
        <span className="hl-crown" aria-hidden="true">#{i + 1}</span>
      </Link>
    );
  };
  const card = (label: string, rows: Row[] | undefined) => (
    <div className="hl-card">
      <span className="hl-label">{label}</span>
      {rows === undefined ? <span className="hl-empty">…</span> : rows.length === 0 ? (
        <span className="hl-empty">Nobody yet. <Link href="/submit" className="text-link">Be the first</Link>.</span>
      ) : rows.map(who)}
    </div>
  );

  return (
    <div className="hl">
      <div className="sp-head hf-head">
        <h2>Leaderboard</h2>
        <Link href="/contributors">View all →</Link>
      </div>
      <div className="hl-cards">
        {card("This month", month)}
        {card("All time", ever)}
      </div>
    </div>
  );
}
