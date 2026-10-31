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
  // The live feed while it runs: file names turning into songs.
  const [feed, setFeed] = useState<{ id: number; from: string; to: string; kind: "match" | "claude" | "keep" | "save" }[]>([]);
  const feedId = useRef(0);
  const lastFeed = useRef(0);
  function show(from: string, to: string, kind: "match" | "claude" | "keep" | "save", force = false) {
    const now = Date.now();
    if (!force && now - lastFeed.current < 180) return; // a readable pace, not a blur
    lastFeed.current = now;
    setFeed((f) => [{ id: ++feedId.current, from, to, kind }, ...f].slice(0, 6));
  }
  const site = useRef(new Map<string, Site>());

  const busy = !["idle", "ready", "saved"].includes(stage);
  const step = (s: Stage, n: number) => { setStage(s); setDone(0); setTotal(n); };

  // ------------------------------------------------------------ the run

  async function run(picked: File[]) {
    if (!user || busy) return;
    const list = picked.filter((f) => AUDIO.test(f.name) || f.type.startsWith("audio/"));
    if (list.length === 0) { setNote("There's no music in that folder (MP3, FLAC, M4A, WAV, OGG…)."); return; }
    setNote(null); setSent(null); setSaved(null); setCollected(null); setClaudeNote(null); setPlan([]); setFeed([]);
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
      if (t.title) show(f.name, [firstArtist(t.artist), t.title].filter(Boolean).join(" — "), "keep");
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
          if (r.track_id) {
            s.track_id = r.track_id; s.sure = tidyKey(r.title) === tidyKey(s.title);
            if (s.sure) show(s.file.name, `${firstArtist(s.artist)} — ${r.title}`, "match");
          }
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
              show(s.file.name, `${r.clean?.artist ?? firstArtist(s.artist) ?? ""} — ${r.clean?.title ?? ""}`, "claude", true);
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
          show(plan[i].song.file.name, plan[i].path, "save");
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
  const STEPS: [Stage, string][] = [
    ["reading", "Reading your files"], ["matching", "Matching them to the archive"],
    ["claude", "Claude checks the unsure ones"], ["archive", "Sharing what your files know"], ["saving", "Writing your zip"],
  ];
  const order = STEPS.map(([k]) => k);
  const at = order.indexOf(stage);
  const parts: { k: Out["kind"]; n: number; label: string }[] = [
    { k: "tidied", n: count("tidied"), label: "tidied from the archive" },
    { k: "kept", n: count("kept"), label: "already well formatted, kept as they were" },
    { k: "claude", n: count("claude"), label: "not on the site yet, tidied by Claude" },
    { k: "unsorted", n: unsorted.length, label: "couldn't be identified, left as they were" },
  ];
  const ready = (stage === "ready" || stage === "saved") && plan.length > 0;

  return (
    <div className="wrap lc">
      <header className="lc-head">
        <h1 className="lc-title">Local Cuts</h1>
        <p className="lc-lede">
          Drop in your music folder. Every song comes back named properly, with the right artist, album, year and
          cover art from the archive, sorted into folders and zipped, ready for Spotify Local Files.
        </p>
      </header>

      {stage === "idle" && (
        <div className="lc-demo" aria-hidden="true">
          {[
            ["track_07_final(2).mp3", "Ken Carson", "Freestyle (feat. Destroy Lonely)", "Unreleased 2021"],
            ["@playboicarti - sky (prod pierre) [CDQ].mp3", "Playboi Carti", "Sky", "Whole Lotta Red"],
            ["New Recording 14.m4a", "Bladee", "Obedient", "Eversince"],
          ].map(([from, artist, title, album]) => (
            <div key={from} className="lc-demo-row">
              <span className="lc-from">{from}</span>
              <span className="lc-to"><b>{title}</b><span>{artist} / {album}</span></span>
            </div>
          ))}
        </div>
      )}

      {premium === false && user && (
        <div className="lc-note">
          <b>Downloading the zip comes with premium.</b> You can still run a folder through to see how it matches,
          and your well-formatted files will help fill gaps in the archive. Ask the site owner about premium.
        </div>
      )}
      {!loading && !user && (
        <div className="lc-note"><Link href="/login?next=/local" className="text-link">Log in</Link> to use Local Cuts.</div>
      )}

      {!busy && user && (
        <label
          className={`lc-drop ${hover ? "is-over" : ""} ${ready ? "is-small" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setHover(true); }}
          onDragLeave={() => setHover(false)}
          onDrop={async (e) => { e.preventDefault(); setHover(false); run(await filesFromDrop(e.dataTransfer.items)); }}
        >
          <input type="file" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; run(f); }}
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
          <span className="lc-drop-big">{ready ? "Drop another folder" : "Drop your music folder"}</span>
          <span className="lc-drop-small">or click to choose one · MP3, FLAC, M4A, WAV, OGG</span>
        </label>
      )}
      {!busy && user && !ready && (
        <p className="lc-promise">Your music never leaves your computer, and your original files are never changed.</p>
      )}
      {note && <div className="lc-note">{note}</div>}

      {busy && (
        <section className="lc-run" aria-live="polite">
          <ol className="lc-steps">
            {STEPS.filter(([k]) => (stage === "saving" ? k === "saving" : k !== "saving" && (k !== "claude" || premium))).map(([k, label]) => {
              const i = order.indexOf(k);
              const state = i < at ? "done" : i === at ? "now" : "later";
              return (
                <li key={k} className={`lc-step is-${state}`}>
                  <span className="lc-step-label">{label}</span>
                  {state === "now" && <span className="lc-step-count">{done.toLocaleString("en-GB")} / {total.toLocaleString("en-GB")}</span>}
                </li>
              );
            })}
          </ol>
          <div className="lc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
          </div>
          <ul className="lc-feed">
            {feed.map((f) => (
              <li key={f.id} className={`lc-feed-row is-${f.kind}`}>
                <span className="lc-from">{f.from}</span>
                <span className="lc-to"><b>{f.to}</b>{f.kind === "claude" && <span>found by Claude</span>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ready && (
        <section className="lc-done">
          <div className="lc-total">
            <span className="lc-total-n">{plan.length.toLocaleString("en-GB")}</span>
            <span className="lc-total-label">songs ready · {gb(size)}</span>
          </div>
          <div className="lc-split" aria-hidden="true">
            {parts.filter((p) => p.n > 0).map((p) => (
              <span key={p.k} className={`is-${p.k}`} style={{ flexGrow: p.n }} />
            ))}
          </div>
          <ul className="lc-legend">
            {parts.filter((p) => p.n > 0).map((p) => (
              <li key={p.k}><i className={`is-${p.k}`} /><b>{p.n.toLocaleString("en-GB")}</b> {p.label}</li>
            ))}
          </ul>

          <button className="lc-save" disabled={!premium || busy} onClick={saveZip}>
            {premium ? "Download zip" : "Download zip · premium"}
          </button>
          {saved && <div className="lc-note">{saved}</div>}

          <div className="lc-extra">
            {sent && (sent.details > 0 || sent.songs > 0) && (
              <p>
                Your files helped the archive:{" "}
                {[sent.details > 0 && `details for ${sent.details} song${sent.details === 1 ? "" : "s"}${sent.covers ? ` (${sent.covers} with cover art)` : ""}`,
                  sent.songs > 0 && `${sent.songs} song${sent.songs === 1 ? "" : "s"} it didn't have`].filter(Boolean).join(" and ")}
                , sent for review.
              </p>
            )}
            {sent?.problem && <p>Sharing with the archive stopped: {sent.problem}</p>}
            {claudeNote && <p>{claudeNote}</p>}
            {premium === false && unsorted.length > 0 && <p>With premium, Claude also looks at the files that couldn&apos;t be identified.</p>}
            {untaggable > 0 && <p>{untaggable} M4A, WAV or OGG file{untaggable === 1 ? " is" : "s are"} renamed and filed, but {untaggable === 1 ? "its" : "their"} details can&apos;t be rewritten yet.</p>}
            {premium && songs.some((s) => s.track_id) && !collected && (
              <button className="text-link inline-btn" onClick={collectAll}>Add the matched songs to my collection</button>
            )}
            {collected && <p>{collected}</p>}
          </div>

          {guesses.length > 0 && (
            <details className="lc-list">
              <summary>Claude&apos;s best guesses <span>{guesses.length}</span></summary>
              {guesses.map((o) => (
                <div key={o.song.key} className="lc-list-row">
                  <span className="lc-from">{o.song.file.name}</span>
                  <span className="lc-to"><Link href={`/song/${o.song.track_id}`}>{o.tags?.title}</Link>{o.song.why && <span>{o.song.why}</span>}</span>
                </div>
              ))}
            </details>
          )}
          {unsorted.length > 0 && (
            <details className="lc-list">
              <summary>Couldn&apos;t be identified <span>{unsorted.length}</span></summary>
              <p className="lc-list-note">These go in the zip&apos;s Unsorted folder exactly as they were.</p>
              {unsorted.slice(0, 500).map((o) => (
                <div key={o.song.key} className="lc-list-row"><span className="lc-from">{o.song.file.webkitRelativePath || o.song.file.name}</span></div>
              ))}
              {unsorted.length > 500 && <p className="lc-list-note">And {unsorted.length - 500} more, all listed in the changes file inside the zip.</p>}
            </details>
          )}
        </section>
      )}
    </div>
  );
}
