// Supabase Edge Function: listenbrainz-sync
//
// Play counts from ListenBrainz (https://listenbrainz.org, open data). For up
// to 45 seconds, one artist at a time (sc_lb_next): read their top recordings
// (one call) and save each song's listens and listeners (sc_lb_save), plus a
// Cover Art Archive cover for songs that have none. Every request takes a
// 'listenbrainz' ticket (sc_api_allow) and respects listenbrainz_pause_until.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = "StaticCuts/1.0 ( https://static-cuts.com; hello@static-cuts.com )";
// ListenBrainz turns away calls without a user token (401). Nathan's token
// lives in the LISTENBRAINZ_TOKEN secret (listenbrainz.org/settings).
const TOKEN = Deno.env.get("LISTENBRAINZ_TOKEN") ?? "";
const HEADERS: Record<string, string> = { "User-Agent": UA, Accept: "application/json",
  ...(TOKEN ? { Authorization: `Token ${TOKEN}` } : {}) };

class Stop extends Error {}
let fails = 0;
let lastStatus = 0;

async function pause(minutes: number) {
  await db.from("sc_private_settings").upsert(
    { key: "listenbrainz_pause_until", value: new Date(Date.now() + minutes * 60_000).toISOString() }, { onConflict: "key" });
}

async function top(mbid: string): Promise<unknown[] | null> {
  const { data: ticket } = await db.rpc("sc_api_allow", { p_service: "listenbrainz", p_want: 1 });
  if (ticket !== 1) throw new Stop();
  const res = await fetch(`https://api.listenbrainz.org/1/popularity/top-recordings-for-artist/${mbid}`,
    { headers: HEADERS }).catch(() => null);
  if (!res) throw new Stop();
  if (res.status === 429) {
    const wait = Number(res.headers.get("X-RateLimit-Reset-In") ?? "60");
    await pause(Math.max(1, Math.ceil(wait / 60)));
    throw new Stop();
  }
  if (res.status === 401 || res.status === 403) { lastStatus = res.status; await pause(60); throw new Stop(); }
  if (res.status === 400 || res.status === 404) return [];
  if (!res.ok) {
    // A server error on one artist (ListenBrainz sometimes times out on big
    // catalogues): skip them and retry them tomorrow. Three in one run means ListenBrainz itself is struggling: pause.
    lastStatus = res.status;
    if (++fails >= 3) { await pause(10); throw new Stop(); }
    return null;
  }
  const body = await res.json().catch(() => null);
  return Array.isArray(body) ? body : [];
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret") ?? "";
  if (!secret) return json({ error: "not authorized" }, 403);
  const { data: p } = await db.from("sc_private_settings").select("value").eq("key", "listenbrainz_pause_until").maybeSingle();
  if (p?.value && Date.parse(p.value) > Date.now()) return json({ ok: true, paused: true });
  if (!TOKEN) return json({ ok: true, waiting: "LISTENBRAINZ_TOKEN not set" });

  const started = Date.now();
  fails = 0; lastStatus = 0;
  const done = { artists: 0, matched: 0, covers: 0, skipped: 0 };
  try {
    while (Date.now() - started < 45_000) {
      const { data: next, error } = await db.rpc("sc_lb_next", { p_secret: secret });
      if (error) return json({ error: error.message }, 403);
      if (!next) break;
      const n = next as { artist_id: string; mbid: string };
      const items = await top(n.mbid);
      if (items === null) {
        await db.rpc("sc_lb_save", { p_secret: secret, p_artist: n.artist_id, p_items: null });
        done.skipped++; await sleep(1000); continue;
      }
      const { data: r, error: e2 } = await db.rpc("sc_lb_save", { p_secret: secret, p_artist: n.artist_id, p_items: items });
      if (e2) return json({ error: e2.message, ...done }, 500);
      done.artists++;
      done.matched += (r as { matched?: number })?.matched ?? 0;
      done.covers += (r as { covers?: number })?.covers ?? 0;
      await sleep(1000);
    }
  } catch (e) {
    if (lastStatus === 401 || lastStatus === 403) return json({ ok: false, ...done, last_error_status: lastStatus, note: "token refused" });
    if (!(e instanceof Stop)) return json({ error: String((e as Error)?.message ?? e), ...done }, 500);
  }
  return json({ ok: true, ...done, ...(lastStatus ? { last_error_status: lastStatus } : {}) });
});
