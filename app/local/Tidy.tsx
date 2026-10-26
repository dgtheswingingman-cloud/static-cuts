"use client";

// Local Cuts: tidy and save. For every file: what it'll be called, where it
// goes and the details written into it, filled from the archive (title with
// features, artist, album or "Unreleased", year, track number, cover art).
// Best guesses and files not in the archive are marked. Edit anything, then
// save tidied copies into a folder you choose (Chrome / Edge on a computer)
// or as a zip. Originals are never touched.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { canTag, makeZip, safeName, tidiedCopy, type NewTags } from "./write";
import { formatTemplate, templateError } from "./formatTemplate";

export type TidyItem = {
  key: string; name: string; title: string | null; artist: string | null; album: string | null;
  track_id: string | null; status: "sure" | "check" | "none"; reason: string;
  edit?: { title?: string; artist?: string; album?: string; year?: string };
};
type Info = { title: string; artist: string; album: string | null; year: string | null; track: string | null; feat: string | null; cover: string | null };

const NAMES: [string, string][] = [["{artist} - {title}", "Artist - Title"], ["{title}", "Title"], ["{track} {title}", "01 Title"]];
const FOLDERS: [string, string][] = [["{artist}/{album}", "Artist / Album"], ["{artist}", "Artist"], ["", "all in one folder"]];
const PREFS = "static_cuts_tidy_prefs";
const CUSTOM = "__custom__";

function ext(name: string) { return (name.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? ".mp3").toLowerCase(); }

export default function Tidy({ items, files, onEdit }: {
  items: TidyItem[]; files: Map<string, File>; onEdit: (key: string, edit: TidyItem["edit"]) => void;
}) {
  const [info, setInfo] = useState<Record<string, Info>>({});
  const [nameTpl, setNameTpl] = useState(NAMES[0][0]);
  const [folderTpl, setFolderTpl] = useState(FOLDERS[0][0]);
  const [customNameTpl, setCustomNameTpl] = useState("{artist} - {title} ({year})");
  const [customFolderTpl, setCustomFolderTpl] = useState("{artist}/{album} - {year}");
  const [nameMode, setNameMode] = useState<"preset" | "custom">("preset");
  const [folderMode, setFolderMode] = useState<"preset" | "custom">("preset");
  const [prefsReady, setPrefsReady] = useState(false);
  const [covers, setCovers] = useState(true);
  const [only, setOnly] = useState<"all" | "flagged">("all");
  const [progress, setProgress] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) ?? "{}");
      if (typeof p.n === "string") setNameTpl(p.n);
      if (typeof p.f === "string") setFolderTpl(p.f);
      if (typeof p.cn === "string") setCustomNameTpl(p.cn);
      else if (typeof p.n === "string" && !NAMES.some(([v]) => v === p.n)) setCustomNameTpl(p.n);
      if (typeof p.cf === "string") setCustomFolderTpl(p.cf);
      else if (typeof p.f === "string" && !FOLDERS.some(([v]) => v === p.f)) setCustomFolderTpl(p.f);
      setNameMode(p.nm === "custom" || (typeof p.n === "string" && !NAMES.some(([v]) => v === p.n)) ? "custom" : "preset");
      setFolderMode(p.fm === "custom" || (typeof p.f === "string" && !FOLDERS.some(([v]) => v === p.f)) ? "custom" : "preset");
      if (typeof p.c === "boolean") setCovers(p.c);
    } catch { /* Invalid saved preferences fall back to canonical defaults. */ }
    setPrefsReady(true);
  }, []);
  useEffect(() => {
    if (!prefsReady) return;
    try {
      localStorage.setItem(PREFS, JSON.stringify({
        n: nameTpl, f: folderTpl, c: covers, nm: nameMode, fm: folderMode,
        cn: customNameTpl, cf: customFolderTpl,
      }));
    } catch { /* Browser storage may be unavailable. */ }
  }, [prefsReady, nameTpl, folderTpl, covers, nameMode, folderMode, customNameTpl, customFolderTpl]);
  const nameError = templateError(nameTpl);
  const folderError = templateError(folderTpl, true);

  // The archive's details for every matched song (and its main song, for album and art).
  const ids = useMemo(() => [...new Set(items.filter((i) => i.track_id && i.status === "sure").map((i) => i.track_id!))], [items]);
  useEffect(() => {
    const want = ids.filter((id) => !info[id]);
    if (want.length === 0) return;
    (async () => {
      const got: Record<string, Info> = {};
      for (let i = 0; i < want.length; i += 200) {
        const { data } = await supabase.from("tracks")
          .select("id, title, album, release_date, leak_date, track_number, featured_artists, cover_url, parent_track_id, artists(name)")
          .in("id", want.slice(i, i + 200));
        type Row = { id: string; title: string; album: string | null; release_date: string | null; leak_date: string | null; track_number: number | null;
          featured_artists: string | null; cover_url: string | null; parent_track_id: string | null; artists: { name: string } | null };
        const rows = (data as Row[] | null) ?? [];
        const parents = [...new Set(rows.map((r) => r.parent_track_id).filter(Boolean))] as string[];
        const pm = new Map<string, { album: string | null; cover_url: string | null }>();
        if (parents.length) {
          const { data: pd } = await supabase.from("tracks").select("id, album, cover_url").in("id", parents);
          ((pd as { id: string; album: string | null; cover_url: string | null }[] | null) ?? []).forEach((p) => pm.set(p.id, p));
        }
        rows.forEach((r) => {
          const parent = r.parent_track_id ? pm.get(r.parent_track_id) : null;
          got[r.id] = {
            title: r.title, artist: r.artists?.name ?? "", album: r.album ?? parent?.album ?? null,
            year: (r.release_date ?? r.leak_date)?.slice(0, 4) ?? null, track: r.track_number ? String(r.track_number) : null,
            feat: r.featured_artists, cover: r.cover_url ?? parent?.cover_url ?? null,
          };
        });
      }
      setInfo((prev) => ({ ...prev, ...got }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  // What each file becomes.
  const plan = useMemo(() => items.filter((i) => files.has(i.key)).map((i) => {
    // Only explicitly confirmed recordings may receive catalogue metadata.
    const a = i.track_id && i.status === "sure" ? info[i.track_id] : null;
    const featIn = a?.feat && !/\b(feat|ft)\b/i.test(a.title) ? ` (feat. ${a.feat})` : "";
    const base = {
      title: a ? a.title + featIn : (i.title ?? i.name.replace(/\.[^.]+$/, "")),
      artist: a?.artist || i.artist || "Unknown Artist",
      album: a ? (a.album || "Unreleased") : (i.album || "Unknown"),
      year: a?.year ?? "",
      track: a?.track ?? "",
    };
    const v = { ...base, ...Object.fromEntries(Object.entries(i.edit ?? {}).filter(([, x]) => x !== undefined)) } as typeof base;
    const fileName = safeName(formatTemplate(nameTpl, { ...v, track: v.track ? v.track.padStart(2, "0") : "" })) + ext(i.name);
    const folder = folderTpl ? formatTemplate(folderTpl, v).split("/").map(safeName).join("/") : "";
    const flag = !i.track_id ? "not in the archive: kept the file's own details" : i.status === "check" ? "best guess: check it" : null;
    return { item: i, v, fileName, folder, path: folder ? `${folder}/${fileName}` : fileName, cover: covers ? a?.cover ?? null : null, flag };
  }), [items, files, info, nameTpl, folderTpl, covers]);
  const shown = only === "flagged" ? plan.filter((p) => p.flag) : plan;

  async function coverBytes(url: string | null, cache: Map<string, NewTags["cover"]>) {
    if (!url) return null;
    if (cache.has(url)) return cache.get(url)!;
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error();
      const data = new Uint8Array(await res.arrayBuffer());
      const c = { mime: res.headers.get("content-type")?.split(";")[0] || "image/jpeg", data };
      cache.set(url, c);
      return c;
    } catch { cache.set(url, null); return null; }
  }

  async function save() {
    setDone(null);
    if (nameError || folderError) { setDone("Fix the formatting template errors before saving."); return; }
    const picker = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    let root: FileSystemDirectoryHandle | null = null;
    if (picker) {
      try { root = await picker({ mode: "readwrite" }); } catch { return; } // cancelled
      root = await root.getDirectoryHandle(`Static Cuts ${new Date().toISOString().slice(0, 10)}`, { create: true });
    }
    const cache = new Map<string, NewTags["cover"]>();
    const used = new Set<string>();
    const zipEntries: { path: string; blob: Blob }[] = [];
    const log: string[] = ["original file,new file,title,artist,album,year,match"];
    let failed = 0;
    for (let n = 0; n < plan.length; n++) {
      const p = plan[n];
      setProgress(`Tidying ${n + 1} of ${plan.length}…`);
      const f = files.get(p.item.key)!;
      let path = p.path;
      for (let k = 2; used.has(path.toLowerCase()); k++) path = p.path.replace(/(\.[^.]+)$/, ` (${k})$1`);
      used.add(path.toLowerCase());
      try {
        const blob = await tidiedCopy(f, {
          title: p.v.title, artist: p.v.artist, album: p.v.album, albumArtist: p.v.artist, track: p.v.track || null, year: p.v.year || null,
          cover: canTag(f.name) ? await coverBytes(p.cover, cache) : null,
        });
        if (root) {
          let dir = root;
          const bits = path.split("/");
          for (const d of bits.slice(0, -1)) dir = await dir.getDirectoryHandle(d, { create: true });
          const fh = await dir.getFileHandle(bits[bits.length - 1], { create: true });
          const w = await (fh as unknown as { createWritable: () => Promise<WritableStream & { write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }).createWritable();
          await w.write(blob);
          await w.close();
        } else {
          zipEntries.push({ path: `Static Cuts/${path}`, blob });
        }
        const q = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
        log.push([p.item.name, path, p.v.title, p.v.artist, p.v.album, p.v.year, p.flag ?? "matched"].map(q).join(","));
      } catch {
        failed++;
        log.push(`"${p.item.name}","FAILED","","","","",""`);
      }
    }
    const csv = new Blob([log.join("\n")], { type: "text/csv" });
    if (root) {
      const fh = await root.getFileHandle("Static Cuts changes.csv", { create: true });
      const w = await (fh as unknown as { createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }).createWritable();
      await w.write(csv); await w.close();
      setDone(`Saved ${plan.length - failed} tidied copies into the "${root.name}" folder${failed ? ` (${failed} couldn't be done)` : ""}, with a list of every change. Your originals weren't touched.`);
    } else {
      zipEntries.push({ path: "Static Cuts/Static Cuts changes.csv", blob: csv });
      try {
        const zip = await makeZip(zipEntries, (i) => setProgress(`Packing ${i} of ${zipEntries.length}…`));
        const a = document.createElement("a");
        a.href = URL.createObjectURL(zip);
        a.download = `static-cuts-${new Date().toISOString().slice(0, 10)}.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
        setDone(`Downloaded ${plan.length - failed} tidied copies as a zip${failed ? ` (${failed} couldn't be done)` : ""}. Unzip it and move the folder where you keep your music.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown ZIP error";
        setDone(`Couldn't create the ZIP: ${message} Your originals are unchanged. Try a smaller batch or save to a folder in a supported browser.`);
      }
    }
    setProgress(null);
  }

  const flagged = plan.filter((p) => p.flag).length;
  const notTagged = plan.filter((p) => !canTag(p.item.name)).length;

  return (
    <div>
      <div className="tidy-options">
        <label className="comment-meta">File names
          <select className="sort-select" value={nameMode === "custom" ? CUSTOM : nameTpl}
            onChange={(e) => {
              if (e.target.value === CUSTOM) { setNameMode("custom"); setNameTpl(customNameTpl); }
              else { setNameMode("preset"); setNameTpl(e.target.value); }
            }}>
            {NAMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            <option value={CUSTOM}>Custom template…</option>
          </select>
          {nameMode === "custom" && (
            <input className="search-input" aria-label="Custom filename template" aria-invalid={!!nameError}
              value={nameTpl} onChange={(e) => { setNameTpl(e.target.value); setCustomNameTpl(e.target.value); }} />
          )}
        </label>
        <label className="comment-meta">Folders
          <select className="sort-select" value={folderMode === "custom" ? CUSTOM : folderTpl}
            onChange={(e) => {
              if (e.target.value === CUSTOM) { setFolderMode("custom"); setFolderTpl(customFolderTpl); }
              else { setFolderMode("preset"); setFolderTpl(e.target.value); }
            }}>
            {FOLDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            <option value={CUSTOM}>Custom template…</option>
          </select>
          {folderMode === "custom" && (
            <input className="search-input" aria-label="Custom folder template" aria-invalid={!!folderError}
              value={folderTpl} onChange={(e) => { setFolderTpl(e.target.value); setCustomFolderTpl(e.target.value); }} />
          )}
        </label>
        <label className="comment-meta"><input type="checkbox" checked={covers} onChange={(e) => setCovers(e.target.checked)} /> add cover art</label>
      </div>
      {(nameMode === "custom" || folderMode === "custom") && (
        <div className="comment-meta" style={{ marginBottom: 8 }}>
          Templates use {"{artist}"}, {"{title}"}, {"{album}"}, {"{year}"} and {"{track}"}.
          Separate folder levels with /. Your layout is saved on this browser; canonical song tags are unchanged.
        </div>
      )}
      {(nameError || folderError) && (
        <div className="comment-meta" role="alert" style={{ marginBottom: 8 }}>
          {nameError && <>File names: {nameError} </>}
          {folderError && <>Folders: {folderError}</>}
        </div>
      )}
      <div className="comment-meta" style={{ marginBottom: 8 }}>
        {plan.length} file{plan.length === 1 ? "" : "s"} ready.
        {flagged > 0 && <> {flagged} marked to check. </>}
        {notTagged > 0 && <> {notTagged} aren&apos;t MP3 or FLAC: those are renamed and sorted, but their details aren&apos;t rewritten yet.</>}
        {" "}Unreleased songs go in an &ldquo;Unreleased&rdquo; album so Spotify groups them.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <button className={`tab ${only === "all" ? "active" : ""}`} onClick={() => setOnly("all")}>all ({plan.length})</button>
        <button className={`tab ${only === "flagged" ? "active" : ""}`} disabled={flagged === 0} onClick={() => setOnly("flagged")}>to check ({flagged})</button>
        <button className="tab active" disabled={!!progress || plan.length === 0 || !!nameError || !!folderError} onClick={save}>
          {progress ?? "save tidied copies"}
        </button>
      </div>
      {done && <div className="comments-panel" style={{ marginBottom: 10 }}>{done}</div>}

      {shown.map((p) => (
        <div key={p.item.key} className={`tidy-row ${p.flag ? "is-flagged" : ""}`}>
          <div className="comment-meta tidy-before" title="Now">{p.item.name}</div>
          <div className="tidy-after">→ {p.path}</div>
          {p.flag && <div className="comment-meta tidy-flag">{p.flag}</div>}
          <div className="tidy-fields">
            {(["title", "artist", "album", "year"] as const).map((f) => (
              <label key={f} className="tidy-field">
                <span className="comment-meta">{f}</span>
                <input className="search-input" value={p.v[f] ?? ""}
                  onChange={(e) => onEdit(p.item.key, { ...(p.item.edit ?? {}), [f]: e.target.value })} />
              </label>
            ))}
            {p.item.edit && Object.keys(p.item.edit).length > 0 && (
              <button className="text-link inline-btn" onClick={() => onEdit(p.item.key, undefined)}>reset</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
