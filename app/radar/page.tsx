"use client";

// Release radar: what's coming (with countdowns), what's announced with no
// date yet, and what's just dropped. "Remind me" tells you when a song
// comes out or its status changes.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";

type Row = {
  section: "upcoming" | "tba" | "dropped"; track_id: string; title: string; artist_id: string; artist: string;
  album: string | null; release_date: string | null; status: string; spotify_url: string | null;
  watchers: number; watching: boolean;
};
type Group = { key: string; artist_id: string; artist: string; album: string | null; date: string | null; rows: Row[] };

function daysUntil(date: string) {
  const today = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }) + "T00:00:00Z");
  return Math.round((new Date(date + "T00:00:00Z").getTime() - today.getTime()) / 86400000);
}
function countdown(date: string) {
  const d = daysUntil(date);
  if (d === 0) return "out today";
  if (d === 1) return "tomorrow";
  if (d > 0) return `in ${d} days`;
  if (d === -1) return "yesterday";
  return `${-d} days ago`;
}
function fmt(date: string) {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// Songs from the same artist, album and date sit together.
function group(rows: Row[]) {
  const out: Group[] = [];
  for (const r of rows) {
    const key = `${r.artist_id}|${r.album ?? r.track_id}|${r.release_date ?? ""}`;
    const g = out.find((x) => x.key === key);
    if (g) g.rows.push(r);
    else out.push({ key, artist_id: r.artist_id, artist: r.artist, album: r.album, date: r.release_date, rows: [r] });
  }
  return out;
}

export default function RadarPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.rpc("rpc_release_radar");
    setRows((data as Row[]) ?? []);
  }
  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, user?.id]);

  async function setWatch(ids: string[], on: boolean, key: string) {
    if (!user) { router.push("/login"); return; }
    setBusy(key);
    if (on) await supabase.from("radar_watches").upsert(ids.map((track_id) => ({ track_id, user_id: user.id })));
    else await supabase.from("radar_watches").delete().eq("user_id", user.id).in("track_id", ids);
    setBusy(null);
    setRows((prev) => (prev ?? []).map((r) => (ids.includes(r.track_id)
      ? { ...r, watching: on, watchers: r.watchers + (on === r.watching ? 0 : on ? 1 : -1) } : r)));
  }

  const sections: [Row["section"], string, string][] = [
    ["upcoming", "Coming up", "Announced releases with a date."],
    ["tba", "Announced, no date yet", ""],
    ["dropped", "Just dropped", "Out in the last two weeks."],
  ];

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← home</button>
      <h1 className="detail-name">Release radar</h1>
      <div className="detail-meta">
        What&apos;s coming and what just dropped. Press &ldquo;remind me&rdquo; and you&apos;ll get a notification when it&apos;s
        out, or if it leaks first.
      </div>

      {!rows && <div className="empty-state">loading…</div>}
      {rows && rows.length === 0 && <div className="empty-state">Nothing on the radar right now.</div>}

      {rows && sections.map(([sec, label, blurb]) => {
        const groups = group(rows.filter((r) => r.section === sec));
        if (groups.length === 0) return null;
        return (
          <div key={sec}>
            <div className="section-label">{label}</div>
            {blurb && <div className="comment-meta" style={{ marginTop: -6, marginBottom: 8 }}>{blurb}</div>}
            {groups.map((g) => {
              const allWatching = g.rows.every((r) => r.watching);
              const isAlbum = g.rows.length > 1;
              return (
                <div key={g.key} className="radar-group">
                  <div className="radar-head">
                    <div style={{ minWidth: 0 }}>
                      <div className="review-row-title">
                        <Link href={`/artist/${g.artist_id}`}>{g.artist}</Link>
                        {isAlbum ? <> · {g.album ?? `${g.rows.length} songs`}</> : <> · <Link href={`/song/${g.rows[0].track_id}`}>{g.rows[0].title}</Link></>}
                      </div>
                      <div className="review-row-meta">
                        {g.date && <span className={sec === "upcoming" ? "radar-countdown" : ""}>{countdown(g.date)}</span>}
                        {g.date && <span>{fmt(g.date)}</span>}
                        {!isAlbum && g.album && <span>{g.album}</span>}
                        {isAlbum && <span>{g.rows.length} songs</span>}
                        {sec === "dropped" && !isAlbum && <span className="feature-tag">{g.rows[0].status}</span>}
                      </div>
                    </div>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {!isAlbum && g.rows[0].spotify_url && (
                        <a className="listen-link" href={g.rows[0].spotify_url} target="_blank" rel="noopener noreferrer">listen</a>
                      )}
                      {sec !== "dropped" && (
                        <button className={`rating-chip ${allWatching ? "rated" : ""}`} disabled={busy === g.key}
                          onClick={() => setWatch(g.rows.map((r) => r.track_id), !allWatching, g.key)}>
                          {allWatching ? "✓ reminding you" : "remind me"}
                        </button>
                      )}
                    </span>
                  </div>
                  {isAlbum && (
                    <div className="feed-tracks" style={{ marginTop: 6 }}>
                      {g.rows.map((r) => (
                        <Link key={r.track_id} href={`/song/${r.track_id}`} className="feed-track">{r.title}</Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
