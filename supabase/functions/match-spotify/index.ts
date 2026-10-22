// Supabase Edge Function: match-spotify
//
// Finds Spotify links for songs that don't have one. Run by a timer only
// (every 5 minutes, at most 3 calls to Spotify each time):
//   1. Artists with a Spotify profile: reads their releases (one call per
//      page of releases, one per release) and matches every song on each
//      release to the archive by title. Much cheaper than searching.
//   2. Any calls left over: searches song by song for artists with no
//      Spotify profile, skipping songs that can't be out (leaks, snippets,
//      rumours), followed artists first, taking turns between artists.
// A match writes the link, marks the song released and fills in its album
// and release date if missing. The Spotify sign-in is kept for its hour and
// shared with the other Spotify jobs.
//
// Required secrets (set via `supabase secrets set`):
//   SPOTIFY_CLIENT_ID
//   SPOTIFY_CLIENT_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically by
// Supabase for every Edge Function -- you don't need to set those yourself.

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
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SPOTIFY_CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID")!;
const SPOTIFY_CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { fetch: steadyFetch } });

// Spotify asked us to slow down: every Spotify job (this one, the link
// checker, guest artists, the timers and the link tools page) stays off
// until then, so nobody keeps knocking during a block.
const PAUSE_KEY = "spotify_pause_until";
async function spotifyPausedFor(): Promise<number> {
  const { data } = await supabase.from("sc_private_settings").select("value").eq("key", PAUSE_KEY).maybeSingle();
  const until = data?.value ? Date.parse(data.value) : 0;
  return until > Date.now() ? Math.ceil((until - Date.now()) / 1000) : 0;
}
async function pauseSpotify(seconds: number) {
  const until = new Date(Date.now() + Math.max(seconds || 0, 600) * 1000).toISOString();
  await supabase.from("sc_private_settings").upsert({ key: PAUSE_KEY, value: until }, { onConflict: "key" });
}
const breather = () => new Promise((r) => setTimeout(r, 1000));

// Tickets from the shared Spotify allowance (sc_spotify_allow: a few a minute,
// 25 an hour, 600 a day across every job). Returns how many calls we may make.
async function spotifyTickets(want: number): Promise<number> {
  const { data } = await supabase.rpc("sc_spotify_allow", { p_want: want });
  return typeof data === "number" ? data : 0;
}

// Only the timer (x-cron-secret) may run this: a slow, steady rate.
async function allowed(req: Request): Promise<boolean> {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return false;
  const { data } = await supabase.from("sc_private_settings").select("value").eq("key", "cron_secret").maybeSingle();
  return !!data?.value && data.value === secret;
}

// Matches are recorded in an undo batch ("Spotify matching <date>", one per
// 12 hours of matching), so a bad run can be reversed from /admin/batches.
// Only the matches are recorded, not the "searched, nothing found" marks.
async function batchClient() {
  const { data: batchId, error } = await supabase.rpc("sc_job_batch", {
    p_kind: "spotify_match",
    p_label: "Spotify matching",
  });
  if (error || !batchId) return supabase; // undo log unavailable: still match
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { "x-sc-batch": String(batchId) }, fetch: steadyFetch },
  });
}

// One Spotify sign-in lasts an hour, so it's kept and shared by every
// Spotify job instead of signing in again each run (each sign-in takes a
// ticket). Returns null when there's no ticket for a new one right now.
async function cachedSpotifyToken(): Promise<string | null> {
  const { data: rows } = await supabase.from("sc_private_settings").select("key, value")
    .in("key", ["spotify_token", "spotify_token_expires"]);
  const saved = Object.fromEntries(((rows ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  if (saved.spotify_token && Date.parse(saved.spotify_token_expires ?? "") > Date.now() + 5 * 60_000) return saved.spotify_token;
  if ((await spotifyTickets(1)) < 1) return null;
  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`),
    },
    body: "grant_type=client_credentials",
  });
  if (resp.status === 429) {
    await pauseSpotify(parseInt(resp.headers.get("Retry-After") || "60", 10));
    return null;
  }
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.access_token) return null;
  await supabase.from("sc_private_settings").upsert([
    { key: "spotify_token", value: data.access_token },
    { key: "spotify_token_expires", value: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString() },
  ], { onConflict: "key" });
  return data.access_token as string;
}
// Spotify said the saved sign-in is no good: forget it.
async function dropSpotifyToken() {
  await supabase.from("sc_private_settings").upsert({ key: "spotify_token_expires", value: new Date(0).toISOString() }, { onConflict: "key" });
}

// Strip our own annotation characters (e.g. trailing "*" for unreleased
// tracks) before searching -- Spotify won't have those in real titles.
function cleanTitle(title: string): string {
  return title.replace(/\*+$/, "").trim();
}

// For comparing titles and artist names: lowercase, no (feat. ...) tags, no
// " - Remastered 2011" style suffixes, no punctuation or spaces. Bracketed
// version tags like (Demo) or (Live) are kept, so versions never match the
// main song.
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*[\(\[]\s*(feat\.?|ft\.?|featuring|with|prod\.?)\s[^\)\]]*[\)\]]/g, "")
    .replace(/\s+-\s+(\d{4}\s+)?(remaster(ed)?|single version|radio edit|mono|stereo)\b.*$/, "")
    .replace(/[^\p{L}\p{N}()\[\]]+/gu, "");
}

// ------------------------------------------------- reading artists' releases
//
// For artists with a Spotify profile, reading their releases is far cheaper
// than searching song by song: one call lists up to 50 releases, and one
// call per release returns every song on it, each matched to the archive by
// title (sc_spotify_album_save). Albums are read before singles, so a song
// keeps its album's name.

// Pull "(feat. X)", "(with X)", "ft. X" out of a title (same as import-artist).
function splitCredits(t: string): { title: string; credits: string[] } {
  const credits: string[] = [];
  let title = t.replace(/\s*[\(\[]\s*(?:feat\.|ft\.|feat\s|ft\s|featuring\s|with\s)\s*([^\)\]]*)[\)\]]/gi, (_m, who) => {
    credits.push(who.trim());
    return "";
  });
  title = title.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+(.*)$/i, (_m, who) => {
    credits.push(who.trim());
    return "";
  });
  return { title: title.replace(/\s{2,}/g, " ").trim(), credits: credits.filter(Boolean) };
}

// " - 2011 Remaster", " - Single Version" etc. aren't part of the song name.
function cleanSpotifyTitle(t: string): string {
  return splitCredits(t).title
    .replace(/\s+-\s+(\d{4}\s+)?(remaster(ed)?( version)?|single version|radio edit|mono|stereo|bonus track)\b.*$/i, "")
    .trim();
}

// This artist's songs on one release, in the shape sc_import_add_tracks takes
// (so an "import from Spotify" can add them later without asking again).
function releaseItems(album: any, tracks: any[], spotifyId: string) {
  const out: Record<string, unknown>[] = [];
  for (const tr of tracks) {
    const names: any[] = tr?.artists ?? [];
    if (!names.some((a) => a?.id === spotifyId)) continue; // not on this song
    const title = cleanSpotifyTitle(tr.name || "");
    if (!title || !tr.external_urls?.spotify) continue;
    const isFeature = names[0]?.id !== spotifyId;
    out.push({
      title,
      spotify_url: tr.external_urls.spotify,
      album: album.album_type === "single" && album.total_tracks === 1 ? null : album.name,
      release_date: album.release_date_precision === "day" ? album.release_date : null,
      track_number: album.album_type === "album" ? tr.track_number : null,
      main_artist_name: isFeature ? names[0]?.name : null,
      featured: [...new Set([
        ...names.filter((a) => a.id !== spotifyId && a.id !== names[0]?.id).map((a) => a.name),
        ...splitCredits(tr.name || "").credits,
      ])].join(", ") || null,
    });
  }
  return out;
}

// How many releases to ask for per page. Spotify cut some limits in 2026;
// if 50 is refused we drop to 10 and remember it.
async function releasePageSize(): Promise<number> {
  const { data } = await supabase.from("sc_private_settings").select("value").eq("key", "spotify_albums_page_limit").maybeSingle();
  const n = parseInt(data?.value ?? "50", 10);
  return n > 0 && n <= 50 ? n : 50;
}

type Got = { ok: boolean; status: number; body: any };
async function spotifyGet(url: string, token: string): Promise<Got> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) await pauseSpotify(parseInt(res.headers.get("Retry-After") || "60", 10));
  if (res.status === 401) await dropSpotifyToken();
  const body = res.ok ? await res.json().catch(() => null) : null;
  return { ok: res.ok && body !== null, status: res.status, body };
}

type TrackRow = {
  id: string;
  title: string;
  release_status: string | null;
  album: string | null;
  release_date: string | null;
  artist: string | null;
  others: string[] | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    if (!(await allowed(req))) {
      return new Response(JSON.stringify({ error: "not authorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const url = new URL(req.url);
    const searchLimit = Number(url.searchParams.get("limit") || "10");
    // Calls to Spotify per run (the timer runs every 5 minutes; the shared
    // allowance is 25 an hour across every job).
    const MAX_CALLS = 3;

    const paused = await spotifyPausedFor();
    if (paused > 0) {
      return new Response(
        JSON.stringify({ done: false, checked: 0, matched: 0, rateLimited: true, retryAfterSeconds: paused, paused: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = await cachedSpotifyToken();
    if (!token) {
      return new Response(
        JSON.stringify({ done: false, checked: 0, matched: 0, budget: "Spotify allowance used up for now; next run" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let calls = 0;
    let rateLimited = false;
    let retryAfterSeconds = 0;
    const releases = { listed: 0, read: 0, matched: 0, linksChecked: 0, imported: 0 };

    // 1. Artists' releases first: the cheapest way to match songs.
    while (calls < MAX_CALLS && !rateLimited) {
      const { data: work } = await supabase.rpc("sc_spotify_album_next");
      if (!work) break;
      if ((await spotifyTickets(1)) < 1) break;
      if (calls > 0) await breather();
      calls++;
      const sid = String(work.spotify_artist_id);

      if (work.kind === "list") {
        const size = await releasePageSize();
        const got = await spotifyGet(
          `https://api.spotify.com/v1/artists/${sid}/albums?include_groups=album,single,appears_on&market=GB&limit=${size}&offset=${work.offset}`,
          token);
        if (got.status === 429) { rateLimited = true; break; }
        if (got.status === 400 && size > 10) {
          await supabase.from("sc_private_settings").upsert({ key: "spotify_albums_page_limit", value: "10" }, { onConflict: "key" });
          continue;
        }
        if (got.status === 404 || got.status === 400) {
          // Not a working Spotify profile: nothing to read for now.
          await supabase.rpc("sc_spotify_album_listed", { p_artist: work.artist_id, p_albums: [], p_next: null });
          continue;
        }
        if (!got.ok) break; // try again next run
        const items: any[] = got.body.items ?? [];
        const albums = items
          .filter((a) => a?.id && a.album_type !== "compilation")
          .map((a) => ({
            album_id: a.id,
            name: a.name ?? null,
            grp: (a.artists ?? []).some((x: any) => x?.id === sid) ? (a.album_type === "album" ? "album" : "single") : "appears_on",
          }));
        const next = got.body.next && items.length > 0 ? Number(work.offset) + items.length : null;
        const { data: res } = await supabase.rpc("sc_spotify_album_listed", { p_artist: work.artist_id, p_albums: albums, p_next: next });
        if (res?.added) releases.imported += res.added;
        releases.listed += albums.length;
      } else {
        const got = await spotifyGet(`https://api.spotify.com/v1/albums/${work.album_id}?market=GB`, token);
        if (got.status === 429) { rateLimited = true; break; }
        if (!got.ok && got.status !== 404) break; // try again next run
        const album = got.body ?? {};
        const tracks: any[] = [...(album.tracks?.items ?? [])];
        // Long releases (over 50 songs) come in pages.
        let more: string | null = album.tracks?.next ?? null;
        while (more && more.startsWith("https://api.spotify.com/") && calls < MAX_CALLS + 2) {
          if ((await spotifyTickets(1)) < 1) break;
          await breather();
          calls++;
          const page = await spotifyGet(more, token);
          if (!page.ok) break;
          tracks.push(...(page.body.items ?? []));
          more = page.body.next ?? null;
        }
        const { data: res } = await supabase.rpc("sc_spotify_album_save", {
          p_artist: work.artist_id, p_album_id: work.album_id, p_items: releaseItems(album, tracks, sid),
        });
        releases.read++;
        releases.matched += res?.matched ?? 0;
        releases.linksChecked += res?.verified ?? 0;
        if (res?.import?.added) releases.imported += res.import.added;
      }
    }

    // 2. Left-over calls: search song by song, for artists with no Spotify
    // profile (sc_spotify_match_next skips leaks, snippets and rumours).
    let matched = 0;
    let checked = 0;
    const room = Math.min(searchLimit, MAX_CALLS - calls);
    const { data: tracks, error } = room > 0 && !rateLimited
      ? await supabase.rpc("sc_spotify_match_next", { p_limit: room })
      : { data: [], error: null };
    if (error) throw error;
    const tickets = tracks?.length ? await spotifyTickets(tracks.length) : 0;
    let logged: ReturnType<typeof createClient> | null = null;

    for (const track of ((tracks ?? []) as unknown as TrackRow[]).slice(0, tickets)) {
      const artistName = track.artist || "";
      // The home artist plus anyone linked to the song (features, band members).
      const artistKeys = new Set(
        [artistName, ...(track.others ?? [])]
          .filter(Boolean)
          .map(norm)
      );
      const cleanedTitle = cleanTitle(track.title);
      const q = `track:${cleanedTitle} artist:${artistName}`;
      const searchUrl = `https://api.spotify.com/v1/search?type=track&limit=5&q=${encodeURIComponent(q)}`;
      if (calls > 0) await breather();
      calls++;
      const sres = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } });

      if (sres.status === 429) {
        rateLimited = true;
        // Spotify tells us the real wait time via this header -- use it
        // instead of guessing. Falls back to 30s only if it's missing.
        const header = sres.headers.get("Retry-After");
        retryAfterSeconds = header ? parseInt(header, 10) : 30;
        await pauseSpotify(retryAfterSeconds);
        break; // stop this batch, caller will retry after the given wait
      }
      if (sres.status === 401) { await dropSpotifyToken(); break; }
      if (!sres.ok) break; // try again next run
      checked++;

      const now = new Date().toISOString();
      const sdata = await sres.json();
      const items: any[] = sdata?.tracks?.items || [];

      // Only an exact title match by one of the song's own artists counts.
      // (Taking the top result regardless would link leaks to unrelated
      // official songs that happen to share a name.)
      const want = norm(cleanedTitle);
      const best = items.find(
        (i) => norm(i?.name || "") === want && (i?.artists || []).some((a: any) => artistKeys.has(norm(a?.name || "")))
      );
      const spotifyUrl: string | undefined = best?.external_urls?.spotify;

      if (spotifyUrl) {
        // Just seen on Spotify, so the link checker can leave it for a while.
        const update: Record<string, unknown> = { spotify_url: spotifyUrl, spotify_search_attempted_at: now, spotify_link_verified_at: now };
        // On Spotify means officially released.
        if (track.release_status !== "removed") update.release_status = "released";
        if (!track.album && best?.album?.name && best?.album?.album_type !== "compilation") update.album = best.album.name;
        if (!track.release_date && best?.album?.release_date_precision === "day") update.release_date = best.album.release_date;
        logged = logged ?? (await batchClient());
        await logged.from("tracks").update(update).eq("id", track.id);
        matched++;
      } else {
        // Nothing that's clearly this song -- still record that we checked
        // it, so it doesn't get re-searched again on every future run.
        await supabase.from("tracks").update({ spotify_search_attempted_at: now }).eq("id", track.id);
      }
    }

    return new Response(
      JSON.stringify({ done: false, calls, releases, checked, matched, rateLimited, retryAfterSeconds }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
