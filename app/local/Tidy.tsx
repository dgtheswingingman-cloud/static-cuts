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
import { createUnusedExportDirectory, formatFolderSegments, formatTemplate, safeExportSegment, sourceExtension, templateError, uniqueExportPath } from "./formatTemplate";
import { confirmedExportIds, lookupErrorForRequest, missingCanonicalIds, type CanonicalLookupError } from "./canonicalReady";
import { canonicalArtworkMime, MAX_COVER_BYTES } from "./artwork";

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


export default function Tidy({ items, files, onEdit }: {
  items: TidyItem[]; files: Map<string, File>; onEdit: (key: string, edit: TidyItem["edit"]) => void;
}) {
  const [info, setInfo] = useState<Record<string, Info>>({});
  const [metadataError, setMetadataError] = useState<CanonicalLookupError | null>(null);
  const [metadataRetry, setMetadataRetry] = useState(0);
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

  // Confirmed recordings with connected audio must receive their actual
  // archive metadata, not silently fall back to local tags while loading.
  const ids = confirmedExportIds(items, files);
  const idsKey = ids.join("\u0000");
  const requestKey = `${idsKey}\u0001${metadataRetry}`;
  const currentMetadataError = lookupErrorForRequest(metadataError, requestKey);
  const missingCanonical = missingCanonicalIds(ids, info);
  useEffect(() => {
    const want = missingCanonicalIds(ids, info);
    if (want.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const got: Record<string, Info> = {};
        for (let i = 0; i < want.length; i += 200) {
          const batch = want.slice(i, i + 200);
          const { data, error } = await supabase.from("tracks")
            .select("id, title, album, release_date, leak_date, track_number, featured_artists, cover_url, parent_track_id, artists(name)")
            .in("id", batch);
          if (error) throw new Error("Archive lookup failed.");
          type Row = { id: string; title: string; album: string | null; release_date: string | null; leak_date: string | null; track_number: number | null;
            featured_artists: string | null; cover_url: string | null; parent_track_id: string | null; artists: { name: string } | null };
          const rows = (data as Row[] | null) ?? [];
          const returned = new Set(rows.map((r) => r.id));
          if (batch.some((id) => !returned.has(id))) throw new Error("Some confirmed songs are no longer accessible in the archive.");
          if (rows.some((r) => !r.title?.trim() || !r.artists?.name?.trim())) {
            throw new Error("Some confirmed songs are missing their canonical title or artist.");
          }
          const parents = [...new Set(rows.map((r) => r.parent_track_id).filter(Boolean))] as string[];
          const pm = new Map<string, { album: string | null; cover_url: string | null }>();
          if (parents.length) {
            const { data: pd, error: parentError } = await supabase.from("tracks").select("id, album, cover_url").in("id", parents);
            if (parentError) throw new Error("Could not load linked album and artwork details.");
            ((pd as { id: string; album: string | null; cover_url: string | null }[] | null) ?? []).forEach((p) => pm.set(p.id, p));
            if (parents.some((id) => !pm.has(id))) throw new Error("Some linked album or artwork records are unavailable.");
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
        if (!cancelled) { setInfo((prev) => ({ ...prev, ...got })); setMetadataError(null); }
      } catch (error) {
        if (!cancelled) setMetadataError({ requestKey, message: error instanceof Error ? error.message : "Archive lookup failed." });
      }
    })();
    return () => { cancelled = true; };
    // Keep fetches keyed to the set of connected confirmed IDs and explicit retry,
    // not to every edit/rerender or the metadata state being populated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, metadataRetry]);

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
    const fileName = safeExportSegment(safeName(formatTemplate(nameTpl, { ...v, track: v.track ? v.track.padStart(2, "0") : "" })) + sourceExtension(i.name));
    const folder = folderTpl ? formatFolderSegments(folderTpl, v).map((segment) => safeExportSegment(safeName(segment))).join("/") : "";
    const flag = !i.track_id ? "not in the archive: kept the file's own details" : i.status === "check" ? "best guess: check it" : null;
    return { item: i, v, fileName, folder, path: folder ? `${folder}/${fileName}` : fileName, cover: covers ? a?.cover ?? null : null, flag };
  }), [items, files, info, nameTpl, folderTpl, covers]);
  const shown = only === "flagged" ? plan.filter((p) => p.flag) : plan;

  async function coverBytes(url: string | null, cache: Map<string, NewTags["cover"]>) {
    if (!url) return null;
    if (cache.has(url)) return cache.get(url)!;
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error("Artwork download returned an unsuccessful response.");
      const declaredLength = res.headers.get("content-length");
      if (declaredLength && Number(declaredLength) > MAX_COVER_BYTES) {
        throw new Error("Canonical cover artwork exceeds the 10 MB limit.");
      }
      const data = new Uint8Array(await res.arrayBuffer());
      // Content-Type can be missing or wrong; validate actual image bytes.
      const c = { mime: canonicalArtworkMime(data), data };
      cache.set(url, c);
      return c;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Artwork download failed.";
      throw new Error(`Could not use the selected canonical cover artwork: ${reason} Try again, or turn off cover art to export without it.`);
    }
  }

  async function save() {
    setDone(null);
    if (nameError || folderError) { setDone("Fix the formatting template errors before saving."); return; }
    if (missingCanonical.length > 0) { setDone("Wait for confirmed archive metadata, or retry the archive lookup before exporting."); return; }
    const picker = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    let root: FileSystemDirectoryHandle | null = null;
    if (picker) {
      try {
        const selected = await picker({ mode: "readwrite" });
        root = await createUnusedExportDirectory(selected, `Static Cuts ${new Date().toISOString().slice(0, 10)}`);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return; // user cancelled
        setDone("Could not create a fresh export folder. No existing exports were overwritten.");
        return;
      }
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
      const path = uniqueExportPath(p.path, used, sourceExtension(p.item.name));
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
      } catch (error) {
        failed++;
        const reason = error instanceof Error ? error.message : "Unknown export error";
        const q = (value: string) => `"${value.replace(/"/g, '""')}"`;
        log.push([p.item.name, path, "", "", "", "", `FAILED: ${reason}`].map(q).join(","));
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
  const extensionless = plan.filter((p) => !sourceExtension(p.item.name)).length;

  return (
    <div>
      <div className="tidy-options">
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}>
          <label className="comment-meta">File names
          <select className="sort-select" value={nameMode === "custom" ? CUSTOM : nameTpl}
            onChange={(e) => {
              if (e.target.value === CUSTOM) { setNameMode("custom"); setNameTpl(customNameTpl); }
              else { setNameMode("preset"); setNameTpl(e.target.value); }
            }}>
            {NAMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            <option value={CUSTOM}>Custom template…</option>
          </select>
          </label>
          {nameMode === "custom" && (
            <input className="search-input" aria-label="Custom filename template" aria-invalid={!!nameError}
              value={nameTpl} onChange={(e) => { setNameTpl(e.target.value); setCustomNameTpl(e.target.value); }} />
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}>
          <label className="comment-meta">Folders
          <select className="sort-select" value={folderMode === "custom" ? CUSTOM : folderTpl}
            onChange={(e) => {
              if (e.target.value === CUSTOM) { setFolderMode("custom"); setFolderTpl(customFolderTpl); }
              else { setFolderMode("preset"); setFolderTpl(e.target.value); }
            }}>
            {FOLDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            <option value={CUSTOM}>Custom template…</option>
          </select>
          </label>
          {folderMode === "custom" && (
            <input className="search-input" aria-label="Custom folder template" aria-invalid={!!folderError}
              value={folderTpl} onChange={(e) => { setFolderTpl(e.target.value); setCustomFolderTpl(e.target.value); }} />
          )}
        </div>
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
      {missingCanonical.length > 0 && (
        <div className="comment-meta" role="alert" style={{ marginBottom: 8 }}>
          {currentMetadataError
            ? `Cannot export ${missingCanonical.length} confirmed song${missingCanonical.length === 1 ? "" : "s"} with canonical tags: ${currentMetadataError}`
            : `Loading canonical metadata for ${missingCanonical.length} confirmed song${missingCanonical.length === 1 ? "" : "s"} before export.`}
          {currentMetadataError && <button className="text-link inline-btn" onClick={() => setMetadataRetry((n) => n + 1)}>retry archive lookup</button>}
        </div>
      )}
      <div className="comment-meta" style={{ marginBottom: 8 }}>
        {plan.length} file{plan.length === 1 ? "" : "s"} selected.
        {flagged > 0 && <> {flagged} marked to check. </>}
        {notTagged > 0 && <> {notTagged} aren&apos;t MP3 or FLAC: those are renamed and sorted, but their details aren&apos;t rewritten yet.</>}
        {extensionless > 0 && <> {extensionless} file{extensionless === 1 ? "" : "s"} have no extension: Local Cuts won&apos;t pretend they are MP3s, and Spotify may not recognize them.</>}
        {" "}Unreleased songs go in an &ldquo;Unreleased&rdquo; album so Spotify groups them.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <button className={`tab ${only === "all" ? "active" : ""}`} onClick={() => setOnly("all")}>all ({plan.length})</button>
        <button className={`tab ${only === "flagged" ? "active" : ""}`} disabled={flagged === 0} onClick={() => setOnly("flagged")}>to check ({flagged})</button>
        <button className="tab active" disabled={!!progress || plan.length === 0 || !!nameError || !!folderError || missingCanonical.length > 0} onClick={save}>
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
