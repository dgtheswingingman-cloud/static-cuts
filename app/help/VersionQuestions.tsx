"use client";

// "Is this a version of that song?" Quick yes/no questions anyone signed in
// can answer. Two people agreeing settles it without a moderator; a split
// answer goes to the moderators.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Q = {
  id: string; track_id: string; track_title: string; artist_id: string; artist: string; version: string | null;
  parent_track_id: string; parent_title: string; parent_artist: string; yes: number; no: number;
};

export default function VersionQuestions() {
  const [qs, setQs] = useState<Q[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.rpc("rpc_version_questions", { p_limit: 20 });
    setQs((data as Q[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function answer(q: Q, vote: boolean | null) {
    if (vote !== null) {
      setBusy(true);
      const { data, error } = await supabase.rpc("rpc_vote_version", { p_id: q.id, p_vote: vote });
      setBusy(false);
      if (error) { setNote(error.message); return; }
      setAnswered((n) => n + 1);
      setNote(data === "linked" ? "That settles it: it's now filed under the main song."
        : data === "dismissed" ? "That settles it: it stays a separate song."
        : "Thanks. One more answer will settle it.");
    }
    const rest = (qs ?? []).filter((x) => x.id !== q.id);
    setQs(rest);
    if (rest.length === 0) load();
  }

  if (!qs || qs.length === 0) return null;
  const q = qs[0];
  return (
    <div className="comments-panel" style={{ marginBottom: 18 }}>
      <div className="section-label" style={{ marginTop: 0 }}>Quick question{answered ? ` · ${answered} answered` : ""}</div>
      <div style={{ fontSize: "1rem", marginBottom: 6 }}>
        Is <Link href={`/song/${q.track_id}`} className="text-link" target="_blank">{q.track_title}</Link>{" "}
        <span className="comment-meta">({q.artist})</span> a version of{" "}
        <Link href={`/song/${q.parent_track_id}`} className="text-link" target="_blank">{q.parent_title}</Link>
        {q.parent_artist !== q.artist && <span className="comment-meta"> ({q.parent_artist})</span>}?
      </div>
      <div className="comment-meta" style={{ marginBottom: 10 }}>
        A version is the same song in another form: a demo, live take, remix, earlier mix or alternate cut.
        {q.version ? ` Its label is "${q.version}".` : ""}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="tab active" disabled={busy} onClick={() => answer(q, true)}>yes, same song</button>
        <button className="tab" disabled={busy} onClick={() => answer(q, false)}>no, different song</button>
        <button className="tab" disabled={busy} onClick={() => answer(q, null)}>not sure</button>
      </div>
      {note && <div className="comment-meta" style={{ marginTop: 8 }}>{note}</div>}
    </div>
  );
}
