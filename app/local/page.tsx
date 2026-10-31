"use client";

// Local Cuts: drop your music folder in, get a tidy zip out, ready for
// Spotify Local Files. One run, no setup:
//   1. every file's details are read on your computer (nothing uploaded)
//   2. each is matched to its song in the archive; Claude looks at the ones
//      that don't match cleanly (premium)
//   3. files that are already well formatted (title, artist and cover art)
//      are kept as they are, and what they know that the archive doesn't is
//      sent to the archive as suggestions (reviewed before anything changes)
//   4. the rest get their details rewritten from the archive: title with
//      features, artist, album (or "Unreleased <year>"), year, track number,
//      cover art, and a clean name
//   5. one zip (Artist / Album folders), written straight to disk
// Originals are never touched. Saving the zip is premium; helping the
// archive is free.

import { useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../useIsAdmin";
import { AdminModePage } from "../components/AdminModeNote";
import { usePremium } from "../usePremium";
import { readDuration, readTags } from "./tags";
import { readCover, readDetails, type FileDetails } from "./details";
import { canTag, makeZip, safeName, tidiedCopy, type NewTags } from "./write";
import { pickZipFile, ZipToDisk } from "./zip";
import { setLocalFile } from "./store";

const AUDIO = /\.(mp3|m4a|mp4|aac|flac|wav|ogg|oga|opus|webm|alac|aiff?)$/i;

type Clean = { title: string | null; artist: string | null; status: string | null; version: string | null; producers: string | null; featuring: string | null; note: string | null };
type Song = {
  key: string; file: File;
  title: string | null; artist: string | null; album: string | null; track: string | null; year: string | null; fromTags: boolean;
  duration: number | null; details: FileDetails | null;
  formatted: boolean;           // title, artist and cover in the file already
  track_id: string | null; artist_id: string | null; sure: boolean; guess: boolean; why: string | null;
  clean: Clean | null;          // Claude's tidy version, when it looked
};
type Site = {
  id: string; title: string; artist: string; album: string | null; release_date: string | null; leak_date: string | null;
  track_number: number | null; featured_artists: string | null; producers: string | null; length_sec: number | null;
  cover_url: string | null; status: string | null; parent_album: string | null; parent_cover: string | null;
};
type Stage = "idle" | "reading" | "matching" | "claude" | "archive" | "ready" | "saving" | "saved";
type Out = { song: Song; path: string; tags: NewTags | null; coverUrl: string | null; kind: "tidied" | "kept" | "claude" | "unsorted" };

const plain = (s: string | null | undefined) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
const tidyKey = (s: string | null) => plain((s ?? "").replace(/\s*[([]\s*(feat|ft|featuring|with|prod)\b[^)\]]*[)\]]/gi, ""));
function firstArtist(s: string | null) {
  return (s ?? "").split(/\s*(?:,|&|\bx\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|;|\/)\s*/i)[0]?.trim() || null;
}
const ext = (name: string) => (name.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? "").toLowerCase();
const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

// Files from a dropped folder (folders inside it too).
async function filesFromDrop(items: DataTransferItemList): Promise<File[]> {
  type Entry = { isFile: boolean; isDirectory: boolean; file?: (ok: (f: File) => void, no: () => void) => void; createReader?: () => { readEntries: (ok: (e: Entry[]) => void, no: () => void) => void } };
  const out: File[] = [];
  async function walk(e: Entry): Promise<void> {
    if (e.isFile && e.file) { const f = await new Promise<File | null>((ok) => e.file!(ok, () => ok(null))); if (f) out.push(f); return; }
    if (e.isDirectory && e.createReader) {
      const r = e.createReader();
      for (;;) {
        const batch = await new Promise<Entry[]>((ok) => r.readEntries(ok, () => ok([])));
        if (batch.length === 0) break;
        for (const c of batch) await walk(c);
      }
    }
  }
  const roots = Array.from(items).map((i) => (i as unknown as { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.()).filter(Boolean) as Entry[];
  for (const r of roots) await walk(r);
  return out;
}

// Run a list of jobs a few at a time.
async function pool<T>(list: T[], n: number, job: (t: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (next < list.length) { const i = next++; await job(list[i], i); }
  }));
}

export default function LocalCutsPage() {
  const { loading } = useAuth();
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const { premium } = usePremium();
  const [stage, setStage] = useState<Stage>("idle");
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [plan, setPlan] = useState<Out[]>([]);
  const [sent, setSent] = useState<{ details: number; songs: number; covers: number; problem: string | null } | null>(null);
  const [claudeNote, setClaudeNote] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [collected, setCollected] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const site = useRef(new Map<string, Site>());

  const busy = !["idle", "ready", "saved"].includes(stage);
  const step = (s: Stage, n: number) => { setStage(s); setDone(0); setTotal(n); };

  // ------------------------------------------------------------ the run

  async function run(picked: File[]) {
    if (!user || busy) return;
    const list = picked.filter((f) => AUDIO.test(f.name) || f.type.startsWith("audio/"));
    if (list.length === 0) { setNote("There's no music in that folder (MP3, FLAC, M4A, WAV, OGG…)."); return; }
    setNote(null); setSent(null); setSaved(null); setCollected(null); setClaudeNote(null); setPlan([]);
    site.current = new Map();

    // 1. Read every file's details.
    step("reading", list.length);
    const read: Song[] = new Array(list.length);
    let n = 0;
    await pool(list, 6, async (f, i) => {
      const t = await readTags(f);
      const d = await readDetails(f, firstArtist(t.artist)).catch(() => null);
      const duration = await readDuration(f);
      read[i] = {
        key: `${f.webkitRelativePath || f.name}|${f.size}`, file: f,
        title: t.title, artist: t.artist, album: t.album, track: t.track, year: t.year, fromTags: t.from === "tags",
        duration, details: d,
        formatted: t.from === "tags" && !!t.title && !!t.artist && !!d?.hasCover,
        track_id: null, artist_id: null, sure: false, guess: false, why: null, clean: null,
      };
      setDone(++n);
    });

    // 2. Match to the archive.
    step("matching", read.length);
    for (let i = 0; i < read.length; i += 200) {
      const batch = read.slice(i, i + 200);
      const { data, error } = await supabase.rpc("rpc_match_my_songs", {
        p_items: batch.map((s) => ({ artist: firstArtist(s.artist) ?? "", title: s.title ?? "" })), p_artist_id: null,
      });
      if (!error) {
        const rows = (data as { track_id: string | null; title: string | null; artist_id: string | null }[]) ?? [];
        batch.forEach((s, j) => {
          const r = rows[j];
          if (!s.artist || !r) return;
          s.artist_id = r.artist_id;
          if (r.track_id) { s.track_id = r.track_id; s.sure = tidyKey(r.title) === tidyKey(s.title); }
        });
      }
      setDone(Math.min(i + 200, read.length));
    }

    // 3. Claude looks at the ones that didn't match cleanly (premium).
    const unsure = read.filter((s) => !s.sure && (s.title || s.file.name));
    if (premium && unsure.length) {
      step("claude", unsure.length);
      let looked = 0, stopped: string | null = null, skipped = 0, found = 0;
      const batches: Song[][] = [];
      for (let i = 0; i < unsure.length; i += 25) batches.push(unsure.slice(i, i + 25));
      await pool(batches, 3, async (b) => {
        if (stopped) return;
        const { data, error } = await supabase.functions.invoke("local-ai", {
          body: { items: b.map((s) => ({ ref: s.key, title: s.title ?? "", artist: s.artist ?? "", file_name: s.file.name, length: s.duration })) },
        });
        if (error) {
          let msg = error.message, status = 0;
          try { const ctx = (error as { context?: Response }).context; status = ctx?.status ?? 0; const j = ctx ? await ctx.json() : null; if (j?.error) msg = j.error; } catch { /* keep */ }
          if ([401, 403, 429].includes(status)) stopped = msg; else skipped += b.length;
        } else {
          type R = { ref: string; track_id: string | null; artist_id: string | null; confidence: string | null; why: string | null; clean: Clean };
          const byKey = new Map(((data as { results?: R[] } | null)?.results ?? []).map((r) => [r.ref, r]));
          for (const s of b) {
            const r = byKey.get(s.key);
            if (!r) continue;
            s.clean = r.clean; s.why = r.why;
            if (r.artist_id) s.artist_id = r.artist_id;
            if (r.track_id && (r.confidence === "high" || r.confidence === "medium")) {
              s.track_id = r.track_id; s.sure = true; s.guess = r.confidence === "medium"; found++;
            } else {
              s.track_id = null; s.sure = false;
            }
          }
        }
        looked += b.length;
        setDone(looked);
      });
      setClaudeNote([
        `Claude identified ${found} more`,
        skipped ? `${skipped} couldn't be checked this time` : null,
        stopped ? `stopped early: ${stopped}` : null,
      ].filter(Boolean).join("; ") + ".");
    }
    for (const s of read) if (!s.sure) s.track_id = null;

    // The archive's details for every matched song.
    const ids = [...new Set(read.filter((s) => s.track_id).map((s) => s.track_id!))];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase.from("tracks")
        .select("id, title, album, release_date, leak_date, track_number, featured_artists, producers, length_sec, cover_url, release_status, parent_track_id, artists(name)")
        .in("id", ids.slice(i, i + 200));
      type Row = Omit<Site, "artist" | "status" | "parent_album" | "parent_cover"> & { release_status: string | null; parent_track_id: string | null; artists: { name: string } | null };
      const rows = (data as Row[] | null) ?? [];
      const parents = [...new Set(rows.map((r) => r.parent_track_id).filter(Boolean))] as string[];
      const pm = new Map<string, { album: string | null; cover_url: string | null }>();
      if (parents.length) {
        const { data: pd } = await supabase.from("tracks").select("id, album, cover_url").in("id", parents);
        ((pd as { id: string; album: string | null; cover_url: string | null }[] | null) ?? []).forEach((p) => pm.set(p.id, p));
      }
      rows.forEach((r) => site.current.set(r.id, {
        ...r, artist: r.artists?.name ?? "", status: r.release_status,
        parent_album: r.parent_track_id ? pm.get(r.parent_track_id)?.album ?? null : null,
        parent_cover: r.parent_track_id ? pm.get(r.parent_track_id)?.cover_url ?? null : null,
      }));
    }
    read.forEach((s) => { if (s.track_id) setLocalFile(s.track_id, s.file); });

    // 4. Well-formatted files help the archive (sent for review).
    await helpArchive(read);

    // 5. What each file becomes.
    setSongs(read);
    setPlan(buildPlan(read));
    setStage("ready");
  }

  async function helpArchive(read: Song[]) {
    const formatted = read.filter((s) => s.formatted);
    if (formatted.length === 0) { setSent({ details: 0, songs: 0, covers: 0, problem: null }); return; }
    step("archive", formatted.length);
    const gaps: Record<string, unknown>[] = [];
    const coverFor: Song[] = [];
    const news: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const s of formatted) {
      const d = s.details;
      if (s.track_id) {
        const t = site.current.get(s.track_id);
        if (!t || seen.has(t.id) || !d) continue;
        seen.add(t.id);
        const g: Record<string, unknown> = { track_id: t.id };
        if (!t.album && d.album) g.album = d.album;
        if (!t.release_date && d.date) g.release_date = d.date;
        if (t.track_number == null && d.track) g.track_number = d.track;
        if (!t.featured_artists && d.featuring) g.featured_artists = d.featuring;
        if (!t.producers && d.producers) g.producers = d.producers;
        if (!t.length_sec && s.duration) g.length_sec = s.duration;
        if (!t.cover_url && d.hasCover) coverFor.push(s);
        if (Object.keys(g).length > 1 || (!t.cover_url && d.hasCover)) gaps.push(g);
      } else if (s.artist_id && s.title) {
        news.push({
          artist_id: s.artist_id, title: s.title, album: d?.album ?? s.album, release_date: d?.date ?? null,
          featuring: d?.featuring ?? null, producers: d?.producers ?? null, length_sec: s.duration,
        });
      }
    }
    let covers = 0, details = 0, added = 0, problem: string | null = null, n = 0;
    // Covers: shrunk here, uploaded, then sent as a link with the rest.
    await pool(coverFor, 4, async (s) => {
      const blob = await readCover(s.file);
      if (blob && user) {
        const path = `local/${user.id}/${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage.from("covers").upload(path, blob, { contentType: "image/jpeg", upsert: false });
        const g = gaps.find((x) => x.track_id === s.track_id);
        if (!error && g) { g.cover_url = supabase.storage.from("covers").getPublicUrl(path).data.publicUrl; covers++; }
      }
      setDone(++n);
    });
    const real = gaps.filter((g) => Object.keys(g).length > 1);
    for (let i = 0; i < real.length && !problem; i += 100) {
      const { data, error } = await supabase.rpc("rpc_local_suggest_details", { p_items: real.slice(i, i + 100) });
      if (error) problem = error.message; else details += (data as { sent: number }).sent;
    }
    for (let i = 0; i < news.length && !problem; i += 200) {
      const { data, error } = await supabase.rpc("rpc_local_suggest_songs", { p_items: news.slice(i, i + 200) });
      if (error) problem = error.message; else added += (data as { suggested: number }).suggested;
    }
    setDone(formatted.length);
    setSent({ details, songs: added, covers, problem });
  }

  function buildPlan(read: Song[]): Out[] {
    const used = new Set<string>();
    const unique = (p: string) => {
      let q = p;
      for (let k = 2; used.has(q.toLowerCase()); k++) q = p.replace(/(\.[^./]+)?$/, (e) => ` (${k})${e}`);
      used.add(q.toLowerCase());
      return q;
    };
    const place = (artist: string, album: string, title: string, file: File) =>
      unique(`${safeName(artist)}/${safeName(album)}/${safeName(`${artist} - ${title}`)}${ext(file.name)}`);
    return read.map((s): Out => {
      const t = s.track_id ? site.current.get(s.track_id) : undefined;
      if (s.formatted) {
        // Kept exactly as it is, just filed.
        const artist = t?.artist || firstArtist(s.artist) || "Unknown Artist";
        const album = s.album || t?.album || t?.parent_album || "Singles";
        return { song: s, path: place(artist, album, s.title!, s.file), tags: null, coverUrl: null, kind: "kept" };
      }
      if (t) {
        const feat = t.featured_artists && !/\b(feat|ft)\b/i.test(t.title) ? ` (feat. ${t.featured_artists})` : "";
        const date = t.release_date ?? t.leak_date;
        const year = date?.slice(0, 4) ?? null;
        const unreleased = t.status && t.status !== "released";
        const album = t.album || t.parent_album || (unreleased ? (year ? `Unreleased ${year}` : "Unreleased") : "Singles");
        const title = t.title + feat;
        return {
          song: s, path: place(t.artist, album, title, s.file), kind: "tidied", coverUrl: t.cover_url ?? t.parent_cover,
          tags: { title, artist: t.artist, album, albumArtist: t.artist, track: t.track_number ? String(t.track_number) : null, year },
        };
      }
      const c = s.clean;
      if (c?.title && (c.artist || s.artist)) {
        const artist = c.artist || firstArtist(s.artist)!;
        const title = c.version && !c.title.toLowerCase().includes(c.version.toLowerCase()) ? `${c.title} [${c.version}]` : c.title;
        const album = c.status === "released" ? "Singles" : "Unreleased";
        return { song: s, path: place(artist, album, title, s.file), kind: "claude", coverUrl: null,
          tags: { title: c.featuring ? `${title} (feat. ${c.featuring})` : title, artist, album, albumArtist: artist, track: null, year: null } };
      }
      return { song: s, path: unique(`Unsorted/${safeName(s.file.name.replace(/\.[^.]+$/, ""))}${ext(s.file.name)}`), tags: null, coverUrl: null, kind: "unsorted" };
    });
  }

  // --------------------------------------------------------------- saving

  async function coverBytes(url: string | null, cache: Map<string, NewTags["cover"]>) {
    if (!url) return null;
    if (cache.has(url)) return cache.get(url)!;
    try {
      const res = await fetch(`/api/img?u=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error();
      const c = { mime: res.headers.get("content-type")?.split(";")[0] || "image/jpeg", data: new Uint8Array(await res.arrayBuffer()) };
      cache.set(url, c);
      return c;
    } catch { cache.set(url, null); return null; }
  }
  async function blobFor(o: Out, cache: Map<string, NewTags["cover"]>): Promise<Blob> {
    if (!o.tags || !canTag(o.song.file.name)) return o.song.file;
    return tidiedCopy(o.song.file, { ...o.tags, cover: await coverBytes(o.coverUrl, cache) });
  }
  function changesCsv() {
    const q = (v: string | null | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const what = { tidied: "details from the archive", kept: "already well formatted: kept as it was", claude: "not on the site: tidied by Claude", unsorted: "couldn't be identified: kept as it was" };
    return new Blob([["original file,new file,what happened,title,artist,album",
      ...plan.map((o) => [o.song.file.webkitRelativePath || o.song.file.name, o.path, what[o.kind], o.tags?.title ?? o.song.title, o.tags?.artist ?? o.song.artist, o.tags?.album ?? o.song.album].map(q).join(","))].join("\n")], { type: "text/csv" });
  }

  async function saveZip() {
    if (!premium || plan.length === 0) return;
    const date = new Date().toISOString().slice(0, 10);
    const out = await pickZipFile(`Static Cuts ${date}.zip`);
    if (out === null) return; // cancelled
    step("saving", plan.length);
    const cache = new Map<string, NewTags["cover"]>();
    let failed = 0;
    try {
      if (out === "unsupported") {
        // Browsers that can't save straight to disk: built in memory.
        const entries: { path: string; blob: Blob }[] = [];
        for (let i = 0; i < plan.length; i++) {
          try { entries.push({ path: `Static Cuts/${plan[i].path}`, blob: await blobFor(plan[i], cache) }); } catch { failed++; }
          setDone(i + 1);
        }
        entries.push({ path: "Static Cuts/Static Cuts changes.csv", blob: changesCsv() });
        const zip = await makeZip(entries);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(zip); a.download = `Static Cuts ${date}.zip`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      } else {
        const zip = new ZipToDisk(out);
        for (let i = 0; i < plan.length; i++) {
          try { await zip.add(`Static Cuts/${plan[i].path}`, await blobFor(plan[i], cache)); } catch { failed++; }
          setDone(i + 1);
        }
        await zip.add("Static Cuts/Static Cuts changes.csv", changesCsv());
        await zip.finish();
      }
      setSaved(`Saved ${plan.length - failed} songs${failed ? ` (${failed} couldn't be read and were left out)` : ""}. Unzip it, then add the "Static Cuts" folder in Spotify: Settings → Your Library → Show Local Files → Add a source.`);
    } catch (e) {
      setSaved(`Saving stopped: ${String((e as Error)?.message ?? e)}. Your original files are fine; try again.`);
    }
    setStage("saved");
  }

  async function collectAll() {
    const ids = [...new Set(songs.filter((s) => s.track_id).map((s) => s.track_id!))];
    if (!ids.length) return;
    const { error } = await supabase.rpc("rpc_collect_many", { p_track_ids: ids });
    setCollected(error ? error.message : `Added ${ids.length} songs to your collection.`);
  }

  // ----------------------------------------------------------------- page

  if (isAdmin) return <AdminModePage title="Local Cuts" />;

  const count = (k: Out["kind"]) => plan.filter((o) => o.kind === k).length;
  const guesses = plan.filter((o) => o.song.guess);
  const unsorted = plan.filter((o) => o.kind === "unsorted");
  const untaggable = plan.filter((o) => o.tags && !canTag(o.song.file.name)).length;
  const size = plan.reduce((t, o) => t + o.song.file.size, 0);
  const label: Record<Stage, string> = {
    idle: "", reading: "Reading your files", matching: "Matching them to the archive", claude: "Claude is looking at the unsure ones",
    archive: "Sharing what your files know with the archive", ready: "", saving: "Writing your zip", saved: "",
  };

  return (
    <div className="wrap local-cuts" style={{ maxWidth: 760 }}>
      <h1 className="detail-name page-title">Local Cuts</h1>
      <div className="detail-meta" style={{ marginBottom: 14 }}>
        Drop in your music folder and get back a tidy zip for Spotify Local Files: every song named properly, with
        the right artist, album, year and cover art from the archive, sorted into Artist / Album folders. Files
        that are already well formatted are kept as they are and help fill gaps in the archive.{" "}
        <b>Your music is never uploaded and your originals are never touched.</b>
      </div>

      {premium === false && user && (
        <div className="comments-panel" style={{ marginBottom: 12 }}>
          <b>Saving the zip is a premium feature.</b> You can still run your folder through: see how it matches, and your
          well-formatted files will help fill gaps in the archive. Ask the site owner about premium.
        </div>
      )}
      {!loading && !user && (
        <div className="comments-panel" style={{ marginBottom: 12 }}>
          <Link href="/login?next=/local" className="text-link">Log in</Link> to use Local Cuts.
        </div>
      )}

      {(stage === "idle" || stage === "ready" || stage === "saved") && user && (
        <label
          className={`local-drop ${hover ? "is-over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setHover(true); }}
          onDragLeave={() => setHover(false)}
          onDrop={async (e) => { e.preventDefault(); setHover(false); run(await filesFromDrop(e.dataTransfer.items)); }}
        >
          <input type="file" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; run(f); }}
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
          <div className="local-drop-big">{stage === "idle" ? "Drop your music folder here" : "Drop another folder"}</div>
          <div className="comment-meta">or click to choose one</div>
        </label>
      )}
      {note && <div className="comments-panel" style={{ marginTop: 10 }}>{note}</div>}

      {busy && (
        <div className="local-progress">
          <div className="review-row-title">{label[stage]}…</div>
          <div className="local-bar"><div style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} /></div>
          <div className="comment-meta">{done.toLocaleString("en-GB")} of {total.toLocaleString("en-GB")}{stage === "saving" ? ` · ${gb(size)} in all` : ""}</div>
        </div>
      )}

      {(stage === "ready" || stage === "saved") && plan.length > 0 && (
        <div className="local-summary">
          <div className="local-stats">
            <div><b>{count("tidied").toLocaleString("en-GB")}</b><span>tidied from the archive</span></div>
            <div><b>{count("kept").toLocaleString("en-GB")}</b><span>already well formatted</span></div>
            {count("claude") > 0 && <div><b>{count("claude").toLocaleString("en-GB")}</b><span>not on the site, tidied by Claude</span></div>}
            <div><b>{unsorted.length.toLocaleString("en-GB")}</b><span>couldn&apos;t be identified</span></div>
          </div>

          {sent && (sent.details > 0 || sent.songs > 0 || sent.problem) && (
            <div className="comment-meta" style={{ marginBottom: 8 }}>
              Helped the archive: {sent.details > 0 && <>details for {sent.details} song{sent.details === 1 ? "" : "s"}{sent.covers ? ` (${sent.covers} with cover art)` : ""}</>}
              {sent.details > 0 && sent.songs > 0 && " and "}
              {sent.songs > 0 && <>{sent.songs} song{sent.songs === 1 ? "" : "s"} the site didn&apos;t have</>}
              {(sent.details > 0 || sent.songs > 0) && ", sent for review. Thanks!"}
              {sent.problem && <> (stopped: {sent.problem})</>}
            </div>
          )}
          {claudeNote && <div className="comment-meta" style={{ marginBottom: 8 }}>{claudeNote}</div>}
          {premium === false && unsorted.length > 0 && (
            <div className="comment-meta" style={{ marginBottom: 8 }}>With premium, Claude also looks at the files that couldn&apos;t be identified.</div>
          )}

          <div className="review-toolbar" style={{ marginTop: 10 }}>
            <button className="tab active local-save" disabled={!premium || busy} onClick={saveZip}>
              {premium ? `Download zip (${gb(size)})` : "Download zip (premium)"}
            </button>
            {premium && songs.some((s) => s.track_id) && !collected && (
              <button className="tab" onClick={collectAll}>add matched songs to my collection</button>
            )}
          </div>
          {saved && <div className="comments-panel" style={{ marginTop: 10 }}>{saved}</div>}
          {collected && <div className="comment-meta" style={{ marginTop: 6 }}>{collected}</div>}
          {untaggable > 0 && (
            <div className="comment-meta" style={{ marginTop: 6 }}>
              {untaggable} M4A/WAV/OGG file{untaggable === 1 ? " is" : "s are"} renamed and filed, but {untaggable === 1 ? "its" : "their"} details can&apos;t be rewritten yet.
            </div>
          )}

          {guesses.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="section-label" style={{ cursor: "pointer" }}>Claude&apos;s best guesses ({guesses.length})</summary>
              {guesses.map((o) => (
                <div key={o.song.key} className="comment-meta" style={{ padding: "3px 0" }}>
                  {o.song.file.name} → <Link className="text-link" href={`/song/${o.song.track_id}`}>{o.tags?.title}</Link>{o.song.why ? ` (${o.song.why})` : ""}
                </div>
              ))}
            </details>
          )}
          {unsorted.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary className="section-label" style={{ cursor: "pointer" }}>Couldn&apos;t be identified ({unsorted.length}): kept as they were, in &ldquo;Unsorted&rdquo;</summary>
              {unsorted.slice(0, 500).map((o) => (
                <div key={o.song.key} className="comment-meta" style={{ padding: "3px 0" }}>{o.song.file.webkitRelativePath || o.song.file.name}</div>
              ))}
              {unsorted.length > 500 && <div className="comment-meta">…and {unsorted.length - 500} more (all listed in the changes file in the zip).</div>}
            </details>
          )}
        </div>
      )}
    </div>
  );
}
