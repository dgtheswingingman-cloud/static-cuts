// Supabase Edge Function: discogs-sync
//
// Physical releases from Discogs (https://www.discogs.com). For up to 45
// seconds, one piece of work at a time (sc_discogs_next):
//   - an artist: find their Discogs id through MusicBrainz's links (once),
//     then read their main releases (sc_discogs_save_artist)
//   - an album ("master"): read its versions and keep which formats it came
//     out on, e.g. vinyl, CD, cassette (sc_discogs_save_master)
// Works without a key (25 calls a minute); with the DISCOGS_TOKEN secret
// (discogs.com/settings/developers → Generate token) Discogs allows 60.
// Every call takes a 'discogs' (or 'musicbrainz') ticket and respects the pause.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = "StaticCuts/1.0 +https://static-cuts.com";
const TOKEN = Deno.env.get("DISCOGS_TOKEN") ?? "";

class Stop extends Error {}
let secret = "";
let lastStatus = 0;

async function pauseFor(service: string, minutes: number) {
  await db.from("sc_private_settings").upsert(
    { key: `${service}_pause_until`, value: new Date(Date.now() + minutes * 60_000).toISOString() }, { onConflict: "key" });
}
async function paused(service: string) {
  const { data } = await db.from("sc_private_settings").select("value").eq("key", `${service}_pause_until`).maybeSingle();
  return !!(data?.value && Date.parse(data.value) > Date.now());
}

// One Discogs call. null = not found; throws Stop when out of tickets or refused.
async function discogs(path: string): Promise<any | null> {
  const { data: ticket } = await db.rpc("sc_api_allow", { p_service: "discogs", p_want: 1 });
  if (ticket !== 1) throw new Stop();
  const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/vnd.discogs.v2.discogs+json" };
  if (TOKEN) headers.Authorization = `Discogs token=${TOKEN}`;
  const res = await fetch(`https://api.discogs.com${path}`, { headers }).catch(() => null);
  if (!res) throw new Stop();
  lastStatus = res.status;
  if (res.status === 429) { await pauseFor("discogs", 2); throw new Stop(); }
  if (res.status === 401 || res.status === 403) { await pauseFor("discogs", 60); throw new Stop(); }
  if (res.status === 404) return null;
  if (!res.ok) return undefined;
  // Slow down when Discogs says few calls are left this minute.
  if (Number(res.headers.get("X-Discogs-Ratelimit-Remaining") ?? "10") <= 2) await sleep(5000);
  return await res.json().catch(() => undefined);
}

// The artist's Discogs id from their MusicBrainz links.
async function discogsIdFromMb(mbid: string): Promise<number | null | undefined> {
  if (await paused("musicbrainz")) throw new Stop();
  const { data: ticket } = await db.rpc("sc_api_allow", { p_service: "musicbrainz", p_want: 1 });
  if (ticket !== 1) throw new Stop();
  const res = await fetch(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`,
    { headers: { "User-Agent": "StaticCuts/1.0 ( https://static-cuts.com )", Accept: "application/json" } }).catch(() => null);
  if (!res) throw new Stop();
  if (res.status === 503 || res.status === 429) { await pauseFor("musicbrainz", 2); throw new Stop(); }
  if (res.status === 404) return null;
  if (!res.ok) return undefined;
  const d = await res.json().catch(() => null);
  const ids = new Set<number>();
  for (const r of (d?.relations ?? []) as any[]) {
    const m = r.type === "discogs" && typeof r.url?.resource === "string" ? r.url.resource.match(/discogs\.com\/(?:[a-z]{2}\/)?artist\/(\d+)/) : null;
    if (m) ids.add(Number(m[1]));
  }
  return ids.size === 1 ? [...ids][0] : null;
}

async function doArtist(t: { artist_id: string; mbid: string; discogs_id: number | null }) {
  let id: number | null | undefined = t.discogs_id;
  if (!id) {
    id = await discogsIdFromMb(t.mbid);
    if (id === undefined) return { saved: 0, retry: true }; // MusicBrainz hiccup: claim runs out, tried again later
    if (id === null) {
      await db.rpc("sc_discogs_save_artist", { p_secret: secret, p_artist: t.artist_id, p_discogs: null, p_items: [] });
      return { saved: 0 };
    }
  }
  const items: unknown[] = [];
  for (let page = 1; page <= 3; page++) {
    const d = await discogs(`/artists/${id}/releases?sort=year&sort_order=asc&per_page=100&page=${page}`);
    if (d === undefined) {
      await db.rpc("sc_discogs_save_artist", { p_secret: secret, p_artist: t.artist_id, p_discogs: id, p_items: null });
      return { saved: 0, retry: true };
    }
    if (d === null) break;
    for (const r of (d.releases ?? []) as any[]) if (r.role === "Main") items.push(r);
    if (page >= Number(d.pagination?.pages ?? 1)) break;
  }
  const { data } = await db.rpc("sc_discogs_save_artist", { p_secret: secret, p_artist: t.artist_id, p_discogs: id, p_items: items });
  return { saved: (data as { saved?: number })?.saved ?? 0 };
}

const FORMAT: Record<string, string> = { Vinyl: "Vinyl", CD: "CD", CDr: "CD", Cassette: "Cassette", Minidisc: "MiniDisc", DVD: "DVD", "Blu-ray": "Blu-ray", "8-Track Cartridge": "8-track" };

async function doMaster(t: { artist_id: string; master_id: number }) {
  const d = await discogs(`/masters/${t.master_id}/versions?per_page=100`);
  if (d === undefined) {
    await db.rpc("sc_discogs_save_master", { p_secret: secret, p_artist: t.artist_id, p_master: t.master_id, p_formats: null, p_versions: null });
    return;
  }
  const formats = new Set<string>();
  for (const v of (d?.versions ?? []) as any[]) {
    const major: string[] = Array.isArray(v.major_formats) ? v.major_formats : [String(v.format ?? "").split(",")[0].trim()];
    for (const f of major) if (FORMAT[f]) formats.add(FORMAT[f]);
  }
  const order = Object.values(FORMAT);
  await db.rpc("sc_discogs_save_master", {
    p_secret: secret, p_artist: t.artist_id, p_master: t.master_id,
    p_formats: [...formats].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    p_versions: Number(d?.pagination?.items ?? (d?.versions ?? []).length) || 0,
  });
}

Deno.serve(async (req) => {
  secret = req.headers.get("x-cron-secret") ?? "";
  if (!secret) return json({ error: "not authorized" }, 403);
  if (await paused("discogs")) return json({ ok: true, paused: true });
  const started = Date.now();
  lastStatus = 0;
  const done = { artists: 0, releases: 0, albums: 0, keyed: !!TOKEN };
  try {
    while (Date.now() - started < 45_000) {
      const { data: next, error } = await db.rpc("sc_discogs_next", { p_secret: secret });
      if (error) return json({ error: error.message }, 403);
      if (!next) break;
      const t = next as any;
      if (t.task === "master") { await doMaster(t); done.albums++; }
      else { const r = await doArtist(t); done.artists++; done.releases += r.saved; }
      await sleep(TOKEN ? 1100 : 2600);
    }
  } catch (e) {
    if (!(e instanceof Stop)) return json({ error: String((e as Error)?.message ?? e), ...done }, 500);
  }
  return json({ ok: true, ...done, ...(lastStatus && lastStatus !== 200 ? { last_status: lastStatus } : {}) });
});
