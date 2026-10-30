"use client";

// Local Cuts, the other way round: your own (already tidy) files can fill
// gaps in the archive. For songs matched to the archive, it lists the details
// your files have that the site doesn't (album, release date, track number,
// features, producers, length, cover art). Songs the site doesn't have are
// offered as new songs. Where your file and the site disagree, the site's
// version stays: those are only shown. Everything you send waits for review,
// and on approval only fields that are still empty are filled.

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { readCover, readDetails, type FileDetails } from "./details";

export type GiveItem = {
  key: string; name: string; title: string | null; artist: string | null; album: string | null; duration: number | null;
  track_id: string | null; match_title: string | null; match_artist: string | null; artist_id: string | null;
  status: "sure" | "check" | "none";
  // What Claude made of it, when Claude has looked (tidy title, status...).
  clean?: { title: string | null; status: string | null; version: string | null; producers: string | null; featuring: string | null; note: string | null } | null;
};
type Site = {
  id: string; title: string; album: string | null; release_date: string | null; track_number: number | null;
  producers: string | null; featured_artists: string | null; length_sec: number | null; cover_url: string | null;
};
type Gap = { album?: string; release_date?: string; track_number?: string; featured_artists?: string; producers?: string; length_sec?: number; cover?: true };
type Row = { key: string; track_id: string; title: string; artist: string; gap: Gap; differs: [string, string, string][] };
type NewRow = {
  key: string; artist_id: string; artist: string; title: string; album: string | null; date: string | null;
  featuring: string | null; producers: string | null; length_sec: number | null; status: string | null; notes: string | null; byClaude: boolean;
};

const LABELS: Record<keyof Gap, string> = {
  album: "album", release_date: "released", track_number: "track", featured_artists: "feat.", producers: "prod.", length_sec: "length", cover: "cover art",
};
const plain = (s: string | null | undefined) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
function mmss(sec: number | null | undefined) {
  return sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : "";
}

export default function Give({ items, files, userId }: { items: GiveItem[]; files: Map<string, File>; userId: string | null }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fresh, setFresh] = useState<NewRow[]>([]);
  const [off, setOff] = useState<Set<string>>(new Set()); // unticked rows
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Matched songs with their file here (one file per song), and songs whose
  // artist is here but the song isn't.
  // (Worked out each render: the files map changes without the list changing.)
  const seen = new Set<string>();
  const matched = items.filter((i) => {
    if (i.status !== "sure" || !i.track_id || !files.has(i.key) || seen.has(i.track_id)) return false;
    seen.add(i.track_id);
    return true;
  });
  const unmatched = items.filter((i) => i.status === "none" && !i.track_id && i.artist_id && i.title);
  const fileless = items.filter((i) => i.status === "sure" && i.track_id && !files.has(i.key)).length;

  async function look() {
    if (!userId) return;
    setBusy(true); setMessage(null); setOff(new Set());
    // 1. What the site has for these songs.
    const site = new Map<string, Site>();
    const ids = matched.map((m) => m.track_id!);
    for (let i = 0; i < ids.length; i += 300) {
      setProgress(`Checking the archive… ${Math.min(i + 300, ids.length)} of ${ids.length}`);
      const { data, error } = await supabase.from("tracks")
        .select("id, title, album, release_date, track_number, producers, featured_artists, length_sec, cover_url")
        .in("id", ids.slice(i, i + 300));
      if (error) { setMessage(error.message); setBusy(false); setProgress(null); return; }
      ((data as Site[] | null) ?? []).forEach((s) => site.set(s.id, s));
    }
    // 2. What each file has, compared field by field.
    const out: Row[] = [];
    for (let i = 0; i < matched.length; i++) {
      const m = matched[i], s = site.get(m.track_id!);
      if (!s) continue;
      if (i % 10 === 0) setProgress(`Reading your files… ${i + 1} of ${matched.length}`);
      const d: FileDetails = await readDetails(files.get(m.key)!, m.match_artist);
      const gap: Gap = {}, differs: Row["differs"] = [];
      const pair = (label: string, siteVal: string | null, fileVal: string | null, put: () => void, same = plain(siteVal) === plain(fileVal)) => {
        if (!fileVal) return;
        if (!siteVal) put();
        else if (!same) differs.push([label, siteVal, fileVal]);
      };
      pair("Album", s.album, d.album, () => { gap.album = d.album!; });
      pair("Release date", s.release_date, d.date, () => { gap.release_date = d.date!; });
      pair("Track number", s.track_number != null ? String(s.track_number) : null, d.track, () => { gap.track_number = d.track!; });
      pair("Featuring", s.featured_artists, d.featuring, () => { gap.featured_artists = d.featuring!; },
        plain(s.featured_artists).length > 0 && (d.featuring ?? "").split(", ").every((n) => plain(s.featured_artists).includes(plain(n))));
      pair("Producers", s.producers, d.producers, () => { gap.producers = d.producers!; },
        plain(s.producers).length > 0 && (d.producers ?? "").split(/,\s*/).every((n) => plain(s.producers).includes(plain(n))));
      if (m.duration) {
        if (!s.length_sec) gap.length_sec = m.duration;
        else if (Math.abs(s.length_sec - m.duration) > 3) differs.push(["Length", mmss(s.length_sec), `${mmss(m.duration)} (maybe a different version?)`]);
      }
      if (!s.cover_url && d.hasCover) gap.cover = true;
      if (Object.keys(gap).length || differs.length) {
        out.push({ key: m.key, track_id: s.id, title: s.title, artist: m.match_artist ?? m.artist ?? "", gap, differs });
      }
    }
    // 3. Songs the archive doesn't have yet.
    const news: NewRow[] = [];
    for (let i = 0; i < unmatched.length; i++) {
      const u = unmatched[i], f = files.get(u.key);
      if (i % 10 === 0) setProgress(`Reading songs that aren't on the site… ${i + 1} of ${unmatched.length}`);
      const d = f ? await readDetails(f, u.artist) : null;
      const c = u.clean ?? null; // Claude's tidy version, when it has looked
      const title = c?.title ? (c.version && !c.title.toLowerCase().includes(c.version.toLowerCase()) ? `${c.title} [${c.version}]` : c.title) : u.title!;
      news.push({
        key: u.key, artist_id: u.artist_id!, artist: u.match_artist ?? u.artist ?? "", title,
        album: d?.album ?? u.album ?? null, date: d?.date ?? null,
        featuring: d?.featuring ?? c?.featuring ?? null, producers: d?.producers ?? c?.producers ?? null,
        length_sec: u.duration ?? null, status: c?.status ?? null, notes: c?.note ?? null, byClaude: !!c,
      });
    }
    setRows(out); setFresh(news); setProgress(null); setBusy(false);
  }

  const gaps = (rows ?? []).filter((r) => Object.keys(r.gap).length > 0);
  const differs = (rows ?? []).filter((r) => r.differs.length > 0);
  const tickedGaps = gaps.filter((r) => !off.has(r.key));
  const tickedNew = fresh.filter((r) => !off.has(r.key));

  function toggle(k: string) {
    setOff((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }

  async function send() {
    if (!userId || (tickedGaps.length === 0 && tickedNew.length === 0)) return;
    setBusy(true); setMessage(null);
    let sent = 0, waiting = 0, suggested = 0, skipped = 0, covers = 0;
    let problem: string | null = null;
    // Covers first: shrunk here, uploaded, then sent as a link with the rest.
    const payload: Record<string, unknown>[] = [];
    for (let i = 0; i < tickedGaps.length; i++) {
      const r = tickedGaps[i];
      const p: Record<string, unknown> = { track_id: r.track_id, ...r.gap };
      delete p.cover;
      if (r.gap.cover) {
        setProgress(`Preparing cover art… ${i + 1} of ${tickedGaps.length}`);
        const f = files.get(r.key);
        const blob = f ? await readCover(f) : null;
        if (blob) {
          const path = `local/${userId}/${crypto.randomUUID()}.jpg`;
          const { error } = await supabase.storage.from("covers").upload(path, blob, { contentType: "image/jpeg", upsert: false });
          if (!error) { p.cover_url = supabase.storage.from("covers").getPublicUrl(path).data.publicUrl; covers++; }
        }
      }
      payload.push(p);
    }
    for (let i = 0; i < payload.length && !problem; i += 100) {
      setProgress(`Sending details… ${Math.min(i + 100, payload.length)} of ${payload.length}`);
      const { data, error } = await supabase.rpc("rpc_local_suggest_details", { p_items: payload.slice(i, i + 100) });
      if (error) { problem = error.message; break; }
      const d = data as { sent: number; already_waiting: number };
      sent += d.sent; waiting += d.already_waiting;
    }
    const songs = tickedNew.map((r) => ({
      artist_id: r.artist_id, title: r.title, album: r.album, release_date: r.date, featuring: r.featuring, producers: r.producers, length_sec: r.length_sec,
      status: r.status, notes: r.notes,
    }));
    for (let i = 0; i < songs.length && !problem; i += 200) {
      setProgress(`Sending new songs… ${Math.min(i + 200, songs.length)} of ${songs.length}`);
      const { data, error } = await supabase.rpc("rpc_local_suggest_songs", { p_items: songs.slice(i, i + 200) });
      if (error) { problem = error.message; break; }
      const d = data as { suggested: number; skipped: number };
      suggested += d.suggested; skipped += d.skipped;
    }
    setProgress(null); setBusy(false);
    const parts = [
      sent > 0 && `details for ${sent} song${sent === 1 ? "" : "s"}${covers > 0 ? ` (${covers} with cover art)` : ""}`,
      suggested > 0 && `${suggested} new song${suggested === 1 ? "" : "s"}`,
    ].filter(Boolean);
    const extra = [
      waiting > 0 && `${waiting} already had details from someone's files waiting for review`,
      skipped > 0 && `${skipped} turned out to be on the site already`,
    ].filter(Boolean);
    setMessage(
      (problem ? `Stopped: ${problem}. ` : "") +
      (parts.length ? `Sent ${parts.join(" and ")} for review. You'll get the credit once they're approved.` : "Nothing new to send.") +
      (extra.length ? ` (${extra.join("; ")}.)` : ""),
    );
    if (!problem) { setRows(null); setFresh([]); }
  }

  if (!userId) {
    return <div className="empty-state"><Link href="/login?next=/local" className="text-link">Log in</Link> to share details from your files with the archive.</div>;
  }

  return (
    <div>
      <div className="detail-meta" style={{ marginBottom: 12 }}>
        Your files often know things the archive doesn&apos;t. This finds details your files have that the site is
        missing (album, release date, track number, features, producers, length, cover art) and songs it doesn&apos;t
        have yet, so you can send them in. <b>Nothing on the site is ever overwritten</b>: everything waits for
        review, and only empty fields are filled. Only the details and a small copy of the cover are sent, never the music.
      </div>

      {!rows && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <button className="tab active" disabled={busy || (matched.length === 0 && unmatched.length === 0)} onClick={look}>
            {busy ? "looking…" : `look through ${matched.length + unmatched.length} song${matched.length + unmatched.length === 1 ? "" : "s"}`}
          </button>
          <span className="comment-meta">
            {matched.length} matched{unmatched.length ? `, ${unmatched.length} not on the site yet` : ""}
            {fileless > 0 ? ` · ${fileless} matched from last time need adding again to be read` : ""}
          </span>
        </div>
      )}
      {progress && <div className="comments-panel" style={{ marginBottom: 10 }}>{progress}</div>}
      {message && <div className="comments-panel" style={{ marginBottom: 10 }}>{message}</div>}

      {rows && (
        <>
          {gaps.length === 0 && fresh.length === 0 && (
            <div className="empty-state">Nothing to add: the archive already has everything your files do.</div>
          )}
          {(gaps.length > 0 || fresh.length > 0) && (
            <div className="review-toolbar import-actions" style={{ marginBottom: 10 }}>
              <button className="tab active" disabled={busy || tickedGaps.length + tickedNew.length === 0} onClick={send}>
                {busy ? "sending…" : `send ${tickedGaps.length + tickedNew.length} for review`}
              </button>
              <button className="tab" disabled={busy} onClick={() => setOff(new Set())}>tick all</button>
              <button className="tab" disabled={busy} onClick={() => setOff(new Set([...gaps, ...fresh].map((r) => r.key)))}>untick all</button>
              <button className="tab" disabled={busy} onClick={() => { setRows(null); setFresh([]); }}>start again</button>
            </div>
          )}

          {gaps.length > 0 && <div className="section-label">The archive is missing ({gaps.length})</div>}
          {gaps.map((r) => (
            <label key={r.key} className="review-row" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={!off.has(r.key)} onChange={() => toggle(r.key)} aria-label={`send details for ${r.title}`} />
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title">
                  <Link href={`/song/${r.track_id}`} onClick={(e) => e.stopPropagation()}>{r.title}</Link>
                  <span className="comment-meta"> · {r.artist}</span>
                </div>
                <div className="review-row-meta">
                  {(Object.keys(r.gap) as (keyof Gap)[]).map((k) => (
                    <span key={k} className="feature-tag">
                      {k === "cover" ? LABELS[k] : `${LABELS[k]} ${k === "length_sec" ? mmss(r.gap.length_sec) : String(r.gap[k])}`}
                    </span>
                  ))}
                </div>
              </div>
            </label>
          ))}

          {fresh.length > 0 && <div className="section-label" style={{ marginTop: 16 }}>Not on the site yet ({fresh.length})</div>}
          {fresh.length > 0 && (
            <div className="comment-meta" style={{ marginBottom: 6 }}>
              These go on the imported-songs list for a moderator to check. The artist is on the site; the song isn&apos;t (or is spelled differently).
            </div>
          )}
          {fresh.map((r) => (
            <label key={r.key} className="review-row" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={!off.has(r.key)} onChange={() => toggle(r.key)} aria-label={`suggest ${r.title}`} />
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title">{r.title}<span className="comment-meta"> · {r.artist}</span></div>
                <div className="review-row-meta">
                  {r.status && <span className="feature-tag">{r.status}</span>}
                  {r.byClaude && <span className="feature-tag">tidied by Claude</span>}
                  {r.album && <span>{r.album}</span>}
                  {r.date && <span>{r.date}</span>}
                  {r.featuring && <span>feat. {r.featuring}</span>}
                  {r.length_sec && <span>{mmss(r.length_sec)}</span>}
                  {r.producers && <span>prod. {r.producers}</span>}
                  {r.notes && <span>{r.notes}</span>}
                </div>
              </div>
            </label>
          ))}

          {differs.length > 0 && (
            <details style={{ marginTop: 16 }}>
              <summary className="section-label" style={{ cursor: "pointer" }}>Your files say something different ({differs.length})</summary>
              <div className="comment-meta" style={{ margin: "6px 0" }}>
                The site&apos;s details stay as they are. If you&apos;re sure yours are right, open the song and suggest an edit with a source.
              </div>
              {differs.map((r) => (
                <div key={r.key} className="review-row" style={{ gridTemplateColumns: "1fr" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="review-row-title"><Link href={`/song/${r.track_id}`}>{r.title}</Link><span className="comment-meta"> · {r.artist}</span></div>
                    {r.differs.map(([label, s, f]) => (
                      <div key={label} className="comment-meta">{label}: site has <b>{s}</b>, your file has <b>{f}</b></div>
                    ))}
                  </div>
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </div>
  );
}
