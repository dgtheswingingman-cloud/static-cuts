"use client";

// "Is this a version of that song?" Quick yes/no questions anyone signed in
// can answer, with both covers side by side. Two people agreeing settles it
// without a moderator; a split answer goes to the moderators.

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
  const [covers, setCovers] = useState<Record<string, string>>({});

  async function load() {
    const { data } = await supabase.rpc("rpc_version_questions", { p_limit: 20 });
    const list = (data as Q[]) ?? [];
    setQs(list);
    const ids = [...new Set(list.flatMap((q) => [q.track_id, q.parent_track_id]))];
    if (ids.length) supabase.from("tracks").select("id, cover_url").in("id", ids).then(({ data: t }) => {
      const m: Record<string, string> = {};
      for (const r of (t ?? []) as { id: string; cover_url: string | null }[]) if (r.cover_url) m[r.id] = r.cover_url;
      setCovers((p) => ({ ...p, ...m }));
    });
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
    } else setNote(null);
    const rest = (qs ?? []).filter((x) => x.id !== q.id);
    setQs(rest);
    if (rest.length === 0) load();
  }

  if (!qs || qs.length === 0) return null;
  const q = qs[0];
  const Art = ({ id, title, artist }: { id: string; title: string; artist: string }) => (
    <Link href={`/song/${id}`} target="_blank" className="vq-art">
      {covers[id]
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={covers[id]} alt="" />
        : <span className="vq-blank">SC//</span>}
      <span className="vq-cap"><strong>{title}</strong><small>{artist}</small></span>
    </Link>
  );

  return (
    <section className="nw-panel vq" key={q.id}>
      <div className="vq-left">
        <h2 className="vq-q">Is <em>{q.track_title}</em> a version of <em>{q.parent_title}</em>?</h2>
        <div className="vq-pair">
          <Art id={q.track_id} title={q.track_title} artist={q.artist} />
          <span className="vq-eq" aria-hidden="true">=?</span>
          <Art id={q.parent_track_id} title={q.parent_title} artist={q.parent_artist} />
        </div>
        <p className="vq-help">A version is the same song in another form: a demo, live take, remix, earlier mix or alternate cut.{q.version ? ` Its label is "${q.version}".` : ""}</p>
      </div>
      <div className="vq-right">
        <button className="vq-yes" disabled={busy} onClick={() => answer(q, true)}>Yes, same song//</button>
        <button className="vq-no" disabled={busy} onClick={() => answer(q, false)}>No, different song//</button>
        <button className="vq-skip" disabled={busy} onClick={() => answer(q, null)}>Not sure//</button>
        <small className="vq-count">{answered} answered</small>
        {note && <small className="vq-note">{note}</small>}
      </div>
    </section>
  );
}
