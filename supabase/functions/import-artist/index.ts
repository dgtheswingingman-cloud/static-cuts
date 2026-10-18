// Supabase Edge Function: import-artist
//
// Fills an artist page from one source, when someone presses an import
// button on the artist page:
//   spotify  every album, single and feature -> added straight to the page
//   genius   every song on the artist's Genius profile -> import review list
//   lastfm   the artist's most-played tracks -> import review list
//
// Gentle by design (Spotify blocked us for a day once): one artist per call,
// a pause between every request, and it stops instead of retrying when a
// service says to slow down. The database checks who may import and how
// often (sc_import_start).
//
// Secrets (Edge Functions > Secrets): SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET,
// GENIUS_ACCESS_TOKEN, LASTFM_API_KEY. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const PAUSE_MS = 1500; // ~40 requests a minute at most, well under every limit
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class SlowDown extends Error {
  constructor(public service: string, public seconds: number) {
    super(`${service} asked us to slow down (wait ${seconds}s). Try this import again later.`);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Same idea as the database's title matching: lowercase, no feat. tags or
// punctuation. Used to compare artist names.
function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/\s*[\(\[]\s*(feat\.?|ft\.?|featuring|with|prod\.?)\s[^\)\]]*[\)\]]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// " - 2011 Remaster", " - Single Version" etc. aren't part of the song name.
function cleanSpotifyTitle(t: string): string {
  return t.replace(/\s+-\s+(\d{4}\s+)?(remaster(ed)?( version)?|single version|radio edit|mono|stereo|bonus track)\b.*$/i, "").trim();
}

async function getJson(url: string, init: RequestInit, service: string) {
  const res = await fetch(url, init);
  if (res.status === 429) {
    const wait = parseInt(res.headers.get("Retry-After") || "60", 10);
    throw new SlowDown(service, wait);
  }
  if (!res.ok) throw new Error(`${service} returned ${res.status} for ${new URL(url).pathname}`);
  await sleep(PAUSE_MS);
  return res.json();
}

type Artist = { id: string; name: string; spotify_artist_id: string | null; genius_artist_id: string | null; lastfm_name: string | null };

// ---------------------------------------------------------------- Spotify

async function spotifyToken() {
  const id = Deno.env.get("SPOTIFY_CLIENT_ID");
  const secret = Deno.env.get("SPOTIFY_CLIENT_SECRET");
  if (!id || !secret) throw new Error("Spotify keys aren't set up.");
  const data = await getJson("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${id}:${secret}`) },
    body: "grant_type=client_credentials",
  }, "Spotify");
  return data.access_token as string;
}

async function importSpotify(artist: Artist, runId: string) {
  const token = await spotifyToken();
  const h = { headers: { Authorization: `Bearer ${token}` } };
  let spotifyId = artist.spotify_artist_id;
  let profileNote: string | null = null;

  if (!spotifyId) {
    const s = await getJson(`https://api.spotify.com/v1/search?type=artist&limit=10&q=${encodeURIComponent(artist.name)}`, h, "Spotify");
    const exact = (s?.artists?.items ?? []).filter((a: any) => norm(a.name) === norm(artist.name));
    exact.sort((a: any, b: any) => (b.followers?.total ?? 0) - (a.followers?.total ?? 0));
    if (!exact.length) throw new Error(`Couldn't find "${artist.name}" on Spotify. Add their Spotify link with the "profiles" button and try again.`);
    spotifyId = exact[0].id as string;
    await db.rpc("sc_import_set_profile", { p_artist_id: artist.id, p_field: "spotify", p_value: spotifyId });
    profileNote = `Linked to Spotify profile "${exact[0].name}" (${exact[0].followers?.total ?? 0} followers). Check it's the right one under "profiles".`;
  }

  // Every release the artist is on.
  const albums: any[] = [];
  let next: string | null =
    `https://api.spotify.com/v1/artists/${spotifyId}/albums?include_groups=album,single,appears_on&limit=50&market=GB`;
  for (let page = 0; next && page < 8; page++) {
    const data: any = await getJson(next, h, "Spotify");
    albums.push(...(data.items ?? []));
    next = data.next;
  }

  // Full track lists, 20 releases per request. Albums before singles, so a
  // song keeps its album name rather than the single's.
  const ordered = albums
    .filter((a) => a.album_type !== "compilation")
    .sort((a, b) => (a.album_group === "album" ? 0 : a.album_group === "single" ? 1 : 2) - (b.album_group === "album" ? 0 : b.album_group === "single" ? 1 : 2));
  const items = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ordered.length; i += 20) {
    const ids = ordered.slice(i, i + 20).map((a) => a.id).join(",");
    const data: any = await getJson(`https://api.spotify.com/v1/albums?ids=${ids}&market=GB`, h, "Spotify");
    for (const album of data.albums ?? []) {
      if (!album) continue;
      for (const tr of album.tracks?.items ?? []) {
        const names: any[] = tr.artists ?? [];
        if (!names.some((a) => a.id === spotifyId)) continue; // not on this song
        const title = cleanSpotifyTitle(tr.name);
        const key = norm(title);
        if (!key || items.has(key)) continue;
        const isFeature = names[0]?.id !== spotifyId;
        items.set(key, {
          title,
          spotify_url: tr.external_urls?.spotify,
          album: album.album_type === "single" && album.total_tracks === 1 ? null : album.name,
          release_date: album.release_date_precision === "day" ? album.release_date : null,
          track_number: album.album_type === "album" ? tr.track_number : null,
          main_artist_name: isFeature ? names[0]?.name : null,
          featured: names.filter((a) => a.id !== spotifyId && a.id !== names[0]?.id).map((a) => a.name).join(", ") || null,
        });
      }
    }
  }

  const all = [...items.values()];
  const totals = { added: 0, updated: 0, skipped: 0 };
  for (let i = 0; i < all.length; i += 150) {
    const { data, error } = await db.rpc("sc_import_add_tracks", { p_run: runId, p_items: all.slice(i, i + 150) });
    if (error) throw new Error(error.message);
    totals.added += data.added; totals.updated += data.updated; totals.skipped += data.skipped;
  }
  return { ...totals, found: all.length, profileNote };
}

// ----------------------------------------------------------------- Genius

// Genius also hosts pages that aren't songs.
const NOT_A_SONG = /tracklist|album art|liner notes|credits|setlist|discography|translation|romanized|annotated|\binterview\b|\bspeech\b|cover art/i;

async function importGenius(artist: Artist, runId: string) {
  const token = Deno.env.get("GENIUS_ACCESS_TOKEN");
  if (!token) throw new Error("The Genius key isn't set up.");
  const h = { headers: { Authorization: `Bearer ${token}` } };
  let geniusId = artist.genius_artist_id && !artist.genius_artist_id.startsWith("name:") ? artist.genius_artist_id : null;
  let profileNote: string | null = null;

  if (!geniusId) {
    const searchName = artist.genius_artist_id?.startsWith("name:") ? artist.genius_artist_id.slice(5) : artist.name;
    const s: any = await getJson(`https://api.genius.com/search?per_page=20&q=${encodeURIComponent(searchName)}`, h, "Genius");
    const hit = (s?.response?.hits ?? [])
      .map((x: any) => x.result?.primary_artist)
      .find((a: any) => a && (norm(a.name) === norm(searchName) || norm(a.name) === norm(artist.name)));
    if (!hit) throw new Error(`Couldn't find "${artist.name}" on Genius. Add their Genius link with the "profiles" button and try again.`);
    geniusId = String(hit.id);
    await db.rpc("sc_import_set_profile", { p_artist_id: artist.id, p_field: "genius", p_value: geniusId });
    profileNote = `Linked to Genius profile "${hit.name}". Check it's the right one under "profiles".`;
  }

  const items = new Map<string, Record<string, unknown>>();
  for (let page = 1; page && page <= 20; ) {
    const data: any = await getJson(
      `https://api.genius.com/artists/${geniusId}/songs?per_page=50&sort=title&page=${page}`, h, "Genius");
    for (const song of data?.response?.songs ?? []) {
      const title: string = (song.title || "").trim();
      if (!title || NOT_A_SONG.test(title) || NOT_A_SONG.test(song.primary_artist?.name || "")) continue;
      const key = norm(title);
      if (!key || items.has(key)) continue;
      const isFeature = String(song.primary_artist?.id) !== geniusId;
      const c = song.release_date_components;
      const date = c?.year && c?.month && c?.day
        ? `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}` : null;
      items.set(key, {
        title,
        url: song.url,
        release_date: date,
        // Genius doesn't say whether a song is out. Leave the call to the reviewer.
        status_guess: "unconfirmed",
        main_artist_name: isFeature ? song.primary_artist?.name : null,
        extra: { pageviews: song.stats?.pageviews ?? null, genius_id: song.id },
      });
    }
    page = data?.response?.next_page ?? 0;
  }

  const all = [...items.values()];
  const totals = { suggested: 0, skipped: 0 };
  for (let i = 0; i < all.length; i += 200) {
    const { data, error } = await db.rpc("sc_import_suggest", { p_run: runId, p_items: all.slice(i, i + 200) });
    if (error) throw new Error(error.message);
    totals.suggested += data.suggested; totals.skipped += data.skipped;
  }
  return { ...totals, found: all.length, profileNote };
}

// ----------------------------------------------------------------- Last.fm

// Tags people add to leaked tracks' names, and what they tell us.
function cleanLastfmTitle(raw: string): { title: string; status: string } {
  let status = "unconfirmed";
  if (/\b(leak|leaked|cdq|og file)\b/i.test(raw)) status = "leaked";
  if (/\bsnippet\b/i.test(raw)) status = "snippet";
  const title = raw
    .replace(/\s*[\(\[]\s*(leak|leaked|cdq|hq|lq|snippet|unreleased|og file|full|official audio|official video|audio|lyrics?)\s*[\)\]]/gi, "")
    .replace(/\s*[\(\[]\s*(feat\.?|ft\.?|featuring|prod\.?|produced by)\s[^\)\]]*[\)\]]/gi, "")
    .replace(/\s+-\s+(leak|leaked|unreleased|snippet|cdq)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { title, status };
}

async function importLastfm(artist: Artist, runId: string) {
  const key = Deno.env.get("LASTFM_API_KEY");
  if (!key) throw new Error("The Last.fm key isn't set up.");
  const name = artist.lastfm_name || artist.name;
  const items = new Map<string, Record<string, unknown>>();
  let correctedName: string | null = null;

  for (let page = 1; page <= 3; page++) {
    const data: any = await getJson(
      `https://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&artist=${encodeURIComponent(name)}` +
        `&autocorrect=1&limit=200&page=${page}&api_key=${key}&format=json`, {}, "Last.fm");
    if (data?.error) throw new Error(`Last.fm: ${data.message}`);
    correctedName = correctedName ?? data?.toptracks?.["@attr"]?.artist ?? null;
    const tracks: any[] = data?.toptracks?.track ?? [];
    for (const t of tracks) {
      const listeners = parseInt(t.listeners || "0", 10);
      if (listeners < 500) continue; // the long tail is mostly typos and junk
      const { title, status } = cleanLastfmTitle(t.name || "");
      const k = norm(title);
      if (!k || items.has(k)) continue;
      items.set(k, { title, url: t.url, status_guess: status, extra: { listeners, playcount: parseInt(t.playcount || "0", 10) } });
    }
    const totalPages = parseInt(data?.toptracks?.["@attr"]?.totalPages || "1", 10);
    if (page >= totalPages || tracks.every((t) => parseInt(t.listeners || "0", 10) < 500)) break;
  }
  if (correctedName && !artist.lastfm_name) {
    await db.rpc("sc_import_set_profile", { p_artist_id: artist.id, p_field: "lastfm", p_value: correctedName });
  }

  const all = [...items.values()];
  const totals = { suggested: 0, skipped: 0 };
  for (let i = 0; i < all.length; i += 200) {
    const { data, error } = await db.rpc("sc_import_suggest", { p_run: runId, p_items: all.slice(i, i + 200) });
    if (error) throw new Error(error.message);
    totals.suggested += data.suggested; totals.skipped += data.skipped;
  }
  return { ...totals, found: all.length, profileNote: null };
}

// ------------------------------------------------------------------ handler

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  // Who's asking: the signed-in user's token from the site.
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await db.auth.getUser(jwt);
  if (!who?.user) return json({ error: "Sign in to import songs." }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const artistId = String(body?.artist_id || "");
  const source = String(body?.source || "");

  const { data: runId, error: startErr } = await db.rpc("sc_import_start", {
    p_artist_id: artistId, p_source: source, p_user: who.user.id,
  });
  if (startErr) return json({ error: startErr.message }, 429);

  try {
    const { data: artist, error } = await db.from("artists")
      .select("id, name, spotify_artist_id, genius_artist_id, lastfm_name").eq("id", artistId).single();
    if (error || !artist) throw new Error("Unknown artist.");
    const result = source === "spotify" ? await importSpotify(artist as Artist, runId)
      : source === "genius" ? await importGenius(artist as Artist, runId)
      : await importLastfm(artist as Artist, runId);
    await db.rpc("sc_import_finish", { p_run: runId, p_error: null });
    return json({ ok: true, source, ...result });
  } catch (e: any) {
    await db.rpc("sc_import_finish", { p_run: runId, p_error: String(e?.message ?? e) });
    return json({ error: String(e?.message ?? e) }, e instanceof SlowDown ? 429 : 500);
  }
});
