"use client";

// Welcome step 4: a short list of songs from the artists just followed
// (rpc_first_ratings), each with a 1-10 score. Rating saves straight away;
// tapping the same score again clears it.

import { useEffect, useState } from "react";
import "../styles/welcome-rate.css";
import { supabase } from "@/lib/supabase";
import { thumb } from "@/lib/thumb";
import { usePersonalUser } from "../useIsAdmin";

type Song = { id: string; title: string; album: string | null; cover: string | null; artist: string };
const GOAL = 5;

export default function FirstRatings({ preview = false }: { preview?: boolean }) {
  const user = usePersonalUser();
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [mine, setMine] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("rpc_first_ratings", { p_limit: 12 }).then(({ data }) => setSongs((data as Song[] | null) ?? []));
  }, [user?.id]);

  async function rate(id: string, value: number) {
    const clear = mine[id] === value;
    setMine((m) => { const n = { ...m }; if (clear) delete n[id]; else n[id] = value; return n; });
    if (preview || !user) return;
    setBusy(id);
    if (clear) await supabase.from("ratings").delete().eq("user_id", user.id).eq("track_id", id);
    else await supabase.from("ratings").upsert({ user_id: user.id, track_id: id, value, updated_at: new Date().toISOString() });
    setBusy(null);
  }

  if (!songs) return <div className="empty-state">loading…</div>;
  if (songs.length === 0) return <div className="comment-meta">Follow a few artists first and their songs will show up here.</div>;
  const done = Object.keys(mine).length;

  return (
    <>
      <div className={`fr-count ${done >= GOAL ? "done" : ""}`}>
        {done >= GOAL ? `${done} rated. Nice, that's a start.` : `${done} of ${GOAL} rated`}
      </div>
      <ul className="fr-list">
        {songs.map((s) => (
          <li key={s.id} className={`fr-row ${mine[s.id] ? "rated" : ""}`}>
            <div className="fr-song">
              {s.cover
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={thumb(s.cover)} alt="" width={44} height={44} className="fr-cover" loading="lazy" />
                : <span className="fr-cover fr-cover-empty">SC//</span>}
              <span className="fr-text">
                <strong>{s.title}</strong>
                <span>{s.artist}{s.album ? ` · ${s.album}` : ""}</span>
              </span>
            </div>
            <div className="fr-scores" role="group" aria-label={`Rate ${s.title} out of 10`}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
                <button key={v} className={mine[s.id] === v ? "on" : undefined} aria-pressed={mine[s.id] === v}
                  disabled={busy === s.id} onClick={() => rate(s.id, v)}>{v}</button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
