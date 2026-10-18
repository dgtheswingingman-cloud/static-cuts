"use client";

// "Real or fake?" voting on unreleased songs (rumoured, teased, snippet,
// leaked). Totals are public; your own vote is only shown to you.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";

export const VOTEABLE_STATUSES = ["rumored", "teased", "snippet", "leaked"];

export type Authenticity = { real_votes: number; fake_votes: number; my_vote: boolean | null; disputed: boolean };

export default function RealOrFake({ trackId }: { trackId: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const [a, setA] = useState<Authenticity | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.rpc("rpc_authenticity", { p_track_ids: [trackId] });
    const row = (data as (Authenticity & { track_id: string })[] | null)?.[0];
    setA(row ?? { real_votes: 0, fake_votes: 0, my_vote: null, disputed: false });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, user?.id]);

  async function vote(real: boolean) {
    if (!user) { router.push("/login"); return; }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("rpc_vote_authenticity", {
      p_track_id: trackId,
      p_real: a?.my_vote === real ? null : real, // pressing your vote again takes it back
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    load();
  }

  if (!a) return null;
  const total = a.real_votes + a.fake_votes;
  const realPct = total ? Math.round((a.real_votes / total) * 100) : 0;

  return (
    <div className="comments-panel real-or-fake">
      <div className="real-or-fake-head">
        <strong>Real or fake?</strong>
        {a.disputed && <span className="feature-tag disputed-tag">disputed</span>}
        <span className="comment-meta">Is this really the artist, or a fake, AI or mislabelled leak?</span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button className={`tab ${a.my_vote === true ? "active" : ""}`} disabled={busy} onClick={() => vote(true)}>
          {a.my_vote === true ? "✓ " : ""}real
        </button>
        <button className={`tab ${a.my_vote === false ? "active" : ""}`} disabled={busy} onClick={() => vote(false)}>
          {a.my_vote === false ? "✓ " : ""}fake
        </button>
      </div>
      {total > 0 ? (
        <>
          <div className="rof-bar" aria-label={`${realPct}% say real`}>
            <div className="rof-bar-real" style={{ width: `${realPct}%` }} />
          </div>
          <div className="comment-meta">
            {realPct}% say real · {total} vote{total === 1 ? "" : "s"}
          </div>
        </>
      ) : (
        <div className="comment-meta" style={{ marginTop: 8 }}>No votes yet. Be the first.</div>
      )}
      {error && <div className="comment-meta error-text">{error}</div>}
    </div>
  );
}
