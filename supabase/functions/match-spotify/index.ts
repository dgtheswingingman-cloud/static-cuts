// Supabase Edge Function: match-spotify
//
// Finds tracks with no confirmed spotify_url, searches the real Spotify Web
// API (Client Credentials flow -- no user login needed), and when it finds
// the same song by the same artist writes back the link, marks the song as
// released and fills in its album and release date if missing. Run by a
// timer (10 songs every 5 minutes) and by the link tools page.
//
// Required secrets (set via `supabase secrets set`):
//   SPOTIFY_CLIENT_ID
//   SPOTIFY_CLIENT_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically by
// Supabase for every Edge Function -- you don't need to set those yourself.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SPOTIFY_CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID")!;
const SPOTIFY_CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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

// Only the timer (x-cron-secret) and the signed-in admin (link tools page)
// may run this; anyone else could burn our Spotify allowance.
const ADMIN_EMAIL = "dg.theswingingman@gmail.com";
async function allowed(req: Request): Promise<boolean> {
  const secret = req.headers.get("x-cron-secret");
  if (secret) {
    const { data } = await supabase.from("sc_private_settings").select("value").eq("key", "cron_secret").maybeSingle();
    return !!data?.value && data.value === secret;
  }
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data: who } = await supabase.auth.getUser(jwt);
  return who?.user?.email === ADMIN_EMAIL;
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
    global: { headers: { "x-sc-batch": String(batchId) } },
  });
}

async function getSpotifyToken(): Promise<string> {
  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`),
    },
    body: "grant_type=client_credentials",
  });
  if (resp.status === 429) {
    const header = resp.headers.get("Retry-After");
    const err: any = new Error("Spotify token endpoint rate limited");
    err.retryAfterSeconds = header ? parseInt(header, 10) : 60;
    throw err;
  }
  const data = await resp.json();
  if (!resp.ok) throw new Error("Spotify token error: " + JSON.stringify(data));
  return data.access_token as string;
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

type TrackRow = {
  id: string;
  title: string;
  release_status: string | null;
  album: string | null;
  release_date: string | null;
  artists: { name: string } | null;
  track_appearances: { artists: { name: string } | null }[] | null;
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
    const limit = Number(url.searchParams.get("limit") || "50");

    const paused = await spotifyPausedFor();
    if (paused > 0) {
      return new Response(
        JSON.stringify({ done: false, checked: 0, matched: 0, rateLimited: true, retryAfterSeconds: paused, paused: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Every track without a link that hasn't been searched yet -- not just
    // ones already marked official, since most official songs in the
    // archive aren't marked yet. Main songs first, versions after.
    const { data: tracks, error } = await supabase
      .from("tracks")
      .select("id, title, release_status, album, release_date, artists!artist_id(name), track_appearances(artists(name))")
      .is("spotify_url", null)
      .is("spotify_search_attempted_at", null)
      .order("parent_track_id", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .limit(limit);
    if (error) throw error;

    if (!tracks || tracks.length === 0) {
      return new Response(JSON.stringify({ done: true, checked: 0, matched: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let token: string;
    try {
      token = await getSpotifyToken();
    } catch (e: any) {
      if (e?.retryAfterSeconds) await pauseSpotify(e.retryAfterSeconds);
      // The token endpoint has its own separate rate limit -- if we're
      // being throttled there too, report it the same way as a search
      // rate limit so the caller backs off properly instead of erroring out.
      return new Response(
        JSON.stringify({
          done: false,
          checked: 0,
          matched: 0,
          rateLimited: true,
          retryAfterSeconds: e?.retryAfterSeconds || 60,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    let logged: ReturnType<typeof createClient> | null = null;
    let matched = 0;
    let checked = 0;
    let rateLimited = false;
    let retryAfterSeconds = 0;

    for (const track of tracks as unknown as TrackRow[]) {
      const artistName = track.artists?.name || "";
      // The home artist plus anyone linked to the song (features, band members).
      const artistKeys = new Set(
        [artistName, ...(track.track_appearances ?? []).map((a) => a.artists?.name || "")]
          .filter(Boolean)
          .map(norm)
      );
      const cleanedTitle = cleanTitle(track.title);
      const q = `track:${cleanedTitle} artist:${artistName}`;
      const searchUrl = `https://api.spotify.com/v1/search?type=track&limit=5&q=${encodeURIComponent(q)}`;
      if (checked > 0) await breather();
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
        const update: Record<string, unknown> = { spotify_url: spotifyUrl, spotify_search_attempted_at: now };
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
      JSON.stringify({ done: false, checked, matched, rateLimited, retryAfterSeconds }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
