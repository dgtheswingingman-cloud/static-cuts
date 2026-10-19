// Supabase Edge Function: sheet-import
//
// Reads community trackers from Google Sheets and turns their rows into
// songs for the imported songs review list (see
// 20261019090000_sheet_import.sql).
//
// Actions (POST JSON, signed in as the admin or a moderator):
//   preview  {url}                  -> sheet title, tabs, header row, sample
//                                      rows, a suggested column mapping and
//                                      the values found in the status columns
//   parse    {url, mapping}         -> every song the mapping reads, with
//                                      counts, nothing saved
//   import   {url, mapping, title, credit, artist_id, tab_name, auto_sync,
//             permission_confirmed} -> saves the sheet as a source and
//                                      suggests its songs
//   sync     {source_id}            -> re-reads a saved sheet for new songs
// Timer (x-cron-secret header, hourly): {action: "sync"} re-reads the next
// due sheet (weekly, less often when quiet; see sc_sheet_sync_due).
//
// Sheets must be shared as "anyone with the link can view".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Supabase's own servers occasionally disagree about the time for a moment
// ("JWT issued at future"). Wait a moment and try again rather than failing.
async function steadyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(input, init);
    if (i >= 2 || (res.status !== 401 && res.status !== 403)) return res;
    const text = await res.clone().text();
    if (!text.includes("issued at future")) return res;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { global: { fetch: steadyFetch } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ---------------------------------------------------------------------------
// Fetching the sheet
// ---------------------------------------------------------------------------

function parseSheetUrl(url: string) {
  const id = url.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)?.[1];
  const gid = url.match(/[#?&]gid=(\d+)/)?.[1] ?? "0";
  if (!id) throw new Error("That isn't a Google Sheets link.");
  return { id, gid };
}

async function fetchCsv(id: string, gid: string) {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, { redirect: "follow" });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("text/html")) {
    throw new Error("Couldn't read the sheet. Make sure it's shared as \"anyone with the link can view\".");
  }
  return await res.text();
}

// Sheet title and tab names (best effort: read from the public page).
async function fetchTabs(id: string) {
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/htmlview`);
    if (!res.ok) return { title: null, tabs: [] as { gid: string; name: string }[] };
    const html = await res.text();
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/\s*-\s*Google (Sheets|Drive)\s*$/, "").trim() ?? null;
    const tabs: { gid: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const m of html.matchAll(/id="sheet-button-(\d+)"[^>]*>(?:<a[^>]*>)?([^<]+)</g)) {
      if (!seen.has(m[1])) { seen.add(m[1]); tabs.push({ gid: m[1], name: decode(m[2]) }); }
    }
    if (tabs.length === 0) {
      for (const m of html.matchAll(/\{name:\s*"([^"]+)",[^}]*?gid:\s*"?(\d+)"?/g)) {
        if (!seen.has(m[2])) { seen.add(m[2]); tabs.push({ gid: m[2], name: decode(m[1]) }); }
      }
    }
    return { title: title ? decode(title) : null, tabs };
  } catch {
    return { title: null, tabs: [] };
  }
}

function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).trim();
}

// RFC 4180 CSV (quoted fields, commas and line breaks inside quotes).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------------------------------------------------------------------------
// Working out the columns
// ---------------------------------------------------------------------------

type Field = "title" | "artist" | "era" | "notes" | "length" | "file_date" | "leak_date" | "release_date" |
  "type" | "availability" | "quality" | "links" | "producers" | "features";

const SYNONYMS: Record<Field, RegExp> = {
  title: /^(name|title|song|song name|track|track name|song title)$/i,
  artist: /^(artist|artists|main artist)$/i,
  era: /^(era|album|project|era\s*\/\s*album)$/i,
  notes: /^(notes?|info|description|details|comments?)$/i,
  length: /^(track length|length|duration|time)$/i,
  file_date: /^(file date|recorded|recording date|date recorded|made)$/i,
  leak_date: /^(leak date|leaked|date leaked|leaked on|og file leak date)$/i,
  release_date: /^(release date|released|date released|date)$/i,
  type: /^(type|kind|category)$/i,
  availability: /^(available length|availability|available|portion|status|leak status)$/i,
  quality: /^(quality|audio quality)$/i,
  links: /^(links?|links?\s*\(s\)|link\(s\)|url|urls|source)$/i,
  producers: /^(producers?|prod\.?|produced by|production)$/i,
  features: /^(features?|feat\.?|featuring|ft\.?)$/i,
};

type Mapping = {
  header_row: number;
  columns: Partial<Record<Field, number>>;
  default_status: string;
  status_column: "availability" | "type" | null;
  status_values: Record<string, string>;
  links: "official" | "all" | "none";
  skip_eras: string[];
};

const STATUSES = ["unconfirmed", "rumored", "teased", "snippet", "leaked", "announced", "released"];

function findHeaderRow(rows: string[][]) {
  let best = 0, bestScore = -1;
  rows.slice(0, 15).forEach((r, i) => {
    const score = r.filter((c) => Object.values(SYNONYMS).some((re) => re.test(c.trim()))).length;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}

function guessColumns(header: string[]) {
  const columns: Partial<Record<Field, number>> = {};
  header.forEach((h, i) => {
    const name = h.trim().split("\n")[0].trim();
    for (const [field, re] of Object.entries(SYNONYMS) as [Field, RegExp][]) {
      if (columns[field] === undefined && re.test(name)) { columns[field] = i; break; }
    }
  });
  return columns;
}

function guessStatus(value: string, fallback: string) {
  const v = value.toLowerCase();
  if (!v) return fallback;
  if (/snippet|preview|clip/.test(v)) return "snippet";
  if (/full|og file|tagged|partial|leak|cdq|lossless|stem/.test(v)) return "leaked";
  if (/released|official|streaming|out now/.test(v)) return "released";
  if (/announced|confirmed/.test(v)) return "announced";
  if (/teas/.test(v)) return "teased";
  if (/rumou?r|unheard|not available|unavailable|n\/a|unsurfaced|lost/.test(v)) return "rumored";
  return fallback;
}

function suggestMapping(rows: string[][]): Mapping {
  const header_row = findHeaderRow(rows);
  const columns = guessColumns(rows[header_row] ?? []);
  const status_column = columns.availability !== undefined ? "availability" : columns.type !== undefined ? "type" : null;
  return { header_row, columns, default_status: "leaked", status_column, status_values: {}, links: "official", skip_eras: [] };
}

// ---------------------------------------------------------------------------
// Reading songs
// ---------------------------------------------------------------------------

const OFFICIAL = /(^|\.)(open\.spotify\.com|music\.apple\.com|youtube\.com|youtu\.be|soundcloud\.com|bandcamp\.com|tidal\.com|deezer\.com|audiomack\.com)$/i;

function cleanTitle(raw: string) {
  // Trackers often start rows with emoji or markers (⭐ 🏆 ✨ !!).
  return raw.split("\n")[0].replace(/^[^\p{L}\p{N}(\[]+/u, "").replace(/\s+/g, " ").trim();
}

function splitNames(s: string) {
  return s.split(/\s*(?:,|&|\band\b|\bx\b|\+|\/)\s*/i).map((x) => x.trim()).filter(Boolean);
}

// "Artist - Title (feat. X) (prod. Y) [v2]" -> parts.
function parseName(raw: string) {
  let title = cleanTitle(raw);
  let artists: string[] = [];
  const dash = title.match(/^(.{1,60}?)\s+[-–—]\s+(.+)$/);
  if (dash && !/[()[\]]/.test(dash[1])) { artists = splitNames(dash[1]); title = dash[2]; }
  const producers: string[] = [];
  const featuring: string[] = [];
  title = title.replace(/[([]\s*prod(?:uced)?\.?\s*(?:by\s+)?([^)\]]+)[)\]]/gi, (_, p) => { producers.push(...splitNames(p)); return ""; });
  title = title.replace(/[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)\]]+)[)\]]/gi, (_, f) => { featuring.push(...splitNames(f)); return ""; });
  title = title.replace(/\s+(?:feat\.?|ft\.?)\s+(.+)$/i, (_, f) => { featuring.push(...splitNames(f)); return ""; });
  title = title.replace(/\s+/g, " ").replace(/\s+([)\]])/g, "$1").trim();
  return { title, artists, producers, featuring };
}

function parseDate(s: string): string | null {
  const v = s.trim();
  if (!v || /^(n\/a|unknown|\?+|tba|tbd|-)$/i.test(v)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v.replace(/(\d)(st|nd|rd|th)\b/, "$1"));
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  if (y < 1950 || y > 2100) return null;
  return `${y}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Song = {
  title: string; artists: string[]; status: string; album: string | null; release_date: string | null;
  featuring: string | null; producers: string | null; notes: string | null; listen_url: string | null; leak_date: string | null;
  row: number;
};

function readSongs(rows: string[][], m: Mapping) {
  const col = (r: string[], f: Field) => (m.columns[f] !== undefined ? (r[m.columns[f]!] ?? "").trim() : "");
  const songs: Song[] = [];
  const eras: Record<string, number> = {};
  let era: string | null = null;
  let skipped = 0;

  for (let i = m.header_row + 1; i < rows.length; i++) {
    const r = rows[i];
    const filled = r.filter((c) => c.trim() !== "").length;
    if (filled === 0) continue;
    const titleCell = col(r, "title");
    // Era banners: a row with one or two cells filled and no song name (or
    // only the era column filled).
    if ((!titleCell && filled <= 2) || (m.columns.era !== undefined && filled === 1 && col(r, "era"))) {
      const text = (r.find((c) => c.trim() !== "") ?? "").split("\n")[0].trim();
      era = text.replace(/\s+era\b.*$/i, "").replace(/\s*\((soundcloud|youtube|spotify)\)\s*$/i, "").trim() || null;
      continue;
    }
    if (!titleCell) { skipped++; continue; }
    const thisEra = col(r, "era") ? col(r, "era").split("\n")[0].replace(/\s+era\b.*$/i, "").trim() : era;
    if (thisEra && m.skip_eras.includes(thisEra)) { skipped++; continue; }

    const p = parseName(titleCell);
    if (!p.title) { skipped++; continue; }
    if (col(r, "artist")) p.artists = splitNames(col(r, "artist"));
    if (col(r, "producers")) p.producers.push(...splitNames(col(r, "producers")));
    if (col(r, "features")) p.featuring.push(...splitNames(col(r, "features")));

    const statusRaw = m.status_column ? col(r, m.status_column) : "";
    const mapped = m.status_values[statusRaw];
    const status = STATUSES.includes(mapped) ? mapped : guessStatus(statusRaw, m.default_status);

    const leak = parseDate(col(r, "leak_date"));
    const released = parseDate(col(r, "release_date"));
    const notes = [
      col(r, "notes"),
      leak ? `Leaked ${col(r, "leak_date")}.` : "",
      col(r, "file_date") && parseDate(col(r, "file_date")) ? `File date ${col(r, "file_date")}.` : "",
      col(r, "type") ? `Type: ${col(r, "type")}.` : "",
      col(r, "availability") ? `Available: ${col(r, "availability")}.` : "",
      col(r, "quality") ? `Quality: ${col(r, "quality")}.` : "",
      col(r, "length") ? `Length ${col(r, "length")}.` : "",
    ].filter(Boolean).join("\n");

    let listen: string | null = null;
    if (m.links !== "none") {
      const urls = col(r, "links").match(/https?:\/\/[^\s,]+/g) ?? [];
      listen = urls.find((u) => {
        try { return m.links === "all" || OFFICIAL.test(new URL(u).hostname); } catch { return false; }
      }) ?? null;
    }

    if (thisEra) eras[thisEra] = (eras[thisEra] ?? 0) + 1;
    songs.push({
      title: p.title,
      artists: p.artists,
      status,
      album: thisEra,
      release_date: status === "released" ? released : null,
      featuring: p.featuring.length ? [...new Set(p.featuring)].join(", ") : null,
      producers: p.producers.length ? [...new Set(p.producers)].join(", ") : null,
      notes: notes || null,
      listen_url: listen,
      leak_date: leak,
      row: i + 1,
    });
  }
  return { songs, eras, skipped };
}

// ---------------------------------------------------------------------------

async function importSource(sourceId: string, userId: string) {
  const { data: src, error } = await db.from("sheet_sources").select("*").eq("id", sourceId).single();
  if (error || !src) throw new Error("Unknown sheet.");
  const { id, gid } = parseSheetUrl(src.url);
  const rows = parseCsv(await fetchCsv(id, gid));
  const { songs } = readSongs(rows, src.mapping as Mapping);
  const { data, error: err } = await db.rpc("sc_sheet_import", { p_user: userId, p_source: sourceId, p_items: songs });
  if (err) throw new Error(err.message);
  return { read: songs.length, ...data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const action = String(body?.action ?? "");

  try {
    // Timer: re-read the sheet that's due.
    const cronSecret = req.headers.get("x-cron-secret");
    if (cronSecret) {
      const { data: due, error } = await db.rpc("sc_sheet_sync_due", { p_secret: cronSecret });
      if (error) return json({ error: error.message }, 403);
      const results: unknown[] = [];
      for (const sid of (due?.sources ?? []) as string[]) {
        try { results.push({ source: sid, ...(await importSource(sid, due.user_id)) }); }
        catch (e: any) {
          await db.from("sheet_sources").update({ last_synced_at: new Date().toISOString(), last_result: { error: String(e?.message ?? e) } }).eq("id", sid);
          results.push({ source: sid, error: String(e?.message ?? e) });
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      return json({ ok: true, results });
    }

    // Everyone else: must be the admin or a moderator.
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await db.auth.getUser(jwt);
    if (!who?.user) return json({ error: "Sign in first." }, 401);
    const { data: canMod } = await db.rpc("sc_user_can_moderate", { p_user: who.user.id });
    if (!canMod) return json({ error: "Only moderators can import sheets." }, 403);

    if (action === "sync") {
      return json({ ok: true, ...(await importSource(String(body.source_id), who.user.id)) });
    }

    const url = String(body?.url ?? "");
    const { id, gid } = parseSheetUrl(url);
    const rows = parseCsv(await fetchCsv(id, gid));

    if (action === "preview") {
      const mapping = suggestMapping(rows);
      const { title, tabs } = await fetchTabs(id);
      const header = rows[mapping.header_row] ?? [];
      // Every value in the likely status columns, so the page can ask how to read them.
      const values = (f: Field) => {
        const c = mapping.columns[f];
        if (c === undefined) return [];
        const counts: Record<string, number> = {};
        rows.slice(mapping.header_row + 1).forEach((r) => {
          const v = (r[c] ?? "").trim();
          if (v && v.length < 40) counts[v] = (counts[v] ?? 0) + 1;
        });
        return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25);
      };
      const { data: existing } = await db.from("sheet_sources").select("id, title, artist_id, mapping, credit, auto_sync, tab_name")
        .eq("sheet_id", id).eq("gid", gid).maybeSingle();
      return json({
        ok: true, sheet_id: id, gid, title, tabs, header: header.map((h) => h.split("\n")[0].trim()),
        rows: rows.slice(0, 40), row_count: rows.length, mapping: existing?.mapping ?? mapping,
        values: { availability: values("availability"), type: values("type") },
        existing: existing ?? null,
      });
    }

    const mapping = body.mapping as Mapping;
    if (!mapping?.columns || mapping.columns.title === undefined) return json({ error: "Pick which column has the song names." }, 400);

    if (action === "parse") {
      const { songs, eras, skipped } = readSongs(rows, mapping);
      const statuses: Record<string, number> = {};
      songs.forEach((s) => (statuses[s.status] = (statuses[s.status] ?? 0) + 1));
      const artists: Record<string, number> = {};
      songs.forEach((s) => s.artists.forEach((a) => (artists[a] = (artists[a] ?? 0) + 1)));
      return json({ ok: true, total: songs.length, skipped, eras, statuses, artists, songs: songs.slice(0, 300) });
    }

    if (action === "import") {
      const { data: sourceId, error } = await db.rpc("sc_sheet_save_source", {
        p_user: who.user.id,
        p: {
          url, mapping, title: body.title, credit: body.credit, artist_id: body.artist_id, tab_name: body.tab_name,
          auto_sync: body.auto_sync !== false, permission_confirmed: !!body.permission_confirmed,
        },
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, source_id: sourceId, ...(await importSource(sourceId as string, who.user.id)) });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
