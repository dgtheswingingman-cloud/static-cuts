"use client";

// Import from Exportify files: exportify.net saves your Spotify liked songs and
// playlists as CSV files using its own Spotify app, so it works even when
// Spotify is making our app wait. The songs then go through exactly the same
// import as "import from Spotify" (rpc_import_liked_songs), and artists who
// aren't here yet are suggested (rpc_suggest_library_artists).

import { useState } from "react";
import { supabase } from "@/lib/supabase";

// A small CSV reader: quoted fields, commas and line breaks inside quotes,
// doubled quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

function splitCredits(t: string): { title: string; credits: string[] } {
  const credits: string[] = [];
  let title = t.replace(/\s*[\(\[]\s*(?:feat\.|ft\.|feat\s|ft\s|featuring\s|with\s)\s*([^\)\]]*)[\)\]]/gi, (_m, who) => {
    credits.push(String(who).trim());
    return "";
  });
  title = title.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+(.*)$/i, (_m, who) => {
    credits.push(String(who).trim());
    return "";
  });
  title = title.replace(/\s+-\s+(\d{4}\s+)?(remaster(ed)?( version)?|single version|radio edit|mono|stereo|bonus track)\b.*$/i, "");
  return { title: title.replace(/\s{2,}/g, " ").trim(), credits: credits.filter(Boolean) };
}

const idOf = (uri: string | undefined, kind: string) =>
  uri?.match(new RegExp(`spotify:${kind}:([A-Za-z0-9]{22})`))?.[1] ?? uri?.match(new RegExp(`/${kind}/([A-Za-z0-9]{22})`))?.[1] ?? null;

// Exportify's "Export All" gives a .zip of CSV files. Read the CSVs out of it
// with the browser's own decompression (no extra library).
async function csvsFromZip(file: File): Promise<{ name: string; text: string }[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buf.buffer);
  // Find the central directory (end record is in the last 64 KB).
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error(`${file.name} isn't a zip file we can read.`);
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const out: { name: string; text: string }[] = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.csv$/i.test(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = buf.subarray(start, start + compSize);
    let bytes: Uint8Array;
    if (method === 0) bytes = data;
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else continue;
    out.push({ name, text: new TextDecoder().decode(bytes) });
  }
  return out;
}

export default function ExportifyImport() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true); setError(null); setNote("Reading your files…");
    try {
      const seen = new Set<string>();
      const items: Record<string, unknown>[] = [];
      const byArtist = new Map<string, { id: string; name: string; songs: number }>();
      let noArtistIds = false;
      const texts: { name: string; text: string }[] = [];
      for (const f of Array.from(files)) {
        if (/\.zip$/i.test(f.name) || f.type.includes("zip")) texts.push(...(await csvsFromZip(f)));
        else texts.push({ name: f.name, text: await f.text() });
      }
      for (const file of texts) {
        const rows = parseCsv(file.text);
        if (rows.length < 2) continue;
        const head = rows[0].map((h) => h.trim().toLowerCase());
        const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
        const cTrack = col("track uri", "spotify uri", "uri");
        const cName = col("track name", "name");
        const cAlbum = col("album name", "album");
        const cAlbumUri = col("album uri");
        const cArtists = col("artist name(s)", "artist names", "artist name", "artists");
        const cArtistUris = col("artist uri(s)", "artist uris", "artist uri");
        const cDate = col("release date", "album release date");
        const cNumber = col("track number");
        if (cTrack < 0) continue; // not a song list (e.g. saved albums)
        if (cArtistUris < 0) noArtistIds = true;
        for (const r of rows.slice(1)) {
          const tid = idOf(r[cTrack], "track");
          if (!tid) continue;
          const url = `https://open.spotify.com/track/${tid}`;
          if (seen.has(url)) continue;
          seen.add(url);
          const uris = cArtistUris >= 0 ? (r[cArtistUris] ?? "").split(",").map((u) => idOf(u.trim(), "artist")).filter((x): x is string => !!x) : [];
          const names = cArtists >= 0 ? (r[cArtists] ?? "").split(",").map((n) => n.trim()).filter(Boolean) : [];
          // exportify.net gives artist names only (no Spotify artist IDs):
          // those are matched to artists here by name.
          const artists: { id?: string; name: string }[] = uris.length > 0
            ? uris.map((id, i) => ({ id, name: uris.length === names.length ? names[i] : i === 0 ? names[0] ?? "" : "" }))
            : names.map((name) => ({ name }));
          const main = artists[0];
          if (main?.name) {
            const key = main.id ?? `name:${main.name.toLowerCase()}`;
            const cur = byArtist.get(key) ?? { id: key, name: main.name, songs: 0 };
            cur.songs++;
            byArtist.set(key, cur);
          }
          const trackName = cName >= 0 ? r[cName] ?? "" : "";
          const albumName = cAlbum >= 0 ? r[cAlbum] ?? "" : "";
          const date = cDate >= 0 ? (r[cDate] ?? "").trim() : "";
          const named = splitCredits(trackName);
          items.push({
            spotify_url: url,
            album_id: idOf(cAlbumUri >= 0 ? r[cAlbumUri] : undefined, "album"),
            album_type: albumName && albumName.toLowerCase() === trackName.toLowerCase() ? "single" : "album",
            artist_ids: uris,
            artist_names: names,
            title: named.title,
            credits: named.credits,
            album_name: albumName || null,
            total_tracks: null,
            release_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
            release_precision: /^\d{4}-\d{2}-\d{2}$/.test(date) ? "day" : null,
            track_number: cNumber >= 0 ? Number(r[cNumber]) || null : null,
            artists: artists.filter((a) => a.name),
          });
        }
      }
      if (items.length === 0) throw new Error("No songs found in those files. They need Exportify's \"Track URI\" column.");
      const totals = { collected: 0, added: 0, waiting: 0 };
      for (let i = 0; i < items.length; i += 500) {
        setNote(`Importing… ${Math.min(i + 500, items.length).toLocaleString("en-GB")} of ${items.length.toLocaleString("en-GB")} songs`);
        const { data, error: err } = await supabase.rpc("rpc_import_liked_songs", { p_items: items.slice(i, i + 500) });
        if (err) throw new Error(err.message);
        totals.collected += data?.collected ?? 0;
        totals.added += data?.added ?? 0;
        totals.waiting += data?.waiting ?? 0;
      }
      const { data: suggested } = await supabase.rpc("rpc_suggest_library_artists", { p_artists: [...byArtist.values()] });
      setNote(
        `Done: ${items.length.toLocaleString("en-GB")} songs checked. ${totals.collected.toLocaleString("en-GB")} newly collected` +
        (totals.added ? `, ${totals.added.toLocaleString("en-GB")} added to the archive` : "") +
        (totals.waiting ? `, ${totals.waiting.toLocaleString("en-GB")} more will be added once we've read their releases` : "") +
        (typeof suggested === "number" && suggested > 0 ? `. ${suggested} artists suggested as new artists` : "") + "." +
        (noArtistIds ? " (These files only have artist names, so songs were matched to artists here by name.)" : ""));
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setNote(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, marginBottom: 16 }}>
      <div className="comment-meta" style={{ marginBottom: 8 }}>
        Spotify busy, or not on the invite list? Upload files from <a href="https://exportify.net" target="_blank" rel="noopener noreferrer" className="text-link">exportify.net</a>:
        it saves your liked songs and playlists as files, and works for anyone (no invite needed). Export the ones you want,
        then pick the files (or the whole .zip from &ldquo;Export All&rdquo;) here.
      </div>
      <label className="tab" style={{ display: "inline-block", cursor: busy ? "default" : "pointer" }}>
        {busy ? "importing…" : "upload Exportify files or .zip"}
        <input type="file" accept=".csv,text/csv,.zip,application/zip" multiple disabled={busy} style={{ display: "none" }}
          onChange={(e) => { run(e.target.files); e.target.value = ""; }} />
      </label>
      {note && <div className="detail-meta" style={{ marginTop: 10 }}>{note}</div>}
      {error && <div className="empty-state error" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  );
}
