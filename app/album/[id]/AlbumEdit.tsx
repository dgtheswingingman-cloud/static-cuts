"use client";

// Album page: suggest a fix (or, for moderators and trusted contributors,
// make it straight away). Five kinds: wrong details, not this artist's album,
// same album as another (combine), an edition that doesn't belong (separate),
// and a tracklist song linked to the wrong song on the site. Everything
// applied can be undone from /review/albums.

import { useEffect, useState } from "react";
import Link from "next/link";
import "../../styles/album-edit.css";
import { supabase } from "@/lib/supabase";

type Kind = "details" | "not_artist" | "same_as" | "not_same" | "tracklist";
type Row = { disk: number | null; position: number | null; title: string; track_id: string | null; site_title: string | null;
  src_album?: string | null; src_position?: number | null; src_disk?: number | null };
export type EditableAlbum = {
  id: string; title: string; kind: string; date: string | null;
  artist: { id: string; name: string };
  tracks: Row[];
  editions: { id: string; title: string; label: string }[];
  more: { id: string; title: string; date: string | null }[];
};

export default function AlbumEdit({ a, signedIn, moderator, onDone }: {
  a: EditableAlbum; signedIn: boolean; moderator: boolean; onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("details");
  const [title, setTitle] = useState(a.title);
  const [date, setDate] = useState(a.date ?? "");
  const [type, setType] = useState(a.kind === "ep" ? "ep" : "album");
  const [other, setOther] = useState("");
  const [edition, setEdition] = useState("");
  const [row, setRow] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; title: string; release_status: string | null }[]>([]);
  const [song, setSong] = useState<string | null>(null);
  const [none, setNone] = useState(false);
  const [note, setNote] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const editions = a.editions.filter((e) => e.label !== "Original");
  const rows = a.tracks.filter((t) => t.src_album && t.src_position != null);

  // Songs by this artist matching what's typed (tracklist fixes).
  useEffect(() => {
    if (kind !== "tracklist" || q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => {
      supabase.from("tracks").select("id, title, release_status").eq("artist_id", a.artist.id)
        .ilike("title", `%${q.trim().replace(/[%_]/g, "")}%`).order("title").limit(12)
        .then(({ data }) => setHits((data as typeof hits) ?? []));
    }, 250);
    return () => clearTimeout(t);
  }, [q, kind, a.artist.id]);

  function reset() {
    setTitle(a.title); setDate(a.date ?? ""); setType(a.kind === "ep" ? "ep" : "album");
    setOther(""); setEdition(""); setRow(""); setQ(""); setSong(null); setNone(false); setNote(""); setSource("");
  }

  async function send() {
    setMsg(null);
    let albumId = a.id;
    let payload: Record<string, unknown> = {};
    if (kind === "details") {
      if (title.trim() !== a.title) payload.title = title.trim();
      if (date && date !== a.date) payload.release_date = date;
      if (type !== (a.kind === "ep" ? "ep" : "album")) payload.kind = type;
      if (!Object.keys(payload).length) { setMsg({ kind: "err", text: "Nothing changed yet." }); return; }
    } else if (kind === "same_as") {
      if (!other) { setMsg({ kind: "err", text: "Pick the other album." }); return; }
      payload = { other_album_id: other };
    } else if (kind === "not_same") {
      if (!edition) { setMsg({ kind: "err", text: "Pick the edition that doesn't belong." }); return; }
      albumId = edition;
    } else if (kind === "tracklist") {
      const r = rows.find((x) => `${x.src_album}:${x.src_disk ?? 1}:${x.src_position}` === row);
      if (!r) { setMsg({ kind: "err", text: "Pick the tracklist row." }); return; }
      if (!none && !song) { setMsg({ kind: "err", text: "Pick the right song, or tick “not on the site”." }); return; }
      albumId = r.src_album!;
      payload = { disk: r.src_disk ?? 1, position: r.src_position, track_id: none ? null : song };
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("rpc_suggest_album_edit", {
      p: { album_id: albumId, artist_id: a.artist.id, kind, payload, note: note.trim() || null, source_url: source.trim() || null },
    });
    setBusy(false);
    if (error) { setMsg({ kind: "err", text: error.message }); return; }
    const d = data as { sent: boolean; applied?: boolean; note?: string };
    if (!d.sent) { setMsg({ kind: "err", text: d.note ?? "Not sent." }); return; }
    setMsg({ kind: "ok", text: d.applied ? "Done. (Undo from Control room → Albums.)" : "Thanks! Sent for review." });
    reset();
    if (d.applied) onDone();
  }

  if (!signedIn) {
    return <Link href={`/login?next=/album/${a.id}`} className="st-btn">Suggest an edit</Link>;
  }
  return (
    <>
      <button className="st-btn" aria-expanded={open} onClick={() => { setOpen(!open); setMsg(null); }}>
        {moderator ? "Edit album" : "Suggest an edit"}
      </button>
      {open && (
        <div className="ae-panel">
          <label className="ae-field">
            <span>What&apos;s wrong?</span>
            <select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setMsg(null); }}>
              <option value="details">Title, date or album/EP is wrong</option>
              <option value="same_as">It&apos;s the same album as another one</option>
              {editions.length > 0 && <option value="not_same">An edition here is a different album</option>}
              <option value="tracklist">A song in the tracklist links to the wrong song</option>
              <option value="not_artist">It isn&apos;t {a.artist.name}&apos;s album</option>
            </select>
          </label>

          {kind === "details" && (
            <div className="ae-grid">
              <label className="ae-field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <label className="ae-field"><span>Release date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="ae-field"><span>Type</span>
                <select value={type} onChange={(e) => setType(e.target.value)}><option value="album">Album</option><option value="ep">EP</option></select>
              </label>
            </div>
          )}

          {kind === "same_as" && (
            <label className="ae-field">
              <span>Same album as (an edition or a duplicate)</span>
              <select value={other} onChange={(e) => setOther(e.target.value)}>
                <option value="">Pick…</option>
                {a.more.map((m) => <option key={m.id} value={m.id}>{m.title}{m.date ? ` (${m.date.slice(0, 4)})` : ""}</option>)}
              </select>
            </label>
          )}

          {kind === "not_same" && (
            <label className="ae-field">
              <span>Show this one as its own album</span>
              <select value={edition} onChange={(e) => setEdition(e.target.value)}>
                <option value="">Pick…</option>
                {editions.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </label>
          )}

          {kind === "tracklist" && (
            <>
              <label className="ae-field">
                <span>Tracklist row</span>
                <select value={row} onChange={(e) => setRow(e.target.value)}>
                  <option value="">Pick…</option>
                  {rows.map((r) => (
                    <option key={`${r.src_album}:${r.src_disk ?? 1}:${r.src_position}`} value={`${r.src_album}:${r.src_disk ?? 1}:${r.src_position}`}>
                      {r.position}. {r.title}{r.track_id ? ` → ${r.site_title ?? "linked"}` : " (not linked)"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ae-check"><input type="checkbox" checked={none} onChange={(e) => setNone(e.target.checked)} /> Not on the site (remove the link)</label>
              {!none && (
                <div className="ae-field">
                  <span>The right song on {a.artist.name}&apos;s page</span>
                  <input placeholder="Type to search…" value={q} onChange={(e) => { setQ(e.target.value); setSong(null); }} />
                  {hits.length > 0 && (
                    <ul className="ae-hits">
                      {hits.map((h) => (
                        <li key={h.id}>
                          <button className={song === h.id ? "on" : undefined} onClick={() => { setSong(h.id); setQ(h.title); }}>
                            {h.title}{h.release_status ? <small> {h.release_status}</small> : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}

          {kind === "not_artist" && <p className="ae-note">It will be taken off {a.artist.name}&apos;s page.</p>}

          <div className="ae-grid">
            <label className="ae-field"><span>Why (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></label>
            <label className="ae-field"><span>Source link (optional)</span><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://…" /></label>
          </div>
          {msg && <p className={`ae-msg ${msg.kind}`}>{msg.text}</p>}
          <div className="ae-actions">
            <button className="st-btn" disabled={busy} onClick={send}>{busy ? "Sending…" : moderator ? "Save" : "Send suggestion"}</button>
            <button className="mod-link" onClick={() => { setOpen(false); reset(); setMsg(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
