"use client";

// Comments on a list. Anyone who can see the list can comment; you can
// remove your own, and the list's owner can remove any on their list.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import Supporter from "../../components/Supporter";
import { thumb } from "@/lib/thumb";

type C = { id: string; body: string; created_at: string; user_id: string; profiles: { display_name: string | null; avatar_url: string | null } | null };

function ago(at: string) {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(at)) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function ListComments({ listId, userId, isOwner, onCount }: { listId: string; userId: string | null; isOwner: boolean; onCount?: (n: number) => void }) {
  const [rows, setRows] = useState<C[] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("song_list_comments")
      .select("id, body, created_at, user_id, profiles(display_name, avatar_url)")
      .eq("list_id", listId).order("created_at", { ascending: false }).limit(200);
    const r = (data as unknown as C[]) ?? [];
    setRows(r);
    onCount?.(r.length);
  }
  useEffect(() => { load(); }, [listId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function post() {
    if (!userId || !body.trim()) return;
    setBusy(true); setError(null);
    const { error: err } = await supabase.from("song_list_comments").insert({ list_id: listId, body: body.trim() });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setBody("");
    load();
  }

  async function remove(c: C) {
    if (!confirm("Remove this comment?")) return;
    const { error: err } = await supabase.from("song_list_comments").delete().eq("id", c.id);
    if (err) { setError(err.message); return; }
    load();
  }

  return (
    <div className="lc">
      {userId ? (
        <div className="lc-new">
          <textarea className="comment-textarea" placeholder="Say something about this list…" value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
          <button className="lv-btn lv-primary" disabled={busy || !body.trim()} onClick={post}>{busy ? "Posting…" : "Post//"}</button>
        </div>
      ) : (
        <div className="comment-meta"><Link href="/login" className="text-link">Log in</Link> to comment.</div>
      )}
      {error && <div className="comment-meta error-text">{error}</div>}
      {rows && rows.length === 0 && <div className="comment-meta" style={{ marginTop: 12 }}>No comments yet. Be the first.</div>}
      <div className="lc-list">
        {(rows ?? []).map((c) => (
          <div key={c.id} className="lc-item">
            <Link href={`/profile/${c.user_id}`} className="lc-av" aria-hidden="true" tabIndex={-1}>
              {c.profiles?.avatar_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={thumb(c.profiles.avatar_url)} alt="" />
                : <span>{(c.profiles?.display_name ?? "?").slice(0, 1).toUpperCase()}</span>}
            </Link>
            <div className="lc-main">
              <div className="lc-head">
                <Link href={`/profile/${c.user_id}`} className="lc-name">{c.profiles?.display_name ?? "anonymous"}</Link>
                <Supporter id={c.user_id} />
                <span className="lc-when">{ago(c.created_at)}</span>
                {(c.user_id === userId || isOwner) && <button className="lc-remove" onClick={() => remove(c)}>remove</button>}
              </div>
              <div className="lc-body">{c.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
