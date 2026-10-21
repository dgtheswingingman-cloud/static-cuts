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
//   ai_mapping {url}                -> asks Claude (Haiku) to work out the
//                                      tab's layout from its header and a
//                                      sample of rows; returns a mapping in
//                                      the same shape as preview, nothing saved
// Anyone signed in:
//   user_csv {url}                  -> the sheet as CSV text, for "import my
//                                      spreadsheet" (nothing saved)
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

// The normal CSV export first. Many trackers turn off "viewers can download",
// which blocks that export (Google answers 401), so then read it through
// Google's chart-data route instead, which still works for view-only sheets
// (headers=0: every row as it is, header row included).
async function fetchCsv(id: string, gid: string) {
  const ok = (res: Response) => res.ok && !(res.headers.get("content-type") ?? "").includes("text/html");
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, { redirect: "follow" });
  if (ok(res)) return await res.text();
  const alt = await fetch(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=0&gid=${gid}`, { redirect: "follow" });
  if (ok(alt)) {
    const text = await alt.text();
    if (text.trim()) return text;
  }
  throw new Error("Couldn't read the sheet. Make sure it's shared as \"anyone with the link can view\".");
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
  // Era banner rows: the row starts a new era when this column contains the
  // text (any case); the era's name is in name_column. Set by "work it out".
  banner?: { column: number; contains: string; name_column: number } | null;
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
    // Era banners described by the mapping ("work it out").
    if (m.banner && (r[m.banner.column] ?? "").toLowerCase().includes(m.banner.contains.toLowerCase())) {
      const name = (r[m.banner.name_column] ?? "").split("\n")[0].trim();
      era = name.replace(/\s+era\b.*$/i, "").trim() || era;
      continue;
    }
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

// The names of the columns the mapping reads, e.g. {title: "song name"}.
function headerCheck(rows: string[][], m: Mapping) {
  const header = rows[m.header_row] ?? [];
  const out: Record<string, string> = {};
  for (const [field, i] of Object.entries(m.columns)) {
    if (i !== undefined) out[field] = (header[i] ?? "").split("\n")[0].trim().toLowerCase();
  }
  return out;
}

// ---------------------------------------------------------------------------
// "Work it out": the AI reads a sample of the tab and returns a mapping
// ---------------------------------------------------------------------------

const AI_PAUSE = "claude_pause_until";
const AI_MODEL = "claude-haiku-5-5";

async function aiTicket() {
  const { data: p } = await db.from("sc_private_settings").select("value").eq("key", AI_PAUSE).maybeSingle();
  if (p?.value && Date.parse(p.value) > Date.now()) throw new Error("The AI asked us to slow down. Try again in a few minutes.");
  const { data, error } = await db.rpc("sc_api_allow", { p_service: "claude", p_want: 1 });
  if (!error && data !== 1) throw new Error("The AI allowance is used up for now. Try again in a minute.");
}

const short = (c: string) => {
  const v = c.replace(/\s+/g, " ").trim();
  return v.length > 70 ? v.slice(0, 70) + "…" : v;
};

// The rows the AI sees: the top of the sheet (headers, banners) and a spread
// of rows from the rest, each cell cut short, numbered by their real row.
function sampleRows(rows: string[][]) {
  const pick = new Set<number>();
  for (let i = 0; i < Math.min(15, rows.length); i++) pick.add(i);
  const rest = rows.length - 15;
  if (rest > 0) for (let k = 0; k < 45; k++) pick.add(15 + Math.floor((k * rest) / 45));
  return [...pick].sort((a, b) => a - b).map((i) => `row ${i}: ${JSON.stringify((rows[i] ?? []).map(short))}`).join("\n");
}

// Short values that repeat in each column (likely statuses, types, quality).
function columnValues(rows: string[][], from: number) {
  const width = Math.max(0, ...rows.slice(0, 40).map((r) => r.length));
  const out: string[] = [];
  for (let c = 0; c < width; c++) {
    const counts: Record<string, number> = {};
    for (const r of rows.slice(from)) {
      const v = (r[c] ?? "").trim();
      if (v && v.length <= 30) counts[v] = (counts[v] ?? 0) + 1;
    }
    const top = Object.entries(counts).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
    if (top.length > 0 && top.length <= 30) out.push(`column ${c}: ${top.map(([v, n]) => `${JSON.stringify(v)} x${n}`).join(", ")}`);
  }
  return out.join("\n");
}

async function aiMapping(rows: string[][]) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("The AI key isn't set up.");
  const guess = suggestMapping(rows);
  const prompt = `You are reading one tab of a fan-made music tracker spreadsheet (unreleased and released songs by one artist). Work out how to read it.

Rows are numbered from 0. Each row is a JSON array of its cells (cut short).
${sampleRows(rows)}

Short values that repeat in each column, with counts:
${columnValues(rows, guess.header_row + 1)}

Reply with ONLY a JSON object, no other text:
{
  "header_row": <row number of the column headings>,
  "columns": { <field>: <column number> ... only fields this tab really has },
  "default_status": <status for songs when nothing says otherwise>,
  "status_column": "availability" | "type" | null,
  "status_values": { <exact value from the status column>: <status> ... },
  "skip_eras": [],
  "banner": { "column": <n>, "contains": "<text>", "name_column": <n> } or null,
  "explanation": "<two short plain-English sentences: what you found and anything odd>"
}

Fields: title (song name; required), artist (only a separate artist column), era (era/album column), notes, length (track length), file_date (recording/file date), leak_date (leak/surface date), release_date, type (e.g. Demo, Throwaway, Feature), availability (how much exists: Full, OG File, Snippet, Partial, Unavailable...), quality, links, producers, features.
Statuses: leaked (full song or file is out), snippet (only a snippet/preview is out), released (officially out), rumored (unheard, unavailable, only known about), teased, announced, unconfirmed.
Rules: a column whose heading cell is blank can still be a field: decide from its contents (dates, lengths like 3:12). Pick status_column = the column that says how much of the song is out (usually availability). Map every value listed for that column in status_values. If the tab is all released songs, default_status is released.
Era banners: many trackers put a row before each era (album/period) with the era name and stats like "12 OG Files", "3 Snippets" or "Total". Those rows are not songs. If you see them, set banner: column = a column whose cell on banner rows always contains some text that song rows never have in that column (e.g. "OG File" or "Total"), contains = that text, name_column = the column holding the era name on banner rows. Otherwise banner is null.`;

  await aiTicket();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: 6000, messages: [{ role: "user", content: prompt }] }),
  });
  if (res.status === 429 || res.status === 529) {
    const wait = Number(res.headers.get("retry-after")) || 60;
    await db.from("sc_private_settings").upsert({ key: AI_PAUSE, value: new Date(Date.now() + Math.max(wait, 120) * 1000).toISOString() }, { onConflict: "key" });
    throw new Error("The AI is busy. Try again in a few minutes.");
  }
  const body: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`The AI couldn't read this tab (${body?.error?.message ?? res.status}).`);
  const text = String((body?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text ?? "").join(""))
    .replace(/```(?:json)?/g, "");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let out: any;
  try { out = JSON.parse(json); } catch {
    console.error("ai_mapping unreadable", body?.stop_reason, text.slice(0, 300));
    throw new Error(body?.stop_reason === "max_tokens" ? "The AI's answer was too long. Try again." : "The AI's answer couldn't be read. Try again.");
  }

  // Keep only what makes sense for this sheet.
  const header_row = Number.isInteger(out.header_row) && out.header_row >= 0 && out.header_row < Math.min(rows.length, 40) ? out.header_row : guess.header_row;
  const width = Math.max(0, ...rows.slice(0, 60).map((r) => r.length));
  const columns: Partial<Record<Field, number>> = {};
  for (const f of Object.keys(SYNONYMS) as Field[]) {
    const c = out.columns?.[f];
    if (Number.isInteger(c) && c >= 0 && c < width) columns[f] = c;
  }
  if (columns.title === undefined) columns.title = guess.columns.title;
  const status_column = out.status_column === "availability" || out.status_column === "type" ? out.status_column : null;
  const status_values: Record<string, string> = {};
  for (const [v, st] of Object.entries(out.status_values ?? {})) if (STATUSES.includes(String(st))) status_values[v] = String(st);
  const mapping: Mapping = {
    header_row, columns,
    default_status: STATUSES.includes(out.default_status) ? out.default_status : "leaked",
    status_column: status_column && columns[status_column] !== undefined ? status_column : null,
    status_values, links: "official", skip_eras: [],
    banner: out.banner && Number.isInteger(out.banner.column) && Number.isInteger(out.banner.name_column)
      && out.banner.column >= 0 && out.banner.column < width && out.banner.name_column >= 0 && out.banner.name_column < width
      && typeof out.banner.contains === "string" && out.banner.contains.trim().length >= 2
      ? { column: out.banner.column, contains: out.banner.contains.trim(), name_column: out.banner.name_column } : null,
  };
  return { mapping, explanation: String(out.explanation ?? "").slice(0, 400) };
}

// A tracker that needs a look before it's read again.
class Held extends Error {}

// onTimer: a scheduled re-check. Those stop if the sheet's columns have
// changed since it was set up; an import pressed by hand takes the sheet as
// it is now (and remembers its columns from then on).
async function importSource(sourceId: string, userId: string, onTimer = false) {
  const { data: src, error } = await db.from("sheet_sources").select("*").eq("id", sourceId).single();
  if (error || !src) throw new Error("Unknown sheet.");
  const { id, gid } = parseSheetUrl(src.url);
  const rows = parseCsv(await fetchCsv(id, gid));
  const mapping = src.mapping as Mapping;
  const now = headerCheck(rows, mapping);
  const before = src.header_check as Record<string, string> | null;
  // Paused for a look: only a person pressing import or re-check runs it.
  if (onTimer && src.last_result?.held) throw new Held(String(src.last_result.error ?? "Paused for a look."));
  if (onTimer && before) {
    const changed = Object.keys({ ...before, ...now }).filter((f) => (before[f] ?? "") !== (now[f] ?? ""));
    if (changed.length) {
      throw new Held(`The tracker's columns changed (${changed.map((f) => `${f}: "${before[f] ?? ""}" is now "${now[f] ?? ""}"`).join("; ")}). ` +
        "Re-import it from Import a spreadsheet to check how it's read.");
    }
  }
  const { songs } = readSongs(rows, mapping);
  const { data, error: err } = await db.rpc("sc_sheet_import", { p_user: userId, p_source: sourceId, p_items: songs });
  if (err) {
    if (err.message.startsWith("Held for a look")) throw new Held(err.message);
    throw new Error(err.message);
  }
  if (!onTimer || !before) await db.from("sheet_sources").update({ header_check: now }).eq("id", sourceId);
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
    // Testing "work it out" with the timer's password (nothing is saved).
    if (cronSecret && action === "ai_mapping") {
      const { data: real } = await db.from("sc_private_settings").select("value").eq("key", "cron_secret").maybeSingle();
      if (!real?.value || real.value !== cronSecret) return json({ error: "not authorized" }, 403);
      const { id, gid } = parseSheetUrl(String(body?.url ?? ""));
      const rows = parseCsv(await fetchCsv(id, gid));
      const r = await aiMapping(rows);
      const { songs, eras, skipped } = readSongs(rows, r.mapping);
      const statuses: Record<string, number> = {};
      songs.forEach((x) => (statuses[x.status] = (statuses[x.status] ?? 0) + 1));
      return json({ ok: true, ...r, header: (rows[r.mapping.header_row] ?? []).map((h) => h.split("\n")[0].trim()), total: songs.length, skipped, statuses, eras, sample: songs.slice(0, 12) });
    }
    if (cronSecret) {
      const { data: due, error } = await db.rpc("sc_sheet_sync_due", { p_secret: cronSecret });
      if (error) return json({ error: error.message }, 403);
      const results: unknown[] = [];
      for (const sid of (due?.sources ?? []) as string[]) {
        try { results.push({ source: sid, ...(await importSource(sid, due.user_id, true)) }); }
        catch (e: any) {
          if (e instanceof Held) await db.rpc("sc_sheet_hold", { p_source: sid, p_reason: e.message });
          else await db.from("sheet_sources").update({ last_synced_at: new Date().toISOString(), last_result: { error: String(e?.message ?? e) } }).eq("id", sid);
          results.push({ source: sid, error: String(e?.message ?? e), held: e instanceof Held });
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      return json({ ok: true, results });
    }

    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await db.auth.getUser(jwt);
    if (!who?.user) return json({ error: "Sign in first." }, 401);

    // Anyone signed in: read their own Google Sheet for "import my
    // spreadsheet" (only the text comes back; nothing is saved).
    if (action === "user_csv") {
      const { id: sid, gid: sgid } = parseSheetUrl(String(body?.url ?? ""));
      const csv = await fetchCsv(sid, sgid);
      if (csv.length > 3_000_000) return json({ error: "That sheet is too big (over 3 MB). Download it as CSV and pick the file instead." }, 400);
      return json({ ok: true, csv });
    }

    // Everyone else: must be the admin or a moderator.
    const { data: canMod } = await db.rpc("sc_user_can_moderate", { p_user: who.user.id });
    if (!canMod) return json({ error: "Only moderators can import sheets." }, 403);

    if (action === "sync") {
      try {
        return json({ ok: true, ...(await importSource(String(body.source_id), who.user.id)) });
      } catch (e: any) {
        if (!(e instanceof Held)) throw e;
        // Pressed by hand: pause it and say what happened. Pressing again
        // goes through; re-importing it switches automatic re-checks back on.
        await db.rpc("sc_sheet_hold", { p_source: String(body.source_id), p_reason: e.message });
        return json({ error: `${e.message} If that's expected, press it again to go ahead, then re-import it from Import a spreadsheet to switch automatic re-checks back on.` }, 409);
      }
    }

    const url = String(body?.url ?? "");
    const { id, gid } = parseSheetUrl(url);
    const rows = parseCsv(await fetchCsv(id, gid));

    if (action === "ai_mapping") {
      const r = await aiMapping(rows);
      return json({ ok: true, ...r });
    }

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
      try {
        return json({ ok: true, source_id: sourceId, ...(await importSource(sourceId as string, who.user.id)) });
      } catch (e: any) {
        if (!(e instanceof Held)) throw e;
        await db.rpc("sc_sheet_hold", { p_source: sourceId, p_reason: e.message });
        return json({ error: `${e.message} If that's expected, press import again to go ahead.` }, 409);
      }
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
