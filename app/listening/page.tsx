"use client";
import "../styles/pages.css";

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
    return <div className="wrap pg-page"><h1 className="detail-name page-title pg-title">Your Last.fm</h1>
      <div className="empty-state"><Link href="/login?next=/listening" className="text-link">Log in</Link> to see your listening.</div></div>;
  }

  const here = data?.tracks.filter((t) => t.track_id) ?? [];
  const notCollected = here.filter((t) => !t.owned).map((t) => t.track_id!) ;
  const notFollowed = (data?.artists ?? []).filter((a) => a.artist_id && !a.following).map((a) => a.artist_id!);
  const n = (x: number) => x.toLocaleString("en-GB");
  const topPlays = Math.max(1, ...(data?.tracks ?? []).map((t) => t.plays));

  return (
    <div className="wrap pg-page">
      <h1 className="detail-name page-title pg-title">Your Last.fm</h1>
      {username === null && (
        <section className="pg-box pg-empty">
          <h2>Link Last.fm</h2>
          <p>Add your Last.fm username in Settings to see your most-played songs and artists here, matched to the archive. Only you see this page.</p>
          <Link href="/settings#lastfm" className="st-btn">Open Settings →</Link>
        </section>
      )}
      {username && (
        <>
          <p className="pg-lead">
            From <a href={`https://www.last.fm/user/${encodeURIComponent(username)}`} target="_blank" rel="noopener noreferrer" className="text-link">{username}</a> on Last.fm, matched to the archive. Only you see this page.
          </p>
          <div className="st-seg pg-seg" role="tablist">
            {PERIODS.map(([p, label]) => (
              <button key={p} role="tab" aria-selected={period === p} className={period === p ? "on" : undefined} onClick={() => { setData(null); setPeriod(p); }}>{label}</button>
            ))}
          </div>
          {busy && <div className="empty-state">asking Last.fm…</div>}
          {error && <div className="empty-state error">{error}</div>}
          {data && !busy && (
            <div className="pg-two">
              <section className="pg-box">
                <div className="pg-box-head">
                  <h2>Most played artists</h2>
                  {notFollowed.length > 0 && <button className="st-btn pg-small" onClick={() => follow(notFollowed)}>Follow all {notFollowed.length}</button>}
                </div>
                {data.artists.length === 0 && <div className="comment-meta">Nothing played in this period.</div>}
                {data.artists.map((a, i) => (
                  <div key={a.name} className={`pg-row${a.artist_id ? "" : " off"}`}>
                    <span className="pg-rank">{i + 1}</span>
                    <span className="pg-row-main">
                      {a.artist_id ? <Link href={`/artist/${a.artist_id}`}><b>{a.name}</b></Link> : <b title="Not on Static Cuts yet">{a.name}</b>}
                      <span>{n(a.plays)} plays{!a.artist_id ? " · not on the site yet" : ""}</span>
                    </span>
                    {a.artist_id && (a.following
                      ? <span className="pg-done">✓ following</span>
                      : <button className="pg-act" onClick={() => follow([a.artist_id!])}>+ Follow</button>)}
                  </div>
                ))}
              </section>
              <section className="pg-box">
                <div className="pg-box-head">
                  <h2>Most played songs</h2>
                  {notCollected.length > 0 && <button className="st-btn pg-small" onClick={() => collect(notCollected)}>Collect all {notCollected.length}</button>}
                </div>
                <div className="comment-meta pg-note">{here.length} of {data.tracks.length} are in the archive.</div>
                {data.tracks.map((t, i) => (
                  <div key={i} className={`pg-row${t.track_id ? "" : " off"}`}>
                    <span className="pg-rank">{i + 1}</span>
                    <span className="pg-row-main">
                      {t.track_id ? <Link href={`/song/${t.track_id}`}><b>{t.archive_title ?? t.title}</b></Link> : <b>{t.title}</b>}
                      <span>{t.artist_id ? <Link href={`/artist/${t.artist_id}`}>{t.artist}</Link> : t.artist} · {n(t.plays)} plays</span>
                      <span className="pg-bar" aria-hidden><span style={{ width: `${Math.round((t.plays / topPlays) * 100)}%` }} /></span>
                    </span>
                    {t.track_id && (t.owned
                      ? <span className="pg-done">✓ collected</span>
                      : <button className="pg-act" onClick={() => collect([t.track_id!])}>+ Collect</button>)}
                  </div>
                ))}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
