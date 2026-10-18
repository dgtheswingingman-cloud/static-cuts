"use client";

// One list. Everyone can read a public list, follow it and share it; the
// owner can rename it, write a description, reorder songs, add notes,
// remove songs, make it private or delete it.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";

type Item = {
  track_id: string; title: string; artist_id: string; artist: string; note: string | null;
  status: string; spotify_url: string | null; album: string | null; cover_url?: string | null;
};
type Data = {
  list: { id: string; title: string; description: string | null; is_public: boolean; created_at: string; updated_at: string };
  owner: { id: string; name: string } | null;
  is_owner: boolean;
  following: boolean;
  followers: number;
  items: Item[];
};

export default function ListView({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [d, setD] = useState<Data | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "" });
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    if (!/^[0-9a-f-]{36}$/i.test(id)) { setMissing(true); return; }
    const { data } = await supabase.rpc("rpc_list_page", { p_id: id });
    if (!data) { setMissing(true); return; }
    setD(data as Data);
  }

  useEffect(() => {
    if (!authLoading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, authLoading, user?.id]);

  async function saveDetails() {
    if (!d) return;
    setBusy(true);
    const { error } = await supabase.from("song_lists")
      .update({ title: draft.title.trim(), description: draft.description.trim() || null, updated_at: new Date().toISOString() })
      .eq("id", d.list.id);
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setEditing(false);
    load();
  }

  async function togglePublic() {
    if (!d) return;
    await supabase.from("song_lists").update({ is_public: !d.list.is_public }).eq("id", d.list.id);
    load();
  }

  async function deleteList() {
    if (!d || !confirm(`Delete “${d.list.title}”? This can't be undone.`)) return;
    await supabase.from("song_lists").delete().eq("id", d.list.id);
    router.push("/lists");
  }

  async function move(index: number, dir: -1 | 1) {
    if (!d) return;
    const items = [...d.items];
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    [items[index], items[j]] = [items[j], items[index]];
    setD({ ...d, items });
    await supabase.rpc("rpc_reorder_list", { p_list: d.list.id, p_track_ids: items.map((i) => i.track_id) });
  }

  async function remove(item: Item) {
    if (!d) return;
    await supabase.from("song_list_items").delete().eq("list_id", d.list.id).eq("track_id", item.track_id);
    setD({ ...d, items: d.items.filter((i) => i.track_id !== item.track_id) });
  }

  async function saveNote(item: Item) {
    if (!d) return;
    const note = noteDraft.trim() || null;
    await supabase.from("song_list_items").update({ note }).eq("list_id", d.list.id).eq("track_id", item.track_id);
    setD({ ...d, items: d.items.map((i) => (i.track_id === item.track_id ? { ...i, note } : i)) });
    setNoteFor(null);
  }

  async function toggleFollow() {
    if (!user) { router.push("/login"); return; }
    if (!d) return;
    const { error } = d.following
      ? await supabase.from("song_list_follows").delete().eq("list_id", d.list.id).eq("user_id", user.id)
      : await supabase.from("song_list_follows").insert({ list_id: d.list.id });
    if (error) { setMessage(error.message); return; }
    setD({ ...d, following: !d.following, followers: d.followers + (d.following ? -1 : 1) });
  }

  function share() {
    const url = `${window.location.origin}/list/${id}`;
    if (navigator.share) { navigator.share({ title: d?.list.title, url }).catch(() => {}); return; }
    navigator.clipboard?.writeText(url).then(() => setMessage("Link copied."));
  }

  if (missing) {
    return (
      <div className="wrap">
        <button className="back-btn" onClick={() => router.push("/lists")}>← lists</button>
        <div className="empty-state" style={{ marginTop: 30 }}>This list doesn&apos;t exist, or it&apos;s private.</div>
      </div>
    );
  }
  if (!d) return <div className="wrap"><div className="empty-state">loading…</div></div>;

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/lists")}>← lists</button>

      {editing ? (
        <div className="comments-panel" style={{ marginTop: 16 }}>
          <input className="search-input" style={{ width: "100%", marginBottom: 8 }} value={draft.title} maxLength={120}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <textarea className="comment-textarea" placeholder="What's this list about? (optional)" value={draft.description} maxLength={2000}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <button className="comment-post-btn" disabled={busy || !draft.title.trim()} onClick={saveDetails}>save</button>{" "}
          <button className="rating-clear" onClick={() => setEditing(false)}>cancel</button>
        </div>
      ) : (
        <>
          <h1 className="detail-name song-title">{d.list.title}</h1>
          <div className="detail-meta song-tags">
            <span>a list by {d.owner ? <Link href={`/profile/${d.owner.id}`} className="text-link">{d.owner.name}</Link> : "someone"}</span>
            <span>{d.items.length} song{d.items.length === 1 ? "" : "s"}</span>
            {d.followers > 0 && <span>{d.followers} follower{d.followers === 1 ? "" : "s"}</span>}
            {!d.list.is_public && <span className="feature-tag">private</span>}
          </div>
          {d.list.description && <div className="comment-body" style={{ whiteSpace: "pre-wrap", marginBottom: 14 }}>{d.list.description}</div>}
        </>
      )}

      <div className="song-actions">
        {!d.is_owner && d.list.is_public && (
          <button className={`tab ${d.following ? "active" : ""}`} onClick={toggleFollow}>{d.following ? "✓ following" : "follow"}</button>
        )}
        {d.list.is_public && <button className="tab" onClick={share}>share</button>}
        {d.is_owner && !editing && (
          <>
            <button className="tab" onClick={() => { setDraft({ title: d.list.title, description: d.list.description ?? "" }); setEditing(true); }}>edit</button>
            <button className="tab" onClick={togglePublic}>{d.list.is_public ? "make private" : "make public"}</button>
            <button className="tab danger-tab" onClick={deleteList}>delete list</button>
          </>
        )}
      </div>
      {message && <div className="comment-meta" style={{ marginTop: 8 }}>{message}</div>}

      <div className="section-label">Songs</div>
      {d.items.length === 0 && (
        <div className="empty-state">
          {d.is_owner ? "Nothing here yet. Open any song and press “add to list”." : "Nothing here yet."}
        </div>
      )}
      <ol className="list-items">
        {d.items.map((it, i) => (
          <li key={it.track_id} className="list-item">
            <span className="list-num">{i + 1}</span>
            {it.cover_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.cover_url} alt="" className="thumb-cover" width={44} height={44} loading="lazy" />
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="review-row-title"><Link href={`/song/${it.track_id}`}>{it.title}</Link></div>
              <div className="review-row-meta">
                <Link href={`/artist/${it.artist_id}`}>{it.artist}</Link>
                <span className="feature-tag">{it.status}</span>
                {it.album && <span>{it.album}</span>}
              </div>
              {noteFor === it.track_id ? (
                <div style={{ marginTop: 6 }}>
                  <textarea className="comment-textarea" value={noteDraft} maxLength={500} placeholder="Why it's here (optional)"
                    onChange={(e) => setNoteDraft(e.target.value)} />
                  <button className="comment-post-btn" onClick={() => saveNote(it)}>save note</button>{" "}
                  <button className="rating-clear" onClick={() => setNoteFor(null)}>cancel</button>
                </div>
              ) : it.note ? (
                <div className="comment-body list-note">{it.note}</div>
              ) : null}
            </div>
            <div className="list-actions">
              {it.spotify_url && <a className="listen-link" href={it.spotify_url} target="_blank" rel="noopener noreferrer">listen</a>}
              {d.is_owner && (
                <>
                  <button className="rating-chip" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button className="rating-chip" aria-label="Move down" disabled={i === d.items.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button className="rating-chip" onClick={() => { setNoteFor(it.track_id); setNoteDraft(it.note ?? ""); }}>note</button>
                  <button className="rating-chip danger" aria-label="Remove from list" onClick={() => remove(it)}>✕</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
