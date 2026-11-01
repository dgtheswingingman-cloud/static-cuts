"use client";

// The artist queue: which artists get checked next, and why. Used by the
// ChatGPT routines now and by the Spotify/Genius/Last.fm imports later.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";
import { ModPage, ModNotice, ModLoading, ModEmpty, ModSection, ModRow, ModTag } from "../../components/Mod";

type Growth = {
  artists: number; genius_checked: number; lastfm_checked: number; sweep_done: boolean; held: boolean;
  per_day: number; left_today: number; waiting_guests: number; related: number;
  recent: { artist_id: string | null; name: string; source: "guest" | "related"; note: string | null; at: string }[];
};

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
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [growth, setGrowth] = useState<Growth | null>(null);

  useEffect(() => {
    if (!isRealAdmin) return;
    supabase.rpc("admin_artist_queue", { p_limit: 500 }).then(({ data, error: err }) => {
      if (err) { setError(err.message); setRows([]); return; }
      setRows((data as Row[]) ?? []);
    });
    supabase.rpc("rpc_growth_status").then(({ data }) => setGrowth((data as Growth) ?? null));
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
    <ModPage
      title="Artist queue"
      back="/control?tab=health"
      intro="Which artists get checked next. Empty pages, requests and recent finds push an artist up. Each check that finds nothing makes the next one wait longer (1 day, 3 days, a week, 2 weeks, then monthly), and a new find resets it. ChatGPT routines and the imports both follow this order."
    >
      {growth && (
        <>
          <ModSection>How the archive grows</ModSection>
          <div className="comment-meta" style={{ lineHeight: 1.7, marginBottom: 8 }}>
            <div>1. <b>Existing songs</b>: Spotify, Genius credits and Deezer fill in what each artist&apos;s songs are missing (always running).</div>
            <div>
              2. <b>New songs</b>: every artist checked on Genius ({growth.genius_checked.toLocaleString()} of {growth.artists.toLocaleString()})
              and Last.fm ({growth.lastfm_checked.toLocaleString()} of {growth.artists.toLocaleString()}) in the last 14 days. Artists whose
              existing songs are filled in go first; when nobody&apos;s due, whoever was checked longest ago.
            </div>
            <div>
              3. <b>New artists</b>:{" "}
              {growth.held ? "paused (new catalogues are on hold)."
                : !growth.sweep_done ? `starts once step 2 has been through every artist. Up to ${growth.per_day} a day after that.`
                : `${growth.left_today} of ${growth.per_day} left today.`}{" "}
              Next up: {growth.waiting_guests.toLocaleString()} guest{growth.waiting_guests === 1 ? "" : "s"} confirmed on Spotify, then{" "}
              {growth.related.toLocaleString()} similar artist{growth.related === 1 ? "" : "s"} (named by 3+ artists here on Last.fm).
            </div>
          </div>
          {growth.recent.length > 0 && growth.recent.map((a, i) => (
            <ModRow
              key={i}
              title={<>{a.artist_id ? <Link href={`/artist/${a.artist_id}`}>{a.name}</Link> : a.name}<ModTag>{a.source === "guest" ? "guest" : "similar artist"}</ModTag></>}
              meta={<><span>added {when(a.at)}</span>{a.note && <span>{a.note}</span>}</>}
            />
          ))}
        </>
      )}
      {error && <ModNotice kind="error">Couldn&apos;t load the queue: {error}</ModNotice>}
      {rows === null && <ModLoading />}
      {rows && (
        <>
          <ModSection>Due now ({due.length})</ModSection>
          {due.length ? table(due) : <ModEmpty>Nothing due right now.</ModEmpty>}
          <ModSection>Waiting ({waiting.length})</ModSection>
          {waiting.length ? table(waiting) : <ModEmpty>None.</ModEmpty>}
        </>
      )}
    </ModPage>
  );
}
