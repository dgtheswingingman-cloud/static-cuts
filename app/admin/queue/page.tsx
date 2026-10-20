"use client";

// The artist queue: which artists get checked next, and why. Used by the
// ChatGPT routines now and by the Spotify/Genius/Last.fm imports later.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";

type Row = {
  artist_id: string;
  name: string;
  score: number;
  due: boolean;
  next_due_at: string | null;
  track_count: number;
  followers: number;
  requests: number;
  last_checked_at: string | null;
  quiet_streak: number;
  reasons: string[];
};

function when(iso: string | null) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export default function QueuePage() {
  const { user, loading: authLoading } = useAuth();
  const isRealAdmin = useIsAdmin();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isRealAdmin) return;
    supabase.rpc("admin_artist_queue", { p_limit: 500 }).then(({ data, error: err }) => {
      if (err) { setError(err.message); setRows([]); return; }
      setRows((data as Row[]) ?? []);
    });
  }, [isRealAdmin]);

  if (!isRealAdmin) return <NoAccess loading={authLoading} who="admin" />;
  const due = (rows ?? []).filter((r) => r.due);
  const waiting = (rows ?? []).filter((r) => !r.due);

  const table = (list: Row[]) => (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
        <thead>
          <tr className="comment-meta" style={{ textAlign: "left" }}>
            <th style={{ padding: "4px 8px 4px 0" }}>artist</th>
            <th style={{ padding: "4px 8px" }}>priority</th>
            <th style={{ padding: "4px 8px" }}>songs</th>
            <th style={{ padding: "4px 8px" }}>last checked</th>
            <th style={{ padding: "4px 8px" }}>why</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.artist_id} style={{ borderTop: "1px solid var(--hair)" }}>
              <td style={{ padding: "6px 8px 6px 0" }}>
                <Link href={`/artist/${r.artist_id}`} style={{ color: "var(--bone)" }}>{r.name}</Link>
              </td>
              <td style={{ padding: "6px 8px", fontVariantNumeric: "tabular-nums" }}>{Math.round(Number(r.score))}</td>
              <td style={{ padding: "6px 8px", fontVariantNumeric: "tabular-nums" }}>{r.track_count}</td>
              <td style={{ padding: "6px 8px" }} className="comment-meta">{when(r.last_checked_at)}</td>
              <td style={{ padding: "6px 8px" }} className="comment-meta">{r.reasons.join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/control?tab=health")}>← control room</button>
      <h1 className="detail-name page-title">Artist Queue</h1>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        Which artists get checked next. Empty pages, requests and recent finds push an artist up. Each check that
        finds nothing makes the next one wait longer (1 day, 3 days, a week, 2 weeks, then monthly), and a new find
        resets it. ChatGPT routines and the imports both follow this order.
      </div>
      {error && <div className="comment-meta">Couldn&apos;t load the queue: {error}</div>}
      {rows === null && <div className="empty-state">loading…</div>}
      {rows && (
        <>
          <div className="section-label" style={{ marginBottom: 6 }}>Due now ({due.length})</div>
          {due.length ? table(due) : <div className="comment-meta" style={{ marginBottom: 16 }}>Nothing due right now.</div>}
          <div className="section-label" style={{ margin: "20px 0 6px" }}>Waiting ({waiting.length})</div>
          {waiting.length ? table(waiting) : <div className="comment-meta">None.</div>}
        </>
      )}
    </div>
  );
}
