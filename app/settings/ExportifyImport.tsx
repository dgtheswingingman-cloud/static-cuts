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
      for (const file of Array.from(files)) {
        const rows = parseCsv(await file.text());
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
        if (cTrack < 0) throw new Error(`${file.name} doesn't look like an Exportify file (no "Track URI" column).`);
        if (cArtistUris < 0) noArtistIds = true;
        for (const r of rows.slice(1)) {
          const tid = idOf(r[cTrack], "track");
          if (!tid) continue;
          const url = `https://open.spotify.com/track/${tid}`;
          if (seen.has(url)) continue;
          seen.add(url);
          const uris = cArtistUris >= 0 ? (r[cArtistUris] ?? "").split(",").map((u) => idOf(u.trim(), "artist")).filter((x): x is string => !!x) : [];
          const names = cArtists >= 0 ? (r[cArtists] ?? "").split(",").map((n) => n.trim()).filter(Boolean) : [];
          const artists = uris.map((id, i) => ({ id, name: uris.length === names.length ? names[i] : i === 0 ? names[0] ?? "" : "" }));
          if (artists[0]?.id && artists[0].name) {
            const cur = byArtist.get(artists[0].id) ?? { id: artists[0].id, name: artists[0].name, songs: 0 };
            cur.songs++;
            byArtist.set(artists[0].id, cur);
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
      if (items.length === 0) throw new Error("No songs found in those files.");
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
        (noArtistIds ? " (Those files had no artist links, so only songs already here could be matched: export again with all the columns turned on.)" : ""));
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
        Or upload files from <a href="https://exportify.net" target="_blank" rel="noopener noreferrer" className="text-link">exportify.net</a>:
        it saves your liked songs and playlists as files, and works for anyone (no invite needed). Export the ones you want,
        then pick them all here.
      </div>
      <label className="tab" style={{ display: "inline-block", cursor: busy ? "default" : "pointer" }}>
        {busy ? "importing…" : "upload Exportify files"}
        <input type="file" accept=".csv,text/csv" multiple disabled={busy} style={{ display: "none" }}
          onChange={(e) => { run(e.target.files); e.target.value = ""; }} />
      </label>
      {note && <div className="detail-meta" style={{ marginTop: 10 }}>{note}</div>}
      {error && <div className="empty-state error" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  );
}
