// Supabase Edge Function: apple-music
//
// Apple Music links on songs, from Apple's free iTunes Search API (no key;
// Apple asks for about 20 calls a minute, so ~15 a run with gaps). Every
// minute, for up to 50 seconds, the database hands out what's next
// (sc_apple_next):
//   artist: find them on Apple (saved id, else exact-name artists, kept only
//           when a release matches a song or album here) and list releases
//   album:  one release's songs; matching songs here get the Apple link (and
//           release date, genre and explicit flag where we have none)
// Every call takes an 'itunes' ticket (sc_api_allow).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const API = "https://itunes.apple.com";
class Stop extends Error {}

async function paused() {
  const { data } = await db.from("sc_private_settings").select("value").eq("key", "itunes_pause_until").maybeSingle();
  return !!(data?.value && Date.parse(data.value) > Date.now());
}

let last = 0;
async function itunes(path: string): Promise<any[]> {
  const { data: ticket } = await db.rpc("sc_api_allow", { p_service: "itunes", p_want: 1 });
  if (ticket !== 1) throw new Stop();
  const wait = 3200 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(`${API}${path}`).catch(() => null);
  if (!res) throw new Stop();
  if (res.status === 403 || res.status === 429 || res.status >= 500) {
    await db.from("sc_private_settings").upsert({ key: "itunes_pause_until", value: new Date(Date.now() + 10 * 60_000).toISOString() }, { onConflict: "key" });
    throw new Stop();
  }
  if (!res.ok) return [];
  const body = await res.json().catch(() => null);
  return (body?.results ?? []) as any[];
}

const plain = (x: string) => {
  const p = (x || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9$]/g, "");
  return p || (x || "").toLowerCase().trim();
};
// "Song - Single" / "Album - EP" -> the release's own title.
const releaseTitle = (t: string) => (t || "").replace(/\s+-\s+(Single|EP)$/i, "").trim();

async function albumsOf(appleId: string) {
  const rows = await itunes(`/lookup?id=${encodeURIComponent(appleId)}&entity=album&limit=200&country=US`);
  const mine = rows.filter((r) => r.wrapperType === "collection" && String(r.artistId) === String(appleId));
  // Clean (edited) copies are skipped when the explicit one is there too.
  const explicitTitles = new Set(mine.filter((r) => r.collectionExplicitness !== "cleaned").map((r) => releaseTitle(r.collectionName).toLowerCase()));
  return mine
    .filter((r) => r.collectionExplicitness !== "cleaned" || !explicitTitles.has(releaseTitle(r.collectionName).toLowerCase()))
    .map((r) => ({ id: String(r.collectionId), title: releaseTitle(r.collectionName) }));
}

let secret = "";

async function doArtist(n: { artist_id: string; name: string; apple_id: string | null }) {
  const candidates: string[] = [];
  if (n.apple_id) candidates.push(n.apple_id);
  else {
    const found = await itunes(`/search?term=${encodeURIComponent(n.name)}&entity=musicArtist&limit=10&country=US`);
    for (const a of found) if (plain(a.artistName) === plain(n.name) && a.artistId) candidates.push(String(a.artistId));
  }
  for (const id of [...new Set(candidates)].slice(0, 3)) {
    const albums = await albumsOf(id);
    const { data: kept } = await db.rpc("sc_apple_artist_try", { p_secret: secret, p_artist: n.artist_id, p_apple_id: id, p_albums: albums });
    if (kept) return true;
  }
  await db.rpc("sc_apple_artist_none", { p_secret: secret, p_artist: n.artist_id });
  return false;
}

async function doAlbum(n: { artist_id: string; album_id: string }) {
  const rows = await itunes(`/lookup?id=${encodeURIComponent(n.album_id)}&entity=song&limit=200&country=US`);
  const tracks = rows
    .filter((r) => r.wrapperType === "track" && r.kind === "song" && r.trackViewUrl)
    .map((r) => ({
      title: r.trackName as string,
      url: String(r.trackViewUrl).replace(/[?&]uo=\d+/, "").replace(/\?$/, ""),
      // Filled in only where we have nothing.
      released: typeof r.releaseDate === "string" ? r.releaseDate.slice(0, 10) : null,
      explicit: r.trackExplicitness === "explicit" ? true : r.trackExplicitness === "notExplicit" ? false : null,
      genre: typeof r.primaryGenreName === "string" ? r.primaryGenreName : null,
    }));
  const { data } = await db.rpc("sc_apple_album_save", { p_secret: secret, p_artist: n.artist_id, p_album: n.album_id, p_tracks: tracks });
  return (data as number) ?? 0;
}

Deno.serve(async (req) => {
  secret = req.headers.get("x-cron-secret") ?? "";
  if (!secret) return json({ error: "not authorized" }, 403);
  if (await paused()) return json({ ok: true, paused: true });
  const started = Date.now();
  const done = { artists: 0, found: 0, releases: 0, linked: 0 };
  try {
    while (Date.now() - started < 45_000) {
      const { data: next, error } = await db.rpc("sc_apple_next", { p_secret: secret });
      if (error) return json({ error: error.message }, 403);
      if (!next) break;
      if (next.kind === "album") {
        done.releases++;
        done.linked += await doAlbum(next);
      } else {
        done.artists++;
        if (await doArtist(next)) done.found++;
      }
    }
  } catch (e) {
    if (!(e instanceof Stop)) return json({ error: String((e as Error)?.message ?? e), ...done }, 500);
  }
  return json({ ok: true, ...done });
});
