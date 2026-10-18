"use client";

// Who's been building the archive: approved songs, versions, status updates,
// corrections and ChatGPT finds, for this month or all time.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Row = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  total: number;
  songs: number;
  versions: number;
  status: number;
  corrections: number;
  finds: number;
  confirmations: number;
};

const PARTS: [keyof Row, string, string][] = [
  ["songs", "song", "songs"],
  ["versions", "version", "versions"],
  ["status", "status update", "status updates"],
  ["corrections", "correction", "corrections"],
  ["finds", "find", "finds"],
  ["confirmations", "confirmation", "confirmations"],
];

export default function ContributorsPage() {
  const router = useRouter();
  const [period, setPeriod] = useState<"30" | "all">("30");
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    setRows(null);
    supabase
      .rpc("rpc_top_contributors", { p_days: period === "30" ? 30 : null, p_limit: 50 })
      .then(({ data }) => setRows((data as Row[]) ?? []));
  }, [period]);

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← back to archive</button>
      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>Contributors</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        The people building the archive. Counts approved songs and versions (suggested, found by their ChatGPT
        routine or imported), status updates, corrections, finds and confirmations. Only people who show their
        contributions publicly are listed; you can change yours in settings.
      </div>

      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={`tab ${period === "30" ? "active" : ""}`} onClick={() => setPeriod("30")}>last 30 days</button>
        <button className={`tab ${period === "all" ? "active" : ""}`} onClick={() => setPeriod("all")}>all time</button>
      </div>

      {rows === null && <div className="empty-state">loading…</div>}
      {rows && rows.length === 0 && (
        <div className="empty-state">
          No contributions yet{period === "30" ? " this month" : ""}. Suggest a song or set up a ChatGPT routine in
          settings to get on the board.
        </div>
      )}
      {rows?.map((r, i) => (
        <div key={r.user_id} className="review-row" style={{ gridTemplateColumns: "2.2em minmax(0, 1fr) auto" }}>
          <span className="comment-meta" style={{ fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">
              <Link href={`/profile/${r.user_id}`}>{r.display_name || "unnamed"}</Link>
            </div>
            <div className="review-row-meta">
              {PARTS.filter(([k]) => Number(r[k]) > 0).map(([k, one, many]) => (
                <span key={k}>{Number(r[k]).toLocaleString("en-GB")} {Number(r[k]) === 1 ? one : many}</span>
              ))}
            </div>
          </div>
          <span className="health-tile-value" style={{ fontSize: "1.2rem" }}>{Number(r.total).toLocaleString("en-GB")}</span>
        </div>
      ))}
    </div>
  );
}
