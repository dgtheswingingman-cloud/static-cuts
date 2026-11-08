// Supabase Edge Function: odesli-sync
//
// Other streaming links from Odesli (song.link). Every minute, for up to 50
// seconds, one song at a time (sc_odesli_next, most played first): ask
// Odesli for the song's Spotify link and save the matching Apple Music,
// YouTube, Tidal, Amazon, SoundCloud... pages (sc_odesli_save). Odesli allows
// 10 calls a minute without a key, so 9 tickets a minute ('odesli').
// Odesli is retiring this API: a 410 pauses the job for 30 days.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = "StaticCuts/1.0 (+https://static-cuts.com; hello@static-cuts.com)";

class Stop extends Error {}
let lastStatus = 0;

async function pause(minutes: number) {
  await db.from("sc_private_settings").upsert(
    { key: "odesli_pause_until", value: new Date(Date.now() + minutes * 60_000).toISOString() }, { onConflict: "key" });
}

async function lookup(spotifyUrl: string): Promise<Record<string, string> | null> {
  const { data: ticket } = await db.rpc("sc_api_allow", { p_service: "odesli", p_want: 1 });
  if (ticket !== 1) throw new Stop();
  const res = await fetch(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(spotifyUrl)}&userCountry=GB&songIfSingle=true`,
    { headers: { "User-Agent": UA, Accept: "application/json" } }).catch(() => null);
  if (!res) throw new Stop();
  lastStatus = res.status;
  if (res.status === 429) { await pause(5); throw new Stop(); }
  if (res.status === 410 || res.status === 401 || res.status === 403) { await pause(60 * 24 * 30); throw new Stop(); }
  if (res.status === 400 || res.status === 404) return {};
  if (!res.ok) return null;
  const d = await res.json().catch(() => null);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries((d?.linksByPlatform ?? {}) as Record<string, { url?: string }>)) {
    if (typeof v?.url === "string") out[k] = v.url;
  }
  return out;
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret") ?? "";
  if (!secret) return json({ error: "not authorized" }, 403);
  const { data: p } = await db.from("sc_private_settings").select("value").eq("key", "odesli_pause_until").maybeSingle();
  if (p?.value && Date.parse(p.value) > Date.now()) return json({ ok: true, paused: true });
  const started = Date.now();
  lastStatus = 0;
  const done = { songs: 0, links: 0, failed: 0 };
  try {
    while (Date.now() - started < 48_000) {
      const { data: next, error } = await db.rpc("sc_odesli_next", { p_secret: secret });
      if (error) return json({ error: error.message }, 403);
      if (!next) break;
      const n = next as { track_id: string; spotify_url: string };
      const links = await lookup(n.spotify_url);
      const { data: saved, error: e2 } = await db.rpc("sc_odesli_save", { p_secret: secret, p_track: n.track_id, p_links: links });
      if (e2) return json({ error: e2.message, ...done }, 500);
      if (links === null) done.failed++; else { done.songs++; done.links += (saved as number) ?? 0; }
      await sleep(6300);
    }
  } catch (e) {
    if (!(e instanceof Stop)) return json({ error: String((e as Error)?.message ?? e), ...done }, 500);
  }
  return json({ ok: true, ...done, ...(lastStatus && lastStatus !== 200 ? { last_status: lastStatus } : {}) });
});
