"use client";

// Home: the biggest contributor this month and of all time, next to On this
// day. Links to the full leaderboard.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import Supporter from "./Supporter";

type Row = { user_id: string; display_name: string | null; avatar_url: string | null; total: number };

export default function HomeLeaders() {
  const [month, setMonth] = useState<Row | null | undefined>(undefined);
  const [ever, setEver] = useState<Row | null | undefined>(undefined);
  useEffect(() => {
    supabase.rpc("rpc_top_contributors", { p_days: 30, p_limit: 1 }).then(({ data }) => setMonth(((data as Row[]) ?? [])[0] ?? null));
    supabase.rpc("rpc_top_contributors", { p_days: null, p_limit: 1 }).then(({ data }) => setEver(((data as Row[]) ?? [])[0] ?? null));
  }, []);

  const card = (label: string, r: Row | null | undefined) => (
    <div className="hl-card">
      <span className="hl-label">{label}</span>
      {r === undefined ? <span className="hl-empty">…</span> : r === null ? (
        <span className="hl-empty">Nobody yet. <Link href="/submit" className="text-link">Be the first</Link>.</span>
      ) : (
        <Link href={`/profile/${r.user_id}`} className="hl-who">
          {r.avatar_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={r.avatar_url} alt="" className="ms-avatar" style={{ width: 56, height: 56 }} />
            : <span className="ms-avatar ms-avatar-blank" style={{ width: 56, height: 56 }} />}
          <span className="hl-text">
            <strong>{r.display_name || "unnamed"}<Supporter id={r.user_id} /></strong>
            <span><b>{Number(r.total).toLocaleString("en-GB")}</b> approved contributions</span>
          </span>
          <span className="hl-crown" aria-hidden="true">#1</span>
        </Link>
      )}
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
