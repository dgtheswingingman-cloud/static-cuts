// Supabase Edge Function: wikipedia-sync
//
// Artist bios from Wikipedia. For up to 45 seconds, one artist at a time
// (sc_wiki_next): read the artist's MusicBrainz links for their Wikidata
// item (or an English Wikipedia link), get the English Wikipedia page from
// Wikidata, then that page's summary (sc_wiki_save). Pages are only ever
// found through MusicBrainz, never by name. Calls take 'musicbrainz' and
// 'wikimedia' tickets. Wikipedia text is CC BY-SA: shown with a link back.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = "StaticCuts/1.0 (https://static-cuts.com; hello@static-cuts.com)";

class Stop extends Error {}
let secret = "";

async function paused(service: string) {
  const { data } = await db.from("sc_private_settings").select("value").eq("key", `${service}_pause_until`).maybeSingle();
  return !!(data?.value && Date.parse(data.value) > Date.now());
}
async function pauseFor(service: string, minutes: number) {
  await db.from("sc_private_settings").upsert(
    { key: `${service}_pause_until`, value: new Date(Date.now() + minutes * 60_000).toISOString() }, { onConflict: "key" });
}
async function ticket(service: string) {
  if (await paused(service)) throw new Stop();
  const { data } = await db.rpc("sc_api_allow", { p_service: service, p_want: 1 });
  if (data !== 1) throw new Stop();
}

// undefined = failed (try later), null = nothing there.
async function getJson(service: string, url: string): Promise<any | null | undefined> {
  await ticket(service);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }).catch(() => null);
  if (!res) return undefined;
  if (res.status === 429 || res.status === 503) { await pauseFor(service, 2); throw new Stop(); }
  if (res.status === 404) return null;
  if (!res.ok) return undefined;
  return await res.json().catch(() => undefined);
}

type Url = { type: string; url: string };

async function one(a: { artist_id: string; mbid: string; mb_urls: Url[] | null }) {
  // MusicBrainz links another job saved in the last 30 days are reused.
  let rels: Url[] | null = a.mb_urls ?? null;
  if (!rels) {
    const mb = await getJson("musicbrainz", `https://musicbrainz.org/ws/2/artist/${a.mbid}?inc=url-rels&fmt=json`);
    if (mb === undefined) return "failed";
    rels = ((mb?.relations ?? []) as any[]).filter((r) => !r.ended && typeof r.url?.resource === "string")
      .map((r) => ({ type: r.type, url: r.url.resource }));
    if (mb) await db.rpc("sc_mb_urls_save", { p_secret: secret, p_artist: a.artist_id, p_urls: rels });
  }
  let title: string | null = null;
  const enwiki = rels.find((r) => r.type === "wikipedia" && /^https?:\/\/en\.wikipedia\.org\/wiki\//.test(r.url));
  if (enwiki) title = decodeURIComponent(enwiki.url.split("/wiki/")[1]);
  if (!title) {
    const q = rels.map((r) => r.type === "wikidata" ? (r.url.match(/(Q\d+)$/) ?? [])[1] : null).filter(Boolean);
    if (q.length === 1) {
      const wd = await getJson("wikimedia", `https://www.wikidata.org/wiki/Special:EntityData/${q[0]}.json`);
      if (wd === undefined) return "failed";
      title = wd?.entities?.[q[0] as string]?.sitelinks?.enwiki?.title ?? null;
    }
  }
  if (!title) {
    await db.rpc("sc_wiki_save", { p_secret: secret, p_artist: a.artist_id, p_summary: null, p_url: null });
    return "none";
  }
  const s = await getJson("wikimedia", `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
  if (s === undefined) return "failed";
  const ok = s && s.type !== "disambiguation" && typeof s.extract === "string";
  const url = s?.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  await db.rpc("sc_wiki_save", { p_secret: secret, p_artist: a.artist_id, p_summary: ok ? s.extract : null, p_url: ok ? url : null });
  return ok ? "bio" : "none";
}

Deno.serve(async (req) => {
  secret = req.headers.get("x-cron-secret") ?? "";
  if (!secret) return json({ error: "not authorized" }, 403);
  const started = Date.now();
  const done = { artists: 0, bios: 0, none: 0, failed: 0 };
  try {
    while (Date.now() - started < 45_000) {
      const { data: next, error } = await db.rpc("sc_wiki_next", { p_secret: secret });
      if (error) return json({ error: error.message }, 403);
      if (!next) break;
      const a = next as { artist_id: string; mbid: string; mb_urls: Url[] | null };
      const r = await one(a);
      if (r === "failed") {
        await db.rpc("sc_wiki_save", { p_secret: secret, p_artist: a.artist_id, p_summary: null, p_url: null, p_failed: true });
        done.failed++;
      } else { done.artists++; if (r === "bio") done.bios++; else done.none++; }
      await sleep(1700); // MusicBrainz: about one call a second per address
    }
  } catch (e) {
    if (!(e instanceof Stop)) return json({ error: String((e as Error)?.message ?? e), ...done }, 500);
  }
  return json({ ok: true, ...done });
});
