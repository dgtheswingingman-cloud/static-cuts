"use client";

// Your Last.fm: your most-played songs and artists (from your linked Last.fm
// username), matched to the archive: collect songs or follow artists in a
// tap. Only you see this page.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../useIsAdmin";
import { AdminModePage } from "../components/AdminModeNote";

const FN_URL = "https://pcuyzaamcsegblrauxsa.functions.supabase.co/lastfm-me";
const PERIODS: [string, string][] = [["7day", "this week"], ["1month", "this month"], ["12month", "this year"], ["overall", "all time"]];

type T = { title: string; artist: string; plays: number; track_id: string | null; archive_title: string | null; artist_id: string | null; owned: boolean };
type A = { name: string; plays: number; artist_id: string | null; following: boolean };
type Result = { username: string; period: string; tracks: T[]; artists: A[] };

export default function ListeningPage() {
  const { session, loading } = useAuth();
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const [username, setUsername] = useState<string | null | undefined>(undefined);
  const [period, setPeriod] = useState("1month");
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.rpc("rpc_my_lastfm").then(({ data: u }) => setUsername((u as string | null) ?? null));
  }, [user?.id]);

  useEffect(() => {
    if (!username || !session) return;
    const cacheKey = `static_cuts_lastfm_${username}_${period}`;
    try {
      const c = JSON.parse(sessionStorage.getItem(cacheKey) ?? "null");
      if (c && Date.now() - c.at < 3600_000) { setData(c.data); return; }
    } catch { /* no cache */ }
    setBusy(true);
    setError(null);
    fetch(FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ period }),
    }).then(async (res) => {
      const r = await res.json().catch(() => ({ error: `Failed (${res.status}).` }));
      if (!res.ok || r.error) { setError(r.error ?? "Couldn't reach Last.fm."); return; }
      setData(r as Result);
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data: r })); } catch { /* fine */ }
    }).finally(() => setBusy(false));
  }, [username, period, session?.access_token]);

  async function collect(ids: string[]) {
    const { error: err } = await supabase.rpc("rpc_collect_many", { p_track_ids: ids });
    if (err) { setError(err.message); return; }
    setData((d) => d && { ...d, tracks: d.tracks.map((t) => (t.track_id && ids.includes(t.track_id) ? { ...t, owned: true } : t)) });
  }
  async function follow(ids: string[]) {
    const { error: err } = await supabase.rpc("rpc_follow_many", { p_artist_ids: ids });
    if (err) { setError(err.message); return; }
    setData((d) => d && { ...d, artists: d.artists.map((a) => (a.artist_id && ids.includes(a.artist_id) ? { ...a, following: true } : a)) });
  }

  if (isAdmin) return <AdminModePage title="Your Last.fm" />;
  if (!loading && !user) {
    return <div className="wrap"><h1 className="detail-name page-title">Your Last.fm</h1>
      <div className="empty-state"><Link href="/login?next=/listening" className="text-link">Log in</Link> to see your listening.</div></div>;
  }

  const here = data?.tracks.filter((t) => t.track_id) ?? [];
  const notCollected = here.filter((t) => !t.owned).map((t) => t.track_id!) ;
  const notFollowed = (data?.artists ?? []).filter((a) => a.artist_id && !a.following).map((a) => a.artist_id!);
  const n = (x: number) => x.toLocaleString("en-GB");

  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <h1 className="detail-name page-title">Your Last.fm</h1>
      {username === null && (
        <div className="empty-state">
          Link your Last.fm username in <Link href="/settings#lastfm" className="text-link">Settings</Link> to see your
          most-played songs and artists here, matched to the archive.
        </div>
      )}
      {username && (
        <>
          <div className="detail-meta" style={{ marginBottom: 12 }}>
            From <a href={`https://www.last.fm/user/${encodeURIComponent(username)}`} target="_blank" rel="noopener noreferrer" className="text-link">{username}</a> on Last.fm.
            Only you see this page.
          </div>
          <div className="tabs" style={{ marginBottom: 14 }}>
            {PERIODS.map(([p, label]) => (
              <button key={p} className={`tab ${period === p ? "active" : ""}`} onClick={() => { setData(null); setPeriod(p); }}>{label}</button>
            ))}
          </div>
          {busy && <div className="empty-state">asking Last.fm…</div>}
          {error && <div className="empty-state error">{error}</div>}
          {data && !busy && (
            <>
              <div className="section-label" style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span>Most played artists</span>
                {notFollowed.length > 0 && <button className="rating-chip" onClick={() => follow(notFollowed)}>follow all {notFollowed.length} here</button>}
              </div>
              {data.artists.length === 0 && <div className="comment-meta">Nothing played in this period.</div>}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
                {data.artists.map((a) => (
                  a.artist_id ? (
                    <span key={a.name} className="rating-chip" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <Link href={`/artist/${a.artist_id}`}>{a.name}</Link>
                      <span className="comment-meta">{n(a.plays)}</span>
                      {!a.following && <button className="text-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
                        onClick={() => follow([a.artist_id!])}>+ follow</button>}
                    </span>
                  ) : (
                    <span key={a.name} className="rating-chip" style={{ opacity: 0.6 }} title="Not on Static Cuts yet">{a.name} · {n(a.plays)}</span>
                  )
                ))}
              </div>

              <div className="section-label" style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span>Most played songs ({here.length} of {data.tracks.length} are in the archive)</span>
                {notCollected.length > 0 && <button className="rating-chip" onClick={() => collect(notCollected)}>collect all {notCollected.length}</button>}
              </div>
              {data.tracks.map((t, i) => (
                <div key={i} className="year-row">
                  <span style={{ minWidth: 0 }}>
                    <span className="comment-meta">{i + 1}. </span>
                    {t.track_id ? <Link href={`/song/${t.track_id}`} className="text-link">{t.archive_title ?? t.title}</Link> : <span style={{ opacity: 0.6 }}>{t.title}</span>}
                    <span className="comment-meta"> · {t.artist_id ? <Link href={`/artist/${t.artist_id}`}>{t.artist}</Link> : t.artist}</span>
                  </span>
                  <span className="comment-meta" style={{ whiteSpace: "nowrap" }}>
                    {n(t.plays)} plays
                    {t.track_id && (t.owned ? " · ✓ collected" : <> · <button className="text-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
                      onClick={() => collect([t.track_id!])}>collect</button></>)}
                  </span>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
