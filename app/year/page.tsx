"use client";
import "../styles/year.css";

// Your year on Static Cuts: what you collected, your top artists, your
// rarest finds and what you helped with. Shareable as a picture-ready card.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../useIsAdmin";
import { AdminModePage } from "../components/AdminModeNote";
import Wrapped from "./Wrapped";
import { thumb } from "@/lib/thumb";

type Review = {
  year: number; collected: number; unreleased_collected: number; artists: number;
  top_artists: { artist_id: string; artist: string; n: number }[];
  rarest: { track_id: string; title: string; artist: string; holders: number }[];
  by_status: Record<string, number>;
  ratings: number; top_rated: { track_id: string; title: string; artist: string; value: number }[];
  follows: number; approved_suggestions: number; comments: number;
};

function YearInner() {
  const { loading } = useAuth();
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const params = useSearchParams();
  const now = new Date().getFullYear();
  const year = Number(params.get("y")) || now;
  const [r, setR] = useState<Review | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pics, setPics] = useState<Record<string, string | null>>({});
  const [covers, setCovers] = useState<Record<string, { cover: string | null }>>({});

  useEffect(() => {
    if (!user) return;
    setR(null);
    supabase.rpc("rpc_year_review", { p_year: year }).then(({ data }) => setR(data as Review));
  }, [user?.id, year]);

  // Artist photos and song covers for the lists.
  useEffect(() => {
    if (!r) return;
    const aIds = r.top_artists.map((a) => a.artist_id);
    const tIds = [...r.rarest.map((x) => x.track_id), ...r.top_rated.map((x) => x.track_id)];
    if (aIds.length) supabase.from("artists").select("id, image_url").in("id", aIds)
      .then(({ data }) => setPics(Object.fromEntries((data ?? []).map((a) => [a.id, a.image_url]))));
    if (tIds.length) supabase.from("tracks").select("id, cover_url").in("id", tIds)
      .then(({ data }) => setCovers(Object.fromEntries((data ?? []).map((t) => [t.id, { cover: t.cover_url }]))));
  }, [r]);

  if (isAdmin) return <AdminModePage title="Your year" />;
  if (!loading && !user) {
    return (
      <div className="wrap yr-page">
        <h1 className="detail-name page-title yr-title">Your Year</h1>
        <div className="empty-state"><Link href="/login" className="text-link">Log in</Link> to see your year on Static Cuts.</div>
      </div>
    );
  }

  const n = (x: number) => Number(x).toLocaleString("en-GB");
  const tiles: [string, number, string?][] = r ? [
    ["Collected", r.collected, `from ${n(r.artists)} artist${r.artists === 1 ? "" : "s"}`],
    ...(r.unreleased_collected ? [["Never officially out", r.unreleased_collected, "leaks, snippets, unreleased"] as [string, number, string]] : []),
    ["Artists followed", r.follows],
    ["Songs rated", r.ratings],
    ["Suggestions approved", r.approved_suggestions],
    ["Comments", r.comments],
  ] : [];
  const empty = r && r.collected + r.ratings + r.follows === 0;
  return (
    <div className="wrap yr-page">
      <button className="back-btn" onClick={() => router.push(user ? `/profile/${user.id}` : "/")}>← profile</button>
      <div className="yr-head">
        <h1 className="detail-name page-title yr-title">Your {year}</h1>
        <div className="yr-years">
          <button onClick={() => router.push(`/year?y=${year - 1}`)} aria-label={`${year - 1}`}>← {year - 1}</button>
          {year < now && <button onClick={() => router.push(`/year?y=${year + 1}`)} aria-label={`${year + 1}`}>{year + 1} →</button>}
        </div>
      </div>
      <p className="yr-lead">What you collected, found and helped with on Static Cuts// this year.</p>

      {!r && <div className="empty-state">loading…</div>}
      {r && playing && user && <Wrapped review={r} userId={user.id} onClose={() => setPlaying(false)} />}
      {empty && <div className="empty-state">Nothing yet for {year}. Collect, rate or follow something and it&apos;ll show up here.</div>}

      {r && !empty && (
        <>
          <button className="yr-play" onClick={() => setPlaying(true)}>
            <span className="yr-play-pics" aria-hidden>
              {r.top_artists.slice(0, 5).map((a) => pics[a.artist_id]
                // eslint-disable-next-line @next/next/no-img-element
                ? <img key={a.artist_id} src={thumb(pics[a.artist_id]!)} alt="" />
                : <span key={a.artist_id} />)}
            </span>
            <span className="yr-play-text">
              <span className="yr-play-kicker">Your year in pictures</span>
              <span className="yr-play-big">Play your {year}//</span>
              <span className="yr-play-sub">Five slides, each one ready to share</span>
            </span>
            <span className="yr-play-btn" aria-hidden>▶</span>
          </button>

          <div className="yr-tiles">
            {tiles.map(([label, v, sub]) => (
              <div key={label} className="yr-tile">
                <div className="yr-tile-label">{label}</div>
                <div className="yr-tile-n">{n(v)}</div>
                {sub && <div className="yr-tile-sub">{sub}</div>}
              </div>
            ))}
          </div>

          <div className="yr-grid">
            {r.top_artists.length > 0 && (
              <section className="yr-box">
                <h2>Top artists</h2>
                {r.top_artists.map((a, i) => (
                  <Link key={a.artist_id} href={`/artist/${a.artist_id}`} className="yr-row">
                    <span className="yr-rank">{i + 1}</span>
                    {pics[a.artist_id]
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img className="yr-pic round" src={thumb(pics[a.artist_id]!)} alt="" />
                      : <span className="yr-pic round" />}
                    <span className="yr-row-main"><b>{a.artist}</b></span>
                    <span className="yr-num">{n(a.n)} songs</span>
                  </Link>
                ))}
              </section>
            )}
            {r.rarest.length > 0 && (
              <section className="yr-box">
                <h2>Rarest finds</h2>
                {r.rarest.map((s) => (
                  <Link key={s.track_id} href={`/song/${s.track_id}`} className="yr-row">
                    {covers[s.track_id]?.cover
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img className="yr-pic" src={thumb(covers[s.track_id]!.cover!)} alt="" />
                      : <span className="yr-pic" />}
                    <span className="yr-row-main"><b>{s.title}</b><span>{s.artist}</span></span>
                    <span className={`yr-tag ${s.holders === 1 ? "hot" : ""}`}>{s.holders === 1 ? "only you" : `${s.holders} collectors`}</span>
                  </Link>
                ))}
              </section>
            )}
            {r.top_rated.length > 0 && (
              <section className="yr-box">
                <h2>Highest rated</h2>
                {r.top_rated.map((s) => (
                  <Link key={s.track_id} href={`/song/${s.track_id}`} className="yr-row">
                    {covers[s.track_id]?.cover
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img className="yr-pic" src={thumb(covers[s.track_id]!.cover!)} alt="" />
                      : <span className="yr-pic" />}
                    <span className="yr-row-main"><b>{s.title}</b><span>{s.artist}</span></span>
                    <span className="yr-score">{s.value}<small>/10</small></span>
                  </Link>
                ))}
              </section>
            )}
          </div>

        </>
      )}
    </div>
  );
}

export default function YearPage() {
  return (
    <Suspense fallback={<div className="wrap"><div className="empty-state">loading…</div></div>}>
      <YearInner />
    </Suspense>
  );
}
