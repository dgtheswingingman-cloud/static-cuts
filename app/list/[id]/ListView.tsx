"use client";

// One list. Everyone can read a public list, follow it and share it; the
// owner can rename it, write a description, reorder songs, add notes,
// remove songs, make it private or delete it.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../../useIsAdmin";
import ExportToSpotify from "../../ExportToSpotify";
import { shrinkImage } from "@/lib/shrinkImage";

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
  const { loading: authLoading } = useAuth();
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [d, setD] = useState<Data | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "" });
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"tracks" | "details">("tracks");
  const [tq, setTq] = useState("");
  const [order, setOrder] = useState<"list" | "title" | "artist">("list");
  const [shown, setShown] = useState(50);
  const [ownerMenu, setOwnerMenu] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  // The owner's uploaded picture for the list (else the first song's cover).
  const [listCover, setListCover] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);

  useEffect(() => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return;
    supabase.from("song_lists").select("cover_url").eq("id", id).maybeSingle()
      .then(({ data }) => setListCover((data as { cover_url: string | null } | null)?.cover_url ?? null));
  }, [id]);

  async function uploadCover(file: File) {
    if (!user || !d) return;
    setCoverBusy(true); setMessage(null);
    try {
      const blob = await shrinkImage(file, 1200);
      const path = `list/${user.id}/${d.list.id}-${Date.now()}.jpg`;
      const { error: up } = await supabase.storage.from("covers").upload(path, blob, { contentType: "image/jpeg" });
      if (up) throw new Error(up.message);
      const url = supabase.storage.from("covers").getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.from("song_lists").update({ cover_url: url }).eq("id", d.list.id);
      if (error) throw new Error(error.message);
      setListCover(url);
      setOwnerMenu(false);
    } catch (e) {
      setMessage(`Couldn't upload that picture: ${(e as Error).message}`);
    }
    setCoverBusy(false);
  }

  async function removeCover() {
    if (!d) return;
    const { error } = await supabase.from("song_lists").update({ cover_url: null }).eq("id", d.list.id);
    if (error) { setMessage(error.message); return; }
    setListCover(null);
  }

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
    if (!user) { if (!isAdmin) router.push("/login"); return; }
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

  const firstLine = (d.list.description ?? "").split("\n")[0].trim();
  const tagline = firstLine.length > 0 && firstLine.length <= 90 ? firstLine : null;
  const rest = tagline ? (d.list.description ?? "").split("\n").slice(1).join("\n").trim() : (d.list.description ?? "").trim();
  const heroCover = listCover ?? d.items.find((i) => i.cover_url)?.cover_url ?? null;
  const needle = tq.trim().toLowerCase();
  const indexed = d.items.map((it, i) => ({ it, i }));
  const filtered = indexed.filter(({ it }) => !needle || it.title.toLowerCase().includes(needle) || it.artist.toLowerCase().includes(needle) || (it.album ?? "").toLowerCase().includes(needle));
  const sorted = order === "list" ? filtered : [...filtered].sort((a, b) => order === "title" ? a.it.title.localeCompare(b.it.title) : a.it.artist.localeCompare(b.it.artist) || a.it.title.localeCompare(b.it.title));
  const canReorder = order === "list" && !needle;
  const artistCounts = Object.values(d.items.reduce<Record<string, { id: string; name: string; n: number }>>((acc, it) => {
    (acc[it.artist_id] ??= { id: it.artist_id, name: it.artist, n: 0 }).n++; return acc;
  }, {})).sort((a, b) => b.n - a.n);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="wrap lv-page">
      <header className="lv-hero">
        <div className="lv-hero-text">
          <span className="ah2-tag lv-tag">List//</span>
          {editing ? (
            <div className="comments-panel" style={{ marginTop: 10 }}>
              <input className="search-input" style={{ width: "100%", marginBottom: 8 }} value={draft.title} maxLength={120}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              <textarea className="comment-textarea" placeholder="First line is the tagline. Then what it's about (optional)" value={draft.description} maxLength={2000}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              <button className="comment-post-btn" disabled={busy || !draft.title.trim()} onClick={saveDetails}>save</button>{" "}
              <button className="rating-clear" onClick={() => setEditing(false)}>cancel</button>
            </div>
          ) : (
            <>
              <h1 className="lv-title">{d.list.title}</h1>
              {tagline && <div className="lv-tagline">{tagline}</div>}
            </>
          )}
          <div className="lv-chips">
            <span>Curated by {d.owner ? <Link href={`/profile/${d.owner.id}`}>{d.owner.name}</Link> : "someone"}</span>
            <span>{d.items.length} track{d.items.length === 1 ? "" : "s"}</span>
            {d.followers > 0 && <span>{d.followers} follower{d.followers === 1 ? "" : "s"}</span>}
            {!d.list.is_public && <span className="lv-private">Private</span>}
          </div>
        </div>
        <div className="lv-photo" aria-hidden="true">
          {heroCover
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={heroCover} alt="" />
            : <span>SC//</span>}
        </div>
      </header>

      <div className="lv-actions">
        {d.items.length > 0 && (
          <ExportToSpotify name={d.list.title} back={`/list/${d.list.id}`} className="lv-btn lv-primary" label="▶ Export to Spotify//"
            description={`From Static Cuts//: a list by ${d.owner?.name ?? "someone"}. static-cuts.com/list/${d.list.id}`}
            urls={d.items.map((i) => i.spotify_url)} />
        )}
        {!isAdmin && !d.is_owner && d.list.is_public && (
          <button className={`lv-btn ${d.following ? "on" : ""}`} onClick={toggleFollow} aria-pressed={d.following}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill={d.following ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg>
            {d.following ? "Saved//" : "Save//"}
          </button>
        )}
        {d.list.is_public && <button className="lv-btn" onClick={share}>Share//</button>}
        {d.is_owner && !isAdmin && (
          <button className={`lv-btn lv-icon ${ownerMenu ? "on" : ""}`} aria-label="More" aria-expanded={ownerMenu} onClick={() => setOwnerMenu(!ownerMenu)}>•••</button>
        )}
      </div>
      {ownerMenu && d.is_owner && !isAdmin && (
        <div className="artist-actions artist-more" style={{ marginTop: 8 }}>
          <button className="tab" onClick={() => { setDraft({ title: d.list.title, description: d.list.description ?? "" }); setEditing(true); setOwnerMenu(false); }}>edit title &amp; description</button>
          <label className={`tab ${coverBusy ? "active" : ""}`} style={{ cursor: "pointer" }}>
            {coverBusy ? "uploading…" : listCover ? "change cover picture" : "upload a cover picture"}
            <input type="file" accept="image/*" hidden disabled={coverBusy} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCover(f); e.target.value = ""; }} />
          </label>
          {listCover && <button className="tab" onClick={removeCover}>remove cover picture</button>}
          <button className="tab" onClick={togglePublic}>{d.list.is_public ? "make private" : "make public"}</button>
          <button className="tab danger-tab" onClick={deleteList}>delete list</button>
        </div>
      )}
      {message && <div className="comment-meta" style={{ marginTop: 8 }}>{message}</div>}
      {rest && !editing && <p className="lv-desc">{rest}</p>}

      <nav className="lv-tabs" aria-label="List sections">
        <button className={tab === "tracks" ? "on" : undefined} aria-pressed={tab === "tracks"} onClick={() => setTab("tracks")}>Tracks//</button>
        <button className={tab === "details" ? "on" : undefined} aria-pressed={tab === "details"} onClick={() => setTab("details")}>Details//</button>
      </nav>

      {tab === "details" && (
        <div className="lv-details">
          <div><span>Curated by</span><strong>{d.owner ? <Link href={`/profile/${d.owner.id}`}>{d.owner.name}</Link> : "someone"}</strong></div>
          <div><span>Tracks</span><strong>{d.items.length}</strong></div>
          <div><span>Followers</span><strong>{d.followers}</strong></div>
          <div><span>Made</span><strong>{fmt(d.list.created_at)}</strong></div>
          <div><span>Last updated</span><strong>{fmt(d.list.updated_at)}</strong></div>
          <div><span>On Spotify</span><strong>{d.items.filter((i) => i.spotify_url).length} of {d.items.length}</strong></div>
          {artistCounts.length > 0 && (
            <div className="lv-details-wide"><span>Artists</span>
              <strong className="lv-artists">{artistCounts.slice(0, 20).map((a) => <Link key={a.id} href={`/artist/${a.id}`}>{a.name} <em>{a.n}</em></Link>)}</strong>
            </div>
          )}
        </div>
      )}

      {tab === "tracks" && (
        <>
          <div className="ls-tools">
            <div className="sr-box ls-search">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input placeholder="Search tracks…" value={tq} onChange={(e) => setTq(e.target.value)} aria-label="Search tracks" />
            </div>
            <select className="sr-select" value={order} onChange={(e) => setOrder(e.target.value as typeof order)} aria-label="Sort">
              <option value="list">Sort: list order</option>
              <option value="title">Sort: title</option>
              <option value="artist">Sort: artist</option>
            </select>
          </div>

          {d.items.length === 0 && (
            <div className="empty-state">{d.is_owner ? "Nothing here yet. Open any song and press “add to list”." : "Nothing here yet."}</div>
          )}
          {d.items.length > 0 && sorted.length === 0 && <div className="empty-state">No tracks match “{tq}”.</div>}

          <ol className="lv-rows">
            {sorted.slice(0, shown).map(({ it, i }) => (
              <li key={it.track_id} className="lv-row">
                <Link href={`/song/${it.track_id}`} className="lv-row-main">
                  {it.cover_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={it.cover_url} alt="" width={64} height={64} loading="lazy" className="lv-cover" />
                    : <span className="lv-cover lv-cover-blank">SC//</span>}
                  <span className="lv-num">{String(i + 1).padStart(2, "0")}</span>
                  <span className="lv-row-text">
                    <span className="lv-row-title">{it.title}</span>
                    <span className="lv-row-artist">{it.artist}{it.album ? ` · ${it.album}` : ""}</span>
                  </span>
                  <span className={`feature-tag st st-${it.status}`}>{it.status}</span>
                </Link>
                {it.spotify_url && <a className="lv-listen" href={it.spotify_url} target="_blank" rel="noopener noreferrer" aria-label="Listen on Spotify">↗</a>}
                {d.is_owner && !isAdmin && (
                  <button className={`lv-more ${rowMenu === it.track_id ? "on" : ""}`} aria-label="Track options" aria-expanded={rowMenu === it.track_id}
                    onClick={() => setRowMenu(rowMenu === it.track_id ? null : it.track_id)}>•••</button>
                )}
                {rowMenu === it.track_id && d.is_owner && (
                  <div className="lv-row-menu">
                    {canReorder && <button className="rating-chip" disabled={i === 0} onClick={() => move(i, -1)}>↑ up</button>}
                    {canReorder && <button className="rating-chip" disabled={i === d.items.length - 1} onClick={() => move(i, 1)}>↓ down</button>}
                    <button className="rating-chip" onClick={() => { setNoteFor(it.track_id); setNoteDraft(it.note ?? ""); setRowMenu(null); }}>note</button>
                    <button className="rating-chip danger" onClick={() => { remove(it); setRowMenu(null); }}>remove</button>
                  </div>
                )}
                {noteFor === it.track_id ? (
                  <div className="lv-note-edit">
                    <textarea className="comment-textarea" value={noteDraft} maxLength={500} placeholder="Why it's here (optional)"
                      onChange={(e) => setNoteDraft(e.target.value)} />
                    <button className="comment-post-btn" onClick={() => saveNote(it)}>save note</button>{" "}
                    <button className="rating-clear" onClick={() => setNoteFor(null)}>cancel</button>
                  </div>
                ) : it.note ? (
                  <div className="lv-note">&ldquo;{it.note}&rdquo;</div>
                ) : null}
              </li>
            ))}
          </ol>
          {sorted.length > shown && (
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button className="tab" onClick={() => setShown(shown + 50)}>Show more ({sorted.length - shown})</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
