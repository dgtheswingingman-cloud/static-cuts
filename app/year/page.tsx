"use client";

// Your year on Static Cuts: what you collected, your top artists, your
// rarest finds and what you helped with. Shareable as a picture-ready card.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../useIsAdmin";
import { AdminModePage } from "../components/AdminModeNote";
import ShareButton from "../components/ShareButton";
import Wrapped from "./Wrapped";

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

  useEffect(() => {
    if (!user) return;
    setR(null);
    supabase.rpc("rpc_year_review", { p_year: year }).then(({ data }) => setR(data as Review));
  }, [user?.id, year]);

  if (isAdmin) return <AdminModePage title="Your year" />;
  if (!loading && !user) {
    return (
      <div className="wrap">
        <h1 className="detail-name page-title">Your Year</h1>
        <div className="empty-state"><Link href="/login" className="text-link">Log in</Link> to see your year on Static Cuts.</div>
      </div>
    );
  }

  const n = (x: number) => Number(x).toLocaleString("en-GB");
  return (
    <div className="wrap" style={{ maxWidth: 640 }}>
      <button className="back-btn" onClick={() => router.push(user ? `/profile/${user.id}` : "/")}>← profile</button>
      <h1 className="detail-name page-title">Your {year}</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className="tab" onClick={() => router.push(`/year?y=${year - 1}`)}>← {year - 1}</button>
        {year < now && <button className="tab" onClick={() => router.push(`/year?y=${year + 1}`)}>{year + 1} →</button>}
      </div>
      {r && r.collected + r.ratings + r.follows > 0 && (
        <button className="wrapped-play" onClick={() => setPlaying(true)}>
          ▶ Play your {year} Wrapped
        </button>
      )}
      {r && playing && <Wrapped review={r} onClose={() => setPlaying(false)} />}
      {!r && <div className="empty-state">loading…</div>}
      {r && (
        <div className="year-card">
          <div className="year-big">{n(r.collected)}</div>
          <div className="year-label">songs collected, from {n(r.artists)} artist{r.artists === 1 ? "" : "s"}</div>
          {r.unreleased_collected > 0 && <div className="year-label">{n(r.unreleased_collected)} of them not officially out</div>}

          {r.top_artists.length > 0 && (
            <>
              <div className="section-label">Top artists</div>
              {r.top_artists.map((a, i) => (
                <div key={a.artist_id} className="year-row">
                  <span>{i + 1}. <Link href={`/artist/${a.artist_id}`} className="text-link">{a.artist}</Link></span>
                  <span className="comment-meta">{n(a.n)} songs</span>
                </div>
              ))}
            </>
          )}
          {r.rarest.length > 0 && (
            <>
              <div className="section-label">Rarest finds</div>
              {r.rarest.map((s) => (
                <div key={s.track_id} className="year-row">
                  <span><Link href={`/song/${s.track_id}`} className="text-link">{s.title}</Link> <span className="comment-meta">· {s.artist}</span></span>
                  <span className="comment-meta">{s.holders === 1 ? "only you" : `${s.holders} collectors`}</span>
                </div>
              ))}
            </>
          )}
          {r.top_rated.length > 0 && (
            <>
              <div className="section-label">Highest rated</div>
              {r.top_rated.map((s) => (
                <div key={s.track_id} className="year-row">
                  <span><Link href={`/song/${s.track_id}`} className="text-link">{s.title}</Link> <span className="comment-meta">· {s.artist}</span></span>
                  <span className="comment-meta">{s.value}/10</span>
                </div>
              ))}
            </>
          )}
          <div className="section-label">Also</div>
          <div className="year-row"><span>Artists followed</span><span>{n(r.follows)}</span></div>
          <div className="year-row"><span>Songs rated</span><span>{n(r.ratings)}</span></div>
          <div className="year-row"><span>Suggestions approved</span><span>{n(r.approved_suggestions)}</span></div>
          <div className="year-row"><span>Comments</span><span>{n(r.comments)}</span></div>
          <div className="comment-meta" style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            static-cuts.com · screenshot it to share, or
            <ShareButton title={`My ${year} on Static Cuts//`} label="share my profile" path={user ? `/profile/${user.id}` : "/"} />
          </div>
        </div>
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
