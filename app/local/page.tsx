"use client";
import "../styles/local.css";

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
//      cover art (600×600, shared across an unreleased year), the song's Static-Cuts code (hidden; next time the file
//      matches exactly, straight away), and a clean name
//   5. a tidy "Static-Cuts" folder (Artist / Album), written straight into a
//      folder you pick (Chrome, Edge, Opera) or as one zip
// Files kept as they are still get the song's code added (nothing else
// changes). Originals are never touched and the music itself never leaves the
// computer. Step 3 ("help the archive") sends details and cover art from
// well-tagged files for review, and can be switched off. Before saving you
// can check every file, undo any of Claude's guesses and keep any file as it
// was. Saving the zip is premium; helping the archive is free.

import type React from "react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../useIsAdmin";
import { AdminModePage } from "../components/AdminModeNote";
import { usePremium } from "../usePremium";
import { readDuration, readTags } from "./tags";
import { readCover, readDetails, type FileDetails } from "./details";
import { canTag, makeZip, safeName, tidiedCopy, withCode, type NewTags } from "./write";
import { canPickFolder, pickFolder, pickZipFile, ZipToDisk } from "./zip";
import { setLocalFile } from "./store";
import { desktop, doneSet, inDesktopApp, LibraryWriter, markDone, type Folders } from "./desktop";
import { thumb } from "@/lib/thumb";
import Missing from "../components/Missing";

const AUDIO = /\.(mp3|m4a|mp4|aac|flac|wav|ogg|oga|opus|webm|alac|aiff?)$/i;

type Clean = { title: string | null; artist: string | null; status: string | null; version: string | null; producers: string | null; featuring: string | null; note: string | null };
type Song = {
  key: string; file: File;
  title: string | null; artist: string | null; album: string | null; track: string | null; year: string | null; fromTags: boolean;
  duration: number | null; details: FileDetails | null;
  formatted: boolean;           // title, artist and cover in the file already
  track_id: string | null; artist_id: string | null; sure: boolean; guess: boolean; why: string | null;
  clean: Clean | null;          // Claude's tidy version, when it looked
  base_id?: string | null;      // a version the archive doesn't have: the song it's a version of
  folder_artist?: string | null; // nearest folder that's an artist on the site
  folder_artist_id?: string | null;
  code: string | null;          // Static-Cuts code already in the file (from an earlier run)
};
type Site = {
  id: string; title: string; artist: string; album: string | null; release_date: string | null; leak_date: string | null;
  track_number: number | null; featured_artists: string | null; producers: string | null; length_sec: number | null;
  cover_url: string | null; status: string | null; parent_album: string | null; parent_cover: string | null;
  credited_as?: string | null;  // released under another name of theirs
  display_cover?: string | null; // own art, else fans' pick, else a photo of the artist
  code?: string | null;          // its Static-Cuts code, written into the tidied file
};
type Stage = "idle" | "reading" | "matching" | "claude" | "archive" | "ready" | "saving" | "saved";
type Out = { song: Song; path: string; tags: NewTags | null; coverUrl: string | null; kind: "tidied" | "kept" | "claude" | "unsorted" | "asis";
  byFolder?: boolean; // "claude" kind, but named from its artist folder
  code?: string | null }; // kept files: the code to add (nothing else changes)

const plain = (s: string | null | undefined) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
// The song a version belongs to: "Off The Grid [12.07.20 Ye Voc]" and
// "Mr. Miyagi (V24)" -> "Off The Grid", "Mr. Miyagi". Features stay out of it.
const baseTitle = (t: string) => {
  let b = t.replace(/\s*[([]\s*(feat|ft|featuring|with|prod)\b.*$/i, "").trim();
  for (let i = 0; i < 3; i++) b = b.replace(/\s*[([][^()[\]]*[)\]]\s*$/, "").trim();
  return b;
};
// A file's title as the archive would write it: no leading track number
// ("2.safehouse", "02. Teddy Picker") and no "(prod. ...)".
const matchTitle = (t: string | null) => (t ?? "")
  .replace(/^[^\p{L}\p{N}([]+/u, "") // tracker markers in front: ✨ ⭐ 🏆 🥇 🗑️
  .replace(/^\s*\d{1,2}\s*\.\s*(?=\p{L})/u, "")
  .replace(/\s*[([]\s*prod\b[^)\]]*[)\]]/gi, "")
  .replace(/\s+(?:produced by|prod\.? by|prod\.)\s+.+$/i, "") // "you & me produced by horse head"
  .replace(/\s*\(\d\)\s*$/, "") // the "(1)" a browser adds to a second download
  .replace(/[\s☆★⭐✨🌟🏆🥇]+$/u, "") // tracker stars at the end: "G6 ☆☆☆☆☆"
  .replace(/\s{2,}/g, " ").trim();
// The folders a file sits in, nearest first, not counting the top folder
// that was picked: "Music/Playboi Carti/Die Lit/song.mp3" -> ["Die Lit",
// "Playboi Carti"]. The nearest one that's an artist on the site stands in
// for the artist when the file's tags don't say. Generic names never count,
// even if an artist with that name turns up later.
// A file's path inside the folder you picked ("Music/Playboi Carti/x.mp3").
// The folder picker fills webkitRelativePath; a dragged-in folder doesn't,
// so the path from the drop is kept here instead.
const dropPaths = new WeakMap<File, string>();
const pathOf = (f: File) => f.webkitRelativePath || dropPaths.get(f) || f.name;
const GENERIC_FOLDER = /^(music|my music|songs?|downloads?|desktop|documents|new folder.*|untitled.*|misc.*|z-?misc|other|old|new|temp|tmp|backup.*|playlists?|local files|spotify|itunes|apple music|phone|ipod|mp3s?|flac|wav|m4a|audio|leaks?|leaked|unreleased|released|snippets?|singles?|albums?|eps?|mixtapes?|demos?|features?|feats?|remix(es)?|instrumentals?|live|bootlegs?|collection|archive|library|rap|hip ?hop|trap|rock|pop|r&b|various( artists)?|unknown( artist)?|va|compilations?|(19|20)\d\d(s)?)$/i;
const foldersOf = (f: File) => {
  const parts = pathOf(f).split("/").slice(1, -1).map((p) => p.trim()).filter(Boolean);
  return parts.reverse().filter((p) => !GENERIC_FOLDER.test(p));
};
// Claude's clean title with its version in the archive's style: "Song [V2]".
const cleanTitle = (s: { clean: Clean | null }) => (s.clean!.version && !s.clean!.title!.toLowerCase().includes(s.clean!.version.toLowerCase())
  ? `${s.clean!.title} [${s.clean!.version}]` : s.clean!.title!);
const tidyKey = (s: string | null) => plain((s ?? "").replace(/\s*[([]\s*(feat|ft|featuring|with|prod)\b[^)\]]*[)\]]/gi, ""));
function firstArtist(s: string | null) {
  return (s ?? "").split(/\s*(?:,|&|\bx\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|;|\/)\s*/i)[0]?.trim() || null;
}
const ext = (name: string) => (name.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? "").toLowerCase();
const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

// Every cover written into a file the same way: a 600×600 JPEG, cropped to a
// square from the middle. Covers come from many sites in every size and
// format (WebP, huge PNGs, wide photos), and some players show WebP as no
// art at all. null if the browser can't read the picture (the original is
// used then).
const COVER = 600;
async function squareJpeg(blob: Blob): Promise<{ mime: string; data: Uint8Array } | null> {
  try {
    const img = await createImageBitmap(blob);
    const side = Math.min(img.width, img.height);
    if (!side) return null;
    const size = Math.min(COVER, side);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    img.close();
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.9));
    return out ? { mime: "image/jpeg", data: new Uint8Array(await out.arrayBuffer()) } : null;
  } catch {
    return null;
  }
}

// Files from a dropped folder (folders inside it too).
async function filesFromDrop(items: DataTransferItemList): Promise<File[]> {
  type Entry = { isFile: boolean; isDirectory: boolean; fullPath?: string; file?: (ok: (f: File) => void, no: () => void) => void; createReader?: () => { readEntries: (ok: (e: Entry[]) => void, no: () => void) => void } };
  const out: File[] = [];
  async function walk(e: Entry): Promise<void> {
    if (e.isFile && e.file) {
      const f = await new Promise<File | null>((ok) => e.file!(ok, () => ok(null)));
      if (f) { if (e.fullPath) dropPaths.set(f, e.fullPath.replace(/^\/+/, "")); out.push(f); }
      return;
    }
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
  const [finishing, setFinishing] = useState(false);
  const [folderOk, setFolderOk] = useState(false);
  useEffect(() => { setFolderOk(canPickFolder()); }, []);
  const [collected, setCollected] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  // Help the archive: send what well-tagged files know (details, cover art)
  // for review. On unless switched off; remembered on this device.
  const [share, setShareState] = useState(true);
  useEffect(() => { try { if (localStorage.getItem("local_share") === "off") setShareState(false); } catch { /* fine */ } }, []);
  const setShare = (v: boolean) => { setShareState(v); try { localStorage.setItem("local_share", v ? "on" : "off"); } catch { /* fine */ } };
  // Files to copy exactly as they were (chosen in the full list), and
  // Claude's guesses that were turned down.
  const [asIs, setAsIs] = useState<Set<string>>(() => new Set());
  const [undone, setUndone] = useState(0);
  const [q, setQ] = useState("");
  const [canStream, setCanStream] = useState(true);
  useEffect(() => { setCanStream(typeof window !== "undefined" && "showSaveFilePicker" in window); }, []);
  const site = useRef(new Map<string, Site>());
  // Artist photos, the cover for songs that aren't on the site.
  const photos = useRef(new Map<string, string>());
  // How titles are written: "Title [Version] (Feat. X)" by default.
  const [featStyle, setFeatStyleState] = useState<"Feat." | "feat." | "none">(() => {
    try { const v = typeof window !== "undefined" ? localStorage.getItem("local_feat_style") : null; return v === "feat." || v === "none" ? v : "Feat."; } catch { return "Feat."; }
  });

  const busy = !["idle", "ready", "saved"].includes(stage);
  const step = (s: Stage, n: number) => { setStage(s); setDone(0); setTotal(n); };

  // ------------------------------------------------------------ the run

  // Returns what each file becomes (null if nothing ran), so the desktop app
  // can save it straight away without the review step.
  async function run(picked: File[]): Promise<Out[] | null> {
    if (!user || busy) return null;
    const list = picked.filter((f) => AUDIO.test(f.name) || f.type.startsWith("audio/"));
    if (list.length === 0) { setNote("There's no music in that folder (MP3, FLAC, M4A, WAV, OGG…)."); return null; }
    setNote(null); setSent(null); setSaved(null); setCollected(null); setClaudeNote(null); setPlan([]);
    setAsIs(new Set()); setUndone(0); setQ("");
    site.current = new Map();
    photos.current = new Map();

    // 1. Read every file's details.
    step("reading", list.length);
    const read: Song[] = new Array(list.length);
    let n = 0;
    await pool(list, 6, async (f, i) => {
      const t = await readTags(f);
      const d = await readDetails(f, firstArtist(t.artist)).catch(() => null);
      const duration = await readDuration(f);
      read[i] = {
        key: `${pathOf(f)}|${f.size}`, file: f,
        title: t.title, artist: t.artist, album: t.album, track: t.track, year: t.year, fromTags: t.from === "tags",
        duration, details: d,
        formatted: t.from === "tags" && !!t.title && !!t.artist && !!d?.hasCover,
        track_id: null, artist_id: null, sure: false, guess: false, why: null, clean: null, code: t.code ?? null,
      };
      setDone(++n);
    });

    // 2. Match to the archive. Files Local Cuts tidied before carry the
    // song's Static-Cuts code: those match exactly, straight away.
    step("matching", read.length);
    const withCode = read.filter((s) => s.code);
    for (let i = 0; i < withCode.length; i += 200) {
      const part = withCode.slice(i, i + 200);
      const { data } = await supabase.from("track_codes").select("track_id, code").in("code", part.map((s) => s.code!));
      const byCode = new Map(((data as { track_id: string; code: string }[] | null) ?? []).map((r) => [r.code, r.track_id]));
      part.forEach((s) => { const id = byCode.get(s.code!); if (id) { s.track_id = id; s.sure = true; } });
    }
    // Files with no artist in their tags: which of their folders is an artist
    // on the site (one look-up for every folder name).
    // Also checked in the same look-up: the tag artist, and the left side of
    // titles like "Playboi Carti - Menage" (files whose artist tag is whoever
    // uploaded them: "joshbeast", "HypeDucky", "Author").
    const dash = /^(.+?)\s+[-–—]\s+(.+)$/;
    const leftOf = (t: string | null) => { const m = (t ?? "").match(dash); return m ? [m[1].trim(), m[2].trim()] as const : null; };
    const names = [...new Set(read.flatMap((s) => [...foldersOf(s.file), firstArtist(s.artist), ...(leftOf(s.title) ?? [])].filter((x): x is string => !!x)))];
    const isArtist = new Map<string, string>();
    for (let i = 0; i < names.length; i += 300) {
      const { data, error } = await supabase.rpc("rpc_match_my_songs", { p_items: names.slice(i, i + 300).map((n) => ({ artist: n, title: "" })), p_artist_id: null });
      if (error) setNote(`Some folders couldn't be checked against the archive (${error.message}). Run the folder again in a minute.`);
      ((data as { artist_in: string; artist_id: string | null }[] | null) ?? []).forEach((r) => { if (r.artist_id) isArtist.set(r.artist_in, r.artist_id); });
    }
    for (const s of read) {
      s.folder_artist = foldersOf(s.file).find((n) => isArtist.has(n)) ?? null;
      s.folder_artist_id = s.folder_artist ? isArtist.get(s.folder_artist) ?? null : null;
      // "Playboi Carti - Menage" by "joshbeast": the artist is in the title.
      // Not well formatted, whatever the tags say; matched as Carti's "Menage".
      const lr = leftOf(s.title);
      const tag = firstArtist(s.artist);
      const free = (a: string) => !tag || !isArtist.has(tag) || tag.toLowerCase() === a.toLowerCase();
      if (lr && isArtist.has(lr[0]) && free(lr[0])) {
        s.artist = lr[0]; s.title = lr[1]; s.formatted = false;
      } else if (lr && !isArtist.has(lr[0]) && isArtist.has(lr[1]) && free(lr[1])) {
        // The other way round: "Scream - Black Flag".
        s.artist = lr[1]; s.title = lr[0]; s.formatted = false;
      }
    }
    for (let i = 0; i < read.length; i += 200) {
      const batch = read.slice(i, i + 200);
      const { data, error } = await supabase.rpc("rpc_match_my_songs", {
        p_items: batch.map((s) => ({ artist: firstArtist(s.artist) ?? s.folder_artist ?? "", title: s.title ?? "" })), p_artist_id: null,
      });
      if (error) setNote(`Some songs couldn't be checked against the archive (${error.message}). Run the folder again in a minute.`);
      if (!error) {
        const rows = (data as { track_id: string | null; title: string | null; artist_id: string | null }[]) ?? [];
        batch.forEach((s, j) => {
          const r = rows[j];
          if (s.sure || !(s.artist || s.folder_artist) || !r) return; // matched by its code already
          if (!s.artist && !r.artist_id) return;
          s.artist_id = r.artist_id;
          // No artist in the tags, but the folder's name is an artist on the site.
          if (!s.artist && r.artist_id) s.artist = s.folder_artist ?? null;
          if (r.track_id) { s.track_id = r.track_id; s.sure = tidyKey(r.title) === tidyKey(s.title); }
        });
      }
      setDone(Math.min(i + 200, read.length));
    }
    // Files that didn't match as they are get a few more tries, first exact
    // match wins: the title cleaned up (tracker markers, track numbers,
    // "(prod. ...)"), the file's name when it differs from the tag title
    // ("HOMICIDE55555 [V1]" vs "pbc HOMICIDE55555 8.29.23"), and both again
    // with the folder's artist (a K Suave song filed under Playboi Carti).
    const stem = (f: File) => f.name.replace(/\.[^.]+$/, "").replace(/_+/g, " ").replace(/\s{2,}/g, " ").trim();
    const tries: { s: Song; artist: string; title: string; byFolder: boolean }[] = [];
    for (const s of read) {
      if (s.sure) continue;
      // "K Suave - Perky97 [V1]", "4 RAWS - EsDeeKid ft. X": each side of the dash too.
      const sides = stem(s.file).split(/\s+[-–—]\s+/).filter((x) => x.length >= 2);
      const titles = [...new Set([matchTitle(s.title), matchTitle(stem(s.file)), ...(sides.length === 2 ? sides.map(matchTitle) : [])]
        .filter((t) => t.length >= 2))];
      const tagArtist = firstArtist(s.artist);
      const artists: [string, boolean][] = [];
      if (tagArtist) artists.push([tagArtist, false]);
      if (s.folder_artist && s.folder_artist.toLowerCase() !== (tagArtist ?? "").toLowerCase()) artists.push([s.folder_artist, true]);
      for (const [artist, byFolder] of artists) for (const title of titles) {
        if (!byFolder && title === s.title) continue; // already tried as it is
        tries.push({ s, artist, title, byFolder });
      }
    }
    for (let i = 0; i < tries.length; i += 300) {
      const batch = tries.slice(i, i + 300);
      const { data, error } = await supabase.rpc("rpc_match_my_songs", { p_items: batch.map((x) => ({ artist: x.artist, title: x.title })), p_artist_id: null });
      if (error) { setNote(`Some songs couldn't be checked against the archive (${error.message}). Run the folder again in a minute.`); break; }
      const rows = (data as { track_id: string | null; title: string | null; artist_id: string | null }[]) ?? [];
      batch.forEach((x, j) => {
        const r = rows[j];
        if (x.s.sure || !r?.track_id || tidyKey(r.title) !== tidyKey(x.title)) return;
        x.s.track_id = r.track_id; x.s.artist_id = r.artist_id ?? x.s.artist_id; x.s.sure = true;
        if (!x.s.artist) x.s.artist = x.artist;
      });
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
          body: { items: b.map((s) => ({ ref: s.key, title: s.title ?? "", artist: s.artist ?? "", file_name: pathOf(s.file).split("/").slice(1).join("/") || s.file.name, length: s.duration })) },
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
    // Files Claude cleaned up (a proper artist and title from messy tags or a
    // file name) get one more look in the archive with the clean names, so
    // they're tidied with the archive's details, cover and code, not just
    // Claude's guess. Only exact title matches count.
    const cleaned = read.filter((s) => !s.sure && s.clean?.title && (s.clean.artist || s.artist));
    for (let i = 0; i < cleaned.length; i += 200) {
      const batch = cleaned.slice(i, i + 200);
      const { data, error } = await supabase.rpc("rpc_match_my_songs", {
        p_items: batch.map((s) => ({ artist: s.clean!.artist || firstArtist(s.artist) || "", title: cleanTitle(s) })), p_artist_id: null,
      });
      if (error) break;
      const rows = (data as { track_id: string | null; title: string | null; artist_id: string | null }[]) ?? [];
      batch.forEach((s, j) => {
        const r = rows[j];
        if (r?.track_id && tidyKey(r.title) === tidyKey(cleanTitle(s))) {
          s.track_id = r.track_id; s.artist_id = r.artist_id ?? s.artist_id; s.sure = true;
        }
      });
    }
    for (const s of read) if (!s.sure) s.track_id = null;

    // Versions the archive doesn't have, of songs it does ("We Did It Kid
    // [REF 2_15_24]" when it knows "We Did It Kid"): find the song, so the
    // file is filed under its era with its cover, keeping its own title.
    const loose = read.filter((s) => !s.track_id && !s.formatted).map((s) => {
      const title = s.clean?.title ? cleanTitle(s) : matchTitle(s.title);
      const artist = s.clean?.artist || firstArtist(s.artist);
      const base = title ? baseTitle(title) : "";
      return { s, artist, base, ok: !!artist && !!base && base.toLowerCase() !== (title ?? "").toLowerCase() };
    }).filter((x) => x.ok);
    for (let i = 0; i < loose.length; i += 200) {
      const batch = loose.slice(i, i + 200);
      const { data, error } = await supabase.rpc("rpc_match_my_songs", {
        p_items: batch.map((x) => ({ artist: x.artist, title: x.base })), p_artist_id: null,
      });
      if (error) break;
      const rows = (data as { track_id: string | null; title: string | null; artist_id: string | null }[]) ?? [];
      batch.forEach((x, j) => {
        const r = rows[j];
        if (r?.track_id && tidyKey(r.title) === tidyKey(x.base)) { x.s.base_id = r.track_id; x.s.artist_id = x.s.artist_id ?? r.artist_id; }
      });
    }

    // The archive's details for every matched song.
    const ids = [...new Set(read.flatMap((s) => [s.track_id, s.base_id]).filter((x): x is string => !!x))];
    for (let i = 0; i < ids.length; i += 200) {
      // artists!artist_id: songs also link to artists through "appears on",
      // so the main artist has to be named or the whole query fails.
      const { data, error } = await supabase.from("tracks")
        .select("id, title, album, release_date, leak_date, track_number, featured_artists, producers, length_sec, cover_url, release_status, parent_track_id, credited_as, artists!artist_id(name)")
        .in("id", ids.slice(i, i + 200));
      if (error) setNote(`Couldn't load the archive's details for your matched songs (${error.message}), so they're filed as they are. Try again in a minute.`);
      type Row = Omit<Site, "artist" | "status" | "parent_album" | "parent_cover"> & { release_status: string | null; parent_track_id: string | null; artists: { name: string } | null };
      const rows = (data as Row[] | null) ?? [];
      const parents = [...new Set(rows.map((r) => r.parent_track_id).filter(Boolean))] as string[];
      const pm = new Map<string, { album: string | null; cover_url: string | null }>();
      if (parents.length) {
        const { data: pd } = await supabase.from("tracks").select("id, album, cover_url").in("id", parents);
        ((pd as { id: string; album: string | null; cover_url: string | null }[] | null) ?? []).forEach((p) => pm.set(p.id, p));
      }
      // The picture each song shows on the site: its own art, else the fans'
      // pick, else a photo of the artist (so every file gets a cover).
      const { data: cv } = await supabase.rpc("rpc_track_covers", { p_ids: rows.map((r) => r.id) });
      const covers = new Map(((cv as { id: string; url: string | null }[] | null) ?? []).map((c) => [c.id, c.url]));
      const { data: cd } = await supabase.from("track_codes").select("track_id, code").in("track_id", rows.map((r) => r.id));
      const codes = new Map(((cd as { track_id: string; code: string }[] | null) ?? []).map((c) => [c.track_id, c.code]));
      rows.forEach((r) => site.current.set(r.id, {
        ...r, artist: r.artists?.name ?? "", status: r.release_status,
        parent_album: r.parent_track_id ? pm.get(r.parent_track_id)?.album ?? null : null,
        parent_cover: r.parent_track_id ? pm.get(r.parent_track_id)?.cover_url ?? null : null,
        display_cover: covers.get(r.id) ?? null,
        code: codes.get(r.id) ?? null,
      }));
    }
    // Songs that aren't on the site get their artist's photo as the cover
    // (the same fallback the site's own songs use).
    const aids = [...new Set(read.filter((s) => !s.track_id).flatMap((s) => [s.artist_id, s.folder_artist_id]).filter((x): x is string => !!x))];
    for (let i = 0; i < aids.length; i += 200) {
      const { data } = await supabase.from("artists").select("id, image_url").in("id", aids.slice(i, i + 200));
      ((data as { id: string; image_url: string | null }[] | null) ?? []).forEach((a) => { if (a.image_url) photos.current.set(a.id, a.image_url); });
    }
    read.forEach((s) => { if (s.track_id) setLocalFile(s.track_id, s.file); });

    // 4. Well-formatted files help the archive (sent for review), unless
    // that's switched off.
    if (share) await helpArchive(read);

    // 5. What each file becomes.
    setSongs(read);
    const built = buildPlan(read);
    setPlan(built);
    setStage("ready");
    return built;
  }

  async function helpArchive(read: Song[]) {
    const formatted = read.filter((s) => s.formatted);
    // Files that aren't well formatted but Claude worked out (an artist that's
    // on the site, a clean title and version) and that the archive doesn't
    // have: suggested as new songs / versions too. They go to Import review,
    // which skips anything the archive already has.
    // Versions of a song the archive knows (found by its name) count too.
    const worked = read.filter((s) => !s.formatted && !s.track_id && s.artist_id && (s.clean?.title || (s.base_id && s.fromTags && s.title)));
    const extra = worked.map((s) => ({
      artist_id: s.artist_id, title: s.clean?.title ? cleanTitle(s) : s.title, status: s.clean?.status ?? null,
      featuring: s.clean?.featuring ?? null, producers: s.clean?.producers ?? null, length_sec: s.duration,
      notes: [s.clean ? "From a listener's file, identified by Claude." : "From a listener's file.", s.clean?.note].filter(Boolean).join(" "),
    }));
    if (formatted.length === 0 && extra.length === 0) { setSent({ details: 0, songs: 0, covers: 0, problem: null }); return; }
    step("archive", formatted.length);
    const gaps: Record<string, unknown>[] = [];
    const coverFor: Song[] = [];
    const news: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const s of formatted) {
      const d = s.details;
      // Only songs matched for certain: a guess could be the wrong song.
      if (s.guess) continue;
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
    news.push(...extra);
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

  function setFeatStyle(v: "Feat." | "feat." | "none") {
    setFeatStyleState(v);
    try { localStorage.setItem("local_feat_style", v); } catch { /* fine */ }
  }
  // Re-name everything when the style changes or a file is set to "as it was".
  useEffect(() => {
    if (songs.length) setPlan(buildPlan(songs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featStyle, asIs]);

  // "Not this song": one of Claude's guesses turned down. The file is planned
  // again as if it hadn't matched (its folder's artist, or Unsorted).
  function rejectGuess(key: string) {
    const next = songs.map((s) => (s.key === key ? { ...s, track_id: null, sure: false, guess: false } : s));
    setSongs(next);
    setPlan(buildPlan(next));
    setUndone((n) => n + 1);
  }
  function toggleAsIs(key: string) {
    setAsIs((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
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
    const out = read.map((s): Out => {
      // Chosen in the full list: copied exactly as it was, in its old folders.
      if (asIs.has(s.key)) {
        const rel = pathOf(s.file).split("/").slice(1).join("/") || s.file.name;
        return { song: s, path: unique(`Kept as it was/${rel.split("/").map((x) => safeName(x)).join("/")}`), tags: null, coverUrl: null, kind: "asis" };
      }
      const t = s.track_id ? site.current.get(s.track_id) : undefined;
      if (s.formatted) {
        // Kept exactly as it is, just filed.
        const artist = t?.artist || firstArtist(s.artist) || "Unknown Artist";
        const album = s.album || t?.album || t?.parent_album || "Singles";
        return { song: s, path: place(artist, album, s.title!, s.file), tags: null, coverUrl: null, kind: "kept",
          code: t?.code && t.code !== s.code ? t.code : null };
      }
      if (t) {
        // "Title [Version] (Feat. X)": the version tag is already part of the
        // title here; features added in the chosen style.
        const feat = t.featured_artists && featStyle !== "none" && !/\b(feat|ft)\b/i.test(t.title) ? ` (${featStyle} ${t.featured_artists})` : "";
        const date = t.release_date ?? t.leak_date;
        const year = date?.slice(0, 4) ?? null;
        const unreleased = t.status && t.status !== "released";
        // The era is the album; unreleased songs with no era go under
        // "Unreleased <year>" (or plain "Unreleased" with no date).
        const album = t.album || t.parent_album || (unreleased ? (year ? `Unreleased ${year}` : "Unreleased") : "Singles");
        const title = t.title + feat;
        // Songs released under another of their names keep that name.
        const artist = t.credited_as || t.artist;
        return {
          song: s, path: place(t.artist, album, title, s.file), kind: "tidied", coverUrl: t.display_cover ?? t.cover_url ?? t.parent_cover,
          tags: { title, artist, album, albumArtist: t.artist, track: t.track_number ? String(t.track_number) : null, year, code: t.code ?? null },
        };
      }
      const b = s.base_id ? site.current.get(s.base_id) : undefined;
      if (b) {
        // A version the archive doesn't have: its own title, the song's era,
        // artist and cover (no code: that belongs to the song, not this file).
        const own = s.clean?.title ? cleanTitle(s) : s.title!;
        const feat = s.clean?.featuring && featStyle !== "none" && !/\b(feat|ft)\b/i.test(own) ? ` (${featStyle} ${s.clean.featuring})` : "";
        const unreleased = b.status && b.status !== "released";
        const album = b.album || b.parent_album || (unreleased ? "Unreleased" : "Singles");
        const title = own + feat;
        return {
          song: s, path: place(b.artist, album, title, s.file), kind: "tidied", coverUrl: s.details?.hasCover ? null : (b.display_cover ?? b.cover_url ?? b.parent_cover),
          tags: { title, artist: b.credited_as || b.artist, album, albumArtist: b.artist, track: null, year: null },
        };
      }
      const c = s.clean;
      if (c?.title && (c.artist || s.artist)) {
        const artist = c.artist || firstArtist(s.artist)!;
        const title = c.version && !c.title.toLowerCase().includes(c.version.toLowerCase()) ? `${c.title} [${c.version}]` : c.title;
        const album = c.status === "released" ? "Singles" : "Unreleased";
        return { song: s, path: place(artist, album, title, s.file), kind: "claude", coverUrl: s.details?.hasCover ? null : (s.artist_id && photos.current.get(s.artist_id)) || null,
          tags: { title: c.featuring && featStyle !== "none" && !/\b(feat|ft)\b\.?/i.test(title) ? `${title} (${featStyle} ${c.featuring})` : title, artist, album, albumArtist: artist, track: null, year: null } };
      }
      // Not found anywhere, but it sits in an artist's folder: filed under
      // that artist as "Unreleased" with a tidied title and the artist's
      // photo, instead of being left as it was.
      const named = matchTitle(s.title) || matchTitle(s.file.name.replace(/\.[^.]+$/, "").replace(/_+/g, " "));
      if (s.folder_artist && named && !s.formatted) {
        const artist = s.folder_artist;
        return { song: s, path: place(artist, "Unreleased", named, s.file), kind: "claude", byFolder: true,
          coverUrl: s.details?.hasCover ? null : (s.folder_artist_id && photos.current.get(s.folder_artist_id)) || null,
          tags: { title: named, artist, album: "Unreleased", albumArtist: artist, track: null, year: null } };
      }
      return { song: s, path: unique(`Unsorted/${safeName(s.file.name.replace(/\.[^.]+$/, ""))}${ext(s.file.name)}`), tags: null, coverUrl: null, kind: "unsorted" };
    });
    // Era art: in an "Unreleased <year>" folder, songs with no art of their
    // own share the one cover most of that year's songs have, instead of
    // each getting a different fallback picture.
    const groups = new Map<string, Out[]>();
    for (const o of out) {
      if (o.kind !== "tidied" || !o.tags?.album || !/^Unreleased \d{4}$/.test(o.tags.album)) continue;
      const k = `${o.tags.albumArtist ?? o.tags.artist}|${o.tags.album}`.toLowerCase();
      groups.set(k, [...(groups.get(k) ?? []), o]);
    }
    for (const list of groups.values()) {
      const own = (o: Out) => (o.song.track_id ? site.current.get(o.song.track_id)?.cover_url : null) ?? null;
      const tally = new Map<string, number>();
      for (const o of list) { const c = own(o); if (c) tally.set(c, (tally.get(c) ?? 0) + 1); }
      const era = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!era) continue;
      for (const o of list) if (!own(o) && o.coverUrl) o.coverUrl = era;
    }
    return out;
  }

  // --------------------------------------------------------------- saving

  async function coverBytes(url: string | null, cache: Map<string, NewTags["cover"]>) {
    if (!url) return null;
    if (cache.has(url)) return cache.get(url)!;
    try {
      const res = await fetch(`/api/img?u=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error();
      const raw = await res.blob();
      const c = (await squareJpeg(raw)) ?? { mime: res.headers.get("content-type")?.split(";")[0] || "image/jpeg", data: new Uint8Array(await raw.arrayBuffer()) };
      cache.set(url, c);
      return c;
    } catch { cache.set(url, null); return null; }
  }
  async function blobFor(o: Out, cache: Map<string, NewTags["cover"]>): Promise<Blob> {
    if (!o.tags && o.code && canTag(o.song.file.name)) return withCode(o.song.file, o.code);
    if (!o.tags || !canTag(o.song.file.name)) return o.song.file;
    return tidiedCopy(o.song.file, { ...o.tags, cover: await coverBytes(o.coverUrl, cache) });
  }
  function changesCsv(list: Out[] = plan) {
    const q = (v: string | null | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const what = { tidied: "details from the archive", kept: "already well formatted: kept as it was", claude: "not on the site: tidied by Claude", unsorted: "couldn't be identified: kept as it was", asis: "you chose to keep it as it was" };
    return new Blob([["original file,new file,what happened,title,artist,album",
      ...list.map((o) => [pathOf(o.song.file), o.path, o.byFolder ? "not on the site: named from its artist folder" : what[o.kind], o.tags?.title ?? o.song.title, o.tags?.artist ?? o.song.artist, o.tags?.album ?? o.song.album].map(q).join(","))].join("\n")], { type: "text/csv" });
  }

  // Straight into a folder the person picks (no zip to build or unzip).
  async function saveFolder() {
    if (!premium || plan.length === 0) return;
    const out = await pickFolder();
    if (!out) return; // cancelled
    step("saving", plan.length);
    setFinishing(false);
    const cache = new Map<string, NewTags["cover"]>();
    let failed = 0;
    try {
      let n = 0;
      await pool(plan, 4, async (o) => {
        try { await out.add(`Static-Cuts/${o.path}`, await blobFor(o, cache)); } catch { failed++; }
        setDone(++n);
      });
      await out.add("Static-Cuts/Static-Cuts changes.csv", changesCsv());
      setSaved(`Saved ${plan.length - failed} songs into a "Static-Cuts" folder${failed ? ` (${failed} couldn't be read and were left out)` : ""}. Add that folder in Spotify: Settings → Your Library → Show Local Files → Add a source.`);
    } catch (e) {
      setSaved(`Saving stopped: ${String((e as Error)?.message ?? e)}. Your original files are fine; try again.`);
    }
    setStage("saved");
  }

  // ------------------------------------------------------- desktop app
  // In the Static-Cuts desktop app: new songs in the watched folder are read,
  // matched and tidied like a dropped folder, then written straight into the
  // library folder (no review step; every batch also gets a changes list).
  // Premium only, like saving.
  const [desk, setDesk] = useState(false);
  useEffect(() => { setDesk(inDesktopApp()); }, []);
  const [folders, setFolders] = useState<Folders | null>(null);
  const [deskLog, setDeskLog] = useState<string[]>([]);
  const [deskErr, setDeskErr] = useState<string | null>(null);
  const queue = useRef<string[]>([]);
  const [queued, setQueued] = useState(0);
  const [tick, setTick] = useState(0); // bumped after each batch so the next one starts
  const working = useRef(false);
  const [autostart, setAutostart] = useState(false);
  useEffect(() => {
    if (!desk) return;
    desktop.folders().then(setFolders).catch((e) => setDeskErr(String(e)));
    desktop.autostart().then(setAutostart).catch(() => {});
  }, [desk]);
  useEffect(() => {
    if (!desk) return;
    let off: (() => void) | undefined;
    desktop.onNewFiles((rels) => { queue.current.push(...rels); setQueued(queue.current.length); }).then((f) => { off = f; });
    return () => off?.();
  }, [desk]);
  async function chooseFolder(which: "watch" | "library") {
    try { setFolders(await desktop.choose(which)); setDeskErr(null); } catch (e) { setDeskErr(String(e)); }
  }
  async function tidyExisting() {
    try { const rels = await desktop.list(); queue.current.push(...rels); setQueued(queue.current.length); } catch (e) { setDeskErr(String(e)); }
  }
  async function autoTidy() {
    working.current = true;
    try {
      await tidyBatch();
    } catch (e) {
      // Whatever went wrong, the watcher carries on with the next songs.
      setDeskErr(`A batch stopped: ${String((e as Error)?.message ?? e)}. Your originals are fine; those songs are tried again next time they change, or with "Tidy what's already in the folder".`);
      setStage("idle");
    } finally {
      working.current = false;
      setQueued(queue.current.length);
      setTick((t) => t + 1);
    }
  }
  async function tidyBatch() {
    const rels = [...new Set(queue.current.splice(0, 200))];
    setQueued(queue.current.length);
    const already = doneSet();
    const files: File[] = [];
    const keys: string[] = [];
    for (const rel of rels) {
      try {
        const f = await desktop.file(rel);
        const k = `${rel}|${f.size}`;
        if (already.has(k)) continue;
        dropPaths.set(f, `watched/${rel}`);
        files.push(f);
        keys.push(k);
      } catch { /* moved, deleted or still locked: picked up again if it changes */ }
    }
    const p = files.length ? await run(files) : null;
    if (p) {
      const out = new LibraryWriter();
      const cache = new Map<string, NewTags["cover"]>();
      let failed = 0;
      let n = 0;
      step("saving", p.length);
      await pool(p, 4, async (o) => {
        try { await out.add(`Static-Cuts/${o.path}`, await blobFor(o, cache)); } catch { failed++; }
        setDone(++n);
      });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      try { await out.add(`Static-Cuts/Static-Cuts changes/${stamp}.csv`, changesCsv(p)); } catch { /* the songs are saved either way */ }
      markDone(keys);
      desktop.tidied(p.length - failed, failed);
      const line = `${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}: tidied ${p.length - failed} song${p.length - failed === 1 ? "" : "s"}${failed ? ` (${failed} couldn't be written)` : ""}`;
      setDeskLog((l) => [line, ...l].slice(0, 30));
      setSaved(`${line}. They're in the "Static-Cuts" folder inside your library folder.`);
      setStage("saved");
    }
  }
  useEffect(() => {
    if (desk && queued > 0 && !busy && premium && user && folders?.watch && folders?.library && !working.current) autoTidy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk, queued, tick, busy, premium, user, folders]);

  async function saveZip() {
    if (!premium || plan.length === 0) return;
    const date = new Date().toISOString().slice(0, 10);
    const out = await pickZipFile(`Static-Cuts ${date}.zip`);
    if (out === null) return; // cancelled
    step("saving", plan.length);
    setFinishing(false);
    const cache = new Map<string, NewTags["cover"]>();
    let failed = 0;
    try {
      if (out === "unsupported") {
        // Browsers that can't save straight to disk: built in memory.
        const entries: { path: string; blob: Blob }[] = [];
        for (let i = 0; i < plan.length; i++) {
          try { entries.push({ path: `Static-Cuts/${plan[i].path}`, blob: await blobFor(plan[i], cache) }); } catch { failed++; }
          setDone(i + 1);
        }
        entries.push({ path: "Static-Cuts/Static-Cuts changes.csv", blob: changesCsv() });
        const zip = await makeZip(entries);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(zip); a.download = `Static-Cuts ${date}.zip`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      } else {
        const zip = new ZipToDisk(out);
        for (let i = 0; i < plan.length; i++) {
          try { await zip.add(`Static-Cuts/${plan[i].path}`, await blobFor(plan[i], cache)); } catch { failed++; }
          setDone(i + 1);
        }
        await zip.add("Static-Cuts/Static-Cuts changes.csv", changesCsv());
        setFinishing(true);
        await zip.finish();
      }
      setSaved(`Saved ${plan.length - failed} songs${failed ? ` (${failed} couldn't be read and were left out)` : ""}. Unzip it, then add the "Static-Cuts" folder in Spotify: Settings → Your Library → Show Local Files → Add a source.`);
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

  const ORDER: Stage[] = ["reading", "matching", "claude", "archive"];
  const STEPS: [Stage, string, string, string][] = [
    ["reading", "Read", "Reading files", "Each file's title, artist, album and art, read on your computer."],
    ["matching", "Match", "Matching to the archive", "Finding each file's song on Static-Cuts."],
    ["claude", "Check", "Claude checking the unsure ones", "A closer look at files that didn't match cleanly."],
    ["archive", "Share", "Helping the archive", share ? "What your well-tagged files know, sent for review." : "Switched off: nothing is sent."],
  ];
  const at = ORDER.indexOf(stage);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const preview = plan.filter((o) => (o.kind === "tidied" || o.kind === "claude") && o.tags).slice(0, 6);
  const fileName = (o: Out) => o.song.file.webkitRelativePath?.split("/").pop() || o.song.file.name;
  const newName = (o: Out) => o.path.split("/").pop() ?? o.path;
  const styles: ["Feat." | "feat." | "none", string][] = [
    ["Feat.", "Shoota [Extended] (Feat. Lil Uzi Vert)"],
    ["feat.", "Shoota [Extended] (feat. Lil Uzi Vert)"],
    ["none", "Shoota [Extended]"],
  ];
  const results = (stage === "ready" || stage === "saved") && plan.length > 0;

  return (
    <div className="wrap lc-page">
      <h1 className="detail-name page-title lc-title">Local Cuts</h1>
      <p className="lc-lead">
        {busy ? "Working through your folder." : results ? "Your folder has been read, matched and tidied. Here's how it went."
          : "Drop in your own music folder and get back a tidy copy, ready for Spotify Local Files."}
      </p>
      <div className="lc-promise"><span className="lc-sl" style={{ color: "#22C55E" }}>//</span> Your music is never uploaded. Originals never touched.</div>

      {desk && user && (
        <div className="lc-desk">
          <div className="lc-desk-row">
            <b>New music lands in</b><span>{folders?.watch ?? "not chosen yet"}</span>
            <button className="lc-second" disabled={busy} onClick={() => chooseFolder("watch")}>{folders?.watch ? "Change" : "Choose"}</button>
          </div>
          <div className="lc-desk-row">
            <b>Tidy library goes in</b><span>{folders?.library ?? "not chosen yet"}</span>
            <button className="lc-second" disabled={busy} onClick={() => chooseFolder("library")}>{folders?.library ? "Change" : "Choose"}</button>
          </div>
          <p className="lc-desk-status">
            {!premium ? <>The desktop app&apos;s folder watching is part of premium. <Link className="text-link" href="/premium">Go premium →</Link></>
              : !folders?.watch || !folders?.library ? <>Choose both folders: every new song that lands in the first is tidied into a &ldquo;Static-Cuts&rdquo; folder in the second. Your originals are never touched.</>
              : busy ? <>Tidying new songs…</>
              : queued ? <>{queued} song{queued === 1 ? "" : "s"} waiting…</>
              : <>Watching for new songs. Closing this window keeps it running in the tray.</>}
          </p>
          {premium && folders?.watch && folders?.library && (
            <button className="lc-second" disabled={busy} onClick={tidyExisting}>Tidy what&apos;s already in the folder</button>
          )}
          <label className="lc-share">
            <input type="checkbox" checked={autostart}
              onChange={async (e) => { try { setAutostart(await desktop.setAutostart(e.target.checked)); } catch (err) { setDeskErr(String(err)); } }} />
            <span><b>Start with Windows</b>: open quietly in the tray when your computer starts, so new music is always tidied.</span>
          </label>
          {deskErr && <p className="lc-desk-err">{deskErr}</p>}
          {deskLog.length > 0 && <ul className="lc-desk-log">{deskLog.map((l, i) => <li key={i}>{l}</li>)}</ul>}
        </div>
      )}

      {!loading && !user && (
        <div className="lc-note-box">
          <span className="lc-sl" style={{ color: "#22D3EE" }}>//</span>
          <span><Link href="/login?next=/local" className="text-link">Log in</Link> to use Local Cuts: tidy your folder and add matches to your collection.</span>
        </div>
      )}

      {/* ---------------------------------------------------------------- drop */}
      {(stage === "idle" || stage === "ready" || stage === "saved") && user && !results && (
        <label className={`lc-drop ${hover ? "is-over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setHover(true); }}
          onDragLeave={() => setHover(false)}
          onDrop={async (e) => { e.preventDefault(); setHover(false); run(await filesFromDrop(e.dataTransfer.items)); }}>
          <input type="file" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; run(f); }}
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
          <svg className="lc-folder" viewBox="0 0 64 52" aria-hidden><path d="M3 8a4 4 0 0 1 4-4h16l6 6h28a4 4 0 0 1 4 4v30a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" /></svg>
          <span className="lc-drop-big">Drop your music folder here</span>
          <span className="lc-drop-sub">or click to choose one</span>
        </label>
      )}
      {(stage === "idle" || stage === "ready" || stage === "saved") && user && !results && (
        <label className="lc-share">
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
          <span><b>Help the archive</b>: send what your well-tagged files know that Static-Cuts doesn&apos;t (song details and cover art) as suggestions, checked before anything changes. Your music itself is never sent.</span>
        </label>
      )}
      {note && <div className="lc-note-box warn"><span className="lc-sl" style={{ color: "#F5B841" }}>//</span><span>{note}</span></div>}

      {stage === "idle" && (
        <>
          <h2 className="lc-h">How it works</h2>
          <div className="lc-how">
            {[["Read", "#22C55E", "Reads each file's details (title, artist, album, art) on your computer."],
              ["Match", "#8B7CF6", "Finds each song in the Static-Cuts archive and fills in what's missing."],
              ["Tidy", "#22D3EE", "Fixes titles (with features), artist, album (or “Unreleased 2019” and so on), year, track number and cover art."],
              ["Save", "#F5B841", "Gives you a clean copy in Artist / Album folders, ready for Local Files."]].map(([t, c, d], i) => (
              <div key={t} className="lc-how-card">
                <div className="lc-how-top"><span className="lc-how-n">0{i + 1}</span><b>{t}</b><span className="lc-sl" style={{ color: c }}>//</span></div>
                <p>{d}</p>
              </div>
            ))}
          </div>
          {premium === false && user && (
            <p className="lc-small"><span className="lc-sl" style={{ color: "#F5B841" }}>//</span> Not premium? You can still run a folder, see how it matches and help fill gaps in the archive. Saving the tidy copy is premium. <Link href="/premium" className="text-link">Get premium</Link></p>
          )}
        </>
      )}

      {/* ------------------------------------------------------------- working */}
      {busy && stage !== "saving" && (
        <section className="lc-box lc-work">
          <div className="lc-work-head">
            <h2 className="lc-h in">Processing your folder</h2>
            <span className="lc-count">{done.toLocaleString("en-GB")} <small>of</small> {total.toLocaleString("en-GB")}</span>
          </div>
          <div className="lc-bar"><span style={{ width: `${pct}%` }} /></div>
          <div className="lc-steps">
            {STEPS.map(([k, short, title, blurb], i) => (
              <div key={k} className={`lc-step ${i < at ? "done" : i === at ? "on" : ""}`}>
                <span className="lc-step-mark" aria-hidden>{i < at ? "✓" : i === at ? <span className="lc-spin" /> : String(i + 1).padStart(2, "0")}</span>
                <div>
                  <b>{title}</b>
                  <p>{i === at ? `${label[stage]}… ${pct}%` : blurb}</p>
                </div>
                <span className="lc-step-short">{short}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {stage === "saving" && (
        <section className="lc-box lc-work">
          <div className="lc-work-head">
            <h2 className="lc-h in">Saving your tidy copy</h2>
            <span className="lc-count">{done.toLocaleString("en-GB")} <small>of</small> {total.toLocaleString("en-GB")}</span>
          </div>
          <div className="lc-bar"><span style={{ width: `${pct}%` }} /></div>
          <p className="lc-small">{finishing
            ? "Every song's written. Finishing the zip: your browser is moving it into place, which can take a few minutes for a big library. Keep this tab open."
            : `${gb(size)} in all. Keep this tab open until it finishes.`}</p>
        </section>
      )}

      {/* ------------------------------------------------------------- results */}
      {results && (
        <>
          {stage === "saved" && saved && (
            <section className={`lc-box lc-saved ${saved.startsWith("Saving stopped") ? "bad" : ""}`}>
              <svg className="lc-folder" viewBox="0 0 64 52" aria-hidden><path d="M3 8a4 4 0 0 1 4-4h16l6 6h28a4 4 0 0 1 4 4v30a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" /></svg>
              <h2 className="lc-saved-big">{saved.startsWith("Saving stopped") ? "Saving stopped" : "Tidy copy saved"}</h2>
              <p>{saved}</p>
            </section>
          )}

          <div className="lc-tiles">
            <div className="lc-tile" style={{ "--c": "#22C55E" } as React.CSSProperties}><span>Tidied from the archive</span><b>{count("tidied").toLocaleString("en-GB")}</b></div>
            <div className="lc-tile" style={{ "--c": "#22D3EE" } as React.CSSProperties}><span>Already well formatted</span><b>{count("kept").toLocaleString("en-GB")}</b></div>
            <div className="lc-tile" style={{ "--c": "#8B7CF6" } as React.CSSProperties}><span>Not on the site (tidied)</span><b>{count("claude").toLocaleString("en-GB")}</b></div>
            <div className="lc-tile" style={{ "--c": "#F5B841" } as React.CSSProperties}><span>Couldn&apos;t be identified</span><b>{unsorted.length.toLocaleString("en-GB")}</b></div>
          </div>

          {sent && (sent.details > 0 || sent.songs > 0 || sent.problem) && (
            <p className="lc-small">
              <span className="lc-sl" style={{ color: "#F5B841" }}>//</span> Helped the archive:{" "}
              {sent.details > 0 && <>details for {sent.details} song{sent.details === 1 ? "" : "s"}{sent.covers ? ` (${sent.covers} with cover art)` : ""}</>}
              {sent.details > 0 && sent.songs > 0 && " and "}
              {sent.songs > 0 && <>{sent.songs} song{sent.songs === 1 ? "" : "s"} the site didn&apos;t have</>}
              {(sent.details > 0 || sent.songs > 0) && ", sent for review. Thanks!"}
              {sent.problem && <> (stopped: {sent.problem})</>}
            </p>
          )}
          {claudeNote && <p className="lc-small">{claudeNote}</p>}
          <Missing trackIds={songs.flatMap((s) => (s.track_id ? [s.track_id] : []))} premium={!!premium} />

          <section className="lc-box">
            <div className="lc-box-head"><h2 className="lc-h in">Song name style</h2><span className="lc-small">How features are written in your tidy copy.</span></div>
            <div className="lc-radios" role="radiogroup" aria-label="How song names are written">
              {styles.map(([v, ex]) => (
                <button key={v} role="radio" aria-checked={featStyle === v} className={`lc-radio ${featStyle === v ? "on" : ""}`} onClick={() => setFeatStyle(v)}>
                  <span className="lc-dot" aria-hidden />{ex}
                </button>
              ))}
            </div>
          </section>

          {premium && !folderOk && !canStream && size > 2e9 && (
            <div className="lc-note-box warn"><span className="lc-sl" style={{ color: "#F5B841" }}>//</span>
              <span>This browser builds the whole zip in memory, and {gb(size)} may be too much for it (the tab can crash). For a library this size, use Chrome or Edge, which save straight to disk, or run the folder in smaller parts.</span></div>
          )}
          <div className="lc-actions">
            {premium && folderOk ? (
              <>
                <button className="lc-save" disabled={busy} onClick={saveFolder}>Save tidy copy to a folder ({gb(size)})</button>
                <button className="lc-second" disabled={busy} onClick={saveZip}>Save as a zip instead</button>
              </>
            ) : (
              <button className="lc-save" disabled={!premium || busy} onClick={saveZip}>
                {premium ? `Save tidy copy (${gb(size)})` : "Save tidy copy (premium)"}
              </button>
            )}
            {premium && songs.some((s) => s.track_id) && !collected && (
              <button className="lc-second" onClick={collectAll}>+ Add matched songs to my collection</button>
            )}
            <label className="lc-second">
              <input type="file" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; run(f); }}
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
              Drop another folder
            </label>
          </div>
          {premium === false && (
            <p className="lc-small"><span className="lc-sl" style={{ color: "#F5B841" }}>//</span> Saving the tidy copy is premium.{unsorted.length > 0 ? " With premium, Claude also looks at the files that couldn't be identified." : ""} <Link href="/premium" className="text-link">Get premium</Link></p>
          )}
          {collected && <p className="lc-small">{collected}</p>}

          {preview.length > 0 && (
            <section className="lc-box">
              <div className="lc-box-head"><h2 className="lc-h in">Tidied files</h2><span className="lc-small">A few examples, before and after.</span></div>
              <div className="lc-preview">
                {preview.map((o) => (
                  <div key={o.song.key} className="lc-pv">
                    {o.coverUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={thumb(o.coverUrl)} alt="" loading="lazy" />
                      : <span className="lc-pv-blank">SC//</span>}
                    <div className="lc-pv-text">
                      <span className="lc-pv-k">Before</span>
                      <span className="lc-pv-old">{fileName(o)}</span>
                      <span className="lc-pv-k">→ After</span>
                      <span className="lc-pv-new">{newName(o)}</span>
                    </div>
                  </div>
                ))}
              </div>
              {untaggable > 0 && (
                <p className="lc-small"><span className="lc-sl" style={{ color: "#22D3EE" }}>//</span> {untaggable} file{untaggable === 1 ? " is" : "s are"} in a format whose details can&apos;t be rewritten (AIFF, WebM): renamed and filed, details as they were.</p>
              )}
            </section>
          )}

          {(guesses.length > 0 || undone > 0) && (
            <details className="lc-box lc-fold" open>
              <summary><h2 className="lc-h in">Check Claude&apos;s guesses</h2><span className="lc-small">{guesses.length} file{guesses.length === 1 ? "" : "s"} Claude wasn&apos;t sure about{undone ? ` · ${undone} set back` : ""}</span></summary>
              <p className="lc-small">These get the matched song&apos;s details when you save. If one&apos;s the wrong song, press <b>Not this song</b> and it&apos;s left out of the match.</p>
              <div className="lc-table lc-guess">
                <div className="lc-tr lc-th"><span>File in your folder</span><span /><span>Matched song</span><span>Why</span><span /></div>
                {guesses.map((o) => (
                  <div key={o.song.key} className="lc-tr">
                    <span className="lc-mono">{fileName(o)}</span><span className="lc-arrow">→</span>
                    <span><Link className="text-link" href={`/song/${o.song.track_id}`}>{o.tags?.title}</Link></span>
                    <span className="lc-why">{o.song.why ?? ""}</span>
                    <button className="lc-not" onClick={() => rejectGuess(o.song.key)}>Not this song</button>
                  </div>
                ))}
              </div>
            </details>
          )}
          {unsorted.length > 0 && (
            <details className="lc-box lc-fold">
              <summary><h2 className="lc-h in">Couldn&apos;t be identified</h2><span className="lc-small">{unsorted.length} file{unsorted.length === 1 ? "" : "s"}, kept as they were in &ldquo;Unsorted&rdquo;</span></summary>
              <div className="lc-table one">
                {unsorted.slice(0, 500).map((o) => (
                  <div key={o.song.key} className="lc-tr"><span className="lc-mono">{pathOf(o.song.file)}</span></div>
                ))}
                {unsorted.length > 500 && <div className="lc-tr"><span className="lc-small">…and {unsorted.length - 500} more (all listed in the changes file in the copy).</span></div>}
              </div>
            </details>
          )}

          <details className="lc-box lc-fold">
            <summary><h2 className="lc-h in">Every file</h2><span className="lc-small">{plan.length.toLocaleString("en-GB")} · what each one becomes{asIs.size ? ` · ${asIs.size} kept as they were` : ""}</span></summary>
            <p className="lc-small">Check before you save. <b>Keep as it was</b> copies a file exactly as it is, in its old folders, under &ldquo;Kept as it was&rdquo;.</p>
            <input className="st-input lc-search" placeholder="Find a file or song…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a file" />
            {(() => {
              const term = q.trim().toLowerCase();
              const KIND: Record<Out["kind"], string> = { tidied: "from the archive", kept: "already tidy", claude: "not on the site", unsorted: "couldn't identify", asis: "kept as it was" };
              const rows = (term ? plan.filter((o) => pathOf(o.song.file).toLowerCase().includes(term) || o.path.toLowerCase().includes(term)) : plan);
              return (
                <div className="lc-table lc-all">
                  {rows.slice(0, 200).map((o) => (
                    <div key={o.song.key} className={`lc-tr ${o.kind === "asis" ? "is-asis" : ""}`}>
                      <span className="lc-mono">{fileName(o)}</span><span className="lc-arrow">→</span>
                      <span className="lc-mono">{o.path}</span>
                      <span className="lc-kind">{KIND[o.kind]}{o.song.guess && o.kind !== "asis" ? " (Claude's guess)" : ""}</span>
                      <button className="lc-not" onClick={() => toggleAsIs(o.song.key)}>{o.kind === "asis" ? "Undo" : "Keep as it was"}</button>
                    </div>
                  ))}
                  {rows.length > 200 && <div className="lc-tr"><span className="lc-small">Showing 200 of {rows.length.toLocaleString("en-GB")}. Type above to find others.</span></div>}
                  {rows.length === 0 && <div className="lc-tr"><span className="lc-small">Nothing matches that.</span></div>}
                </div>
              );
            })()}
          </details>
        </>
      )}

      {!busy && (
        <p className="lc-small lc-foot">
          Local Cuts fixes the title (with features), artist, album (or &ldquo;Unreleased 2019&rdquo; and so on), year, track number and cover art,
          and sorts everything into Artist / Album folders. Files that are already well formatted are kept as they are.
        </p>
      )}
    </div>
  );
}
