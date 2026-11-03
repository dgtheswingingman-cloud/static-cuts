// Supabase Edge Function: artist-photos
//
// Adds photos to artists' photo pools (artist_photos), most-followed first:
// Deezer's picture, and from TheAudioDB (free public key) their thumb, wide
// thumb and fanart, only when it's clearly the same artist (same MusicBrainz
// ID, or exactly one result with exactly their name). Every call takes a
// ticket (sc_api_allow 'deezer' / 'audiodb') and respects <service>_pause_until.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const plain = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

type Next = { artist_id: string; name: string; deezer_id: string | null; mbid: string | null };

async function paused(service: string) {
  const { data } = await db.from("sc_private_settings").select("value").eq("key", `${service}_pause_until`).maybeSingle();
  return !!(data?.value && Date.parse(data.value) > Date.now());
}
async function pause(service: string, minutes: number) {
  await db.from("sc_private_settings").upsert({ key: `${service}_pause_until`, value: new Date(Date.now() + minutes * 60_000).toISOString() }, { onConflict: "key" });
}
async function ticket(service: string) {
  if (await paused(service)) return false;
  const { data } = await db.rpc("sc_api_allow", { p_service: service, p_want: 1 });
  return data === 1;
}

async function deezerPhoto(id: string): Promise<string | null | "stop"> {
  if (!(await ticket("deezer"))) return "stop";
  const res = await fetch(`https://api.deezer.com/artist/${id}`).catch(() => null);
  await sleep(300);
  if (!res) return null;
  if (res.status === 429) { await pause("deezer", 5); return "stop"; }
  const b = await res.json().catch(() => null);
  if (b?.error?.code === 4) { await pause("deezer", 2); return "stop"; }
  const u = b?.picture_xl || b?.picture_big || null;
  // Deezer's grey "no picture" placeholder has an empty hash in the path.
  return u && !/\/artist\/\/|\/images\/artist\/\//.test(u) ? u : null;
}

async function audiodbPhotos(name: string, mbid: string | null): Promise<string[] | "stop"> {
  if (!(await ticket("audiodb"))) return "stop";
  const res = await fetch(`https://www.theaudiodb.com/api/v1/json/123/search.php?s=${encodeURIComponent(name)}`).catch(() => null);
  await sleep(2200);
  if (!res) return [];
  if (res.status === 429) { await pause("audiodb", 10); return "stop"; }
  const b = await res.json().catch(() => null);
  const list = ((b?.artists ?? []) as Record<string, string | null>[]);
  let pick: Record<string, string | null> | undefined;
  if (mbid) pick = list.find((a) => a.strMusicBrainzID && a.strMusicBrainzID === mbid);
  if (!pick) {
    const same = list.filter((a) => plain(a.strArtist ?? "") === plain(name));
    // With a MusicBrainz ID on both sides that don't match, it's someone else.
    if (same.length === 1 && !(mbid && same[0].strMusicBrainzID && same[0].strMusicBrainzID !== mbid)) pick = same[0];
  }
  if (!pick) return [];
  return ["strArtistThumb", "strArtistWideThumb", "strArtistFanart", "strArtistFanart2", "strArtistFanart3", "strArtistFanart4"]
    .map((k) => pick![k]).filter((u): u is string => !!u && /^https?:\/\//.test(u)).map((u) => u.replace(/^http:/, "https:"));
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);
  const started = Date.now();
  const { data, error } = await db.rpc("sc_artist_photos_next", { p_secret: secret, p_limit: 12 });
  if (error) return json({ error: error.message }, 403);
  const list = (data ?? []) as Next[];
  const done = { artists: 0, added: 0, stopped: false };
  for (const a of list) {
    if (Date.now() - started > 50_000) break; // the rest are re-claimed in 10 minutes
    const urls: string[] = [];
    if (a.deezer_id) {
      const d = await deezerPhoto(a.deezer_id);
      if (d === "stop") { done.stopped = true; break; }
      if (d) urls.push(d);
    }
    const more = await audiodbPhotos(a.name, a.mbid);
    if (more === "stop") { done.stopped = true; break; }
    urls.push(...more);
    const { data: n, error: saveErr } = await db.rpc("sc_artist_photos_save", { p_secret: secret, p_artist: a.artist_id, p_urls: urls });
    if (saveErr) return json({ error: saveErr.message, ...done }, 500);
    done.artists++;
    done.added += (n as number) ?? 0;
  }
  return json({ ok: true, ...done });
});
