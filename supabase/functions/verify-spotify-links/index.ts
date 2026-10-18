// Supabase Edge Function: verify-spotify-links
//
// Separate from match-spotify: this one re-checks CONFIRMED links to catch
// ones that have gone dead over time (Spotify removes tracks for licensing,
// takedowns, etc). If a link is dead, it's cleared and the track becomes
// eligible for the regular matcher to find a replacement.
//
// Required secrets (same as match-spotify):
//   SPOTIFY_CLIENT_ID
//   SPOTIFY_CLIENT_SECRET

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

// Tickets from the shared Spotify allowance (sc_spotify_allow: 15 a minute,
// 3,000 a day across every job). Returns how many calls we may make.
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

function extractSpotifyTrackId(url: string): string | null {
  const match = url.match(/track\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

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
    const limit = Number(url.searchParams.get("limit") || "30");

    const paused = await spotifyPausedFor();
    if (paused > 0) {
      return new Response(
        JSON.stringify({ done: false, checked: 0, deadFound: 0, rateLimited: true, retryAfterSeconds: paused, paused: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: tracks, error } = await supabase
      .from("tracks")
      .select("id, spotify_url")
      .not("spotify_url", "is", null)
      .order("spotify_link_verified_at", { ascending: true, nullsFirst: true })
      .limit(limit);
    if (error) throw error;

    if (!tracks || tracks.length === 0) {
      return new Response(JSON.stringify({ done: true, checked: 0, deadFound: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // One ticket for the sign-in, one per song.
    const tickets = await spotifyTickets(tracks.length + 1);
    if (tickets < 2) {
      return new Response(
        JSON.stringify({ done: false, checked: 0, deadFound: 0, budget: "Spotify allowance used up for now; next run" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    tracks.splice(tickets - 1);

    let token: string;
    try {
      token = await getSpotifyToken();
    } catch (e: any) {
      if (e?.retryAfterSeconds) await pauseSpotify(e.retryAfterSeconds);
      return new Response(
        JSON.stringify({ done: false, checked: 0, deadFound: 0, rateLimited: true, retryAfterSeconds: e?.retryAfterSeconds || 60 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let checked = 0;
    let deadFound = 0;
    let rateLimited = false;
    let retryAfterSeconds = 0;

    for (const track of tracks) {
      const spotifyId = extractSpotifyTrackId(track.spotify_url);
      if (!spotifyId) {
        // Not a Spotify track link (an album, or another site): leave the link
        // alone but mark it checked, so it doesn't sit at the front of the
        // queue forever.
        await supabase.from("tracks").update({ spotify_link_verified_at: new Date().toISOString() }).eq("id", track.id);
        checked++;
        continue;
      }

      if (checked > 0) await breather();
      const res = await fetch(`https://api.spotify.com/v1/tracks/${spotifyId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 429) {
        rateLimited = true;
        const header = res.headers.get("Retry-After");
        retryAfterSeconds = header ? parseInt(header, 10) : 30;
        await pauseSpotify(retryAfterSeconds);
        break;
      }

      checked++;

      if (res.status === 200) {
        await supabase.from("tracks").update({ spotify_link_verified_at: new Date().toISOString() }).eq("id", track.id);
      } else if (res.status === 404) {
        // Dead -- clear the link and let the matcher find a replacement.
        await supabase
          .from("tracks")
          .update({ spotify_url: null, spotify_search_attempted_at: null, spotify_link_verified_at: null })
          .eq("id", track.id);
        deadFound++;
      } else {
        // Unexpected status (5xx, etc) -- don't touch it, try again next run.
      }
    }

    return new Response(
      JSON.stringify({ done: false, checked, deadFound, rateLimited, retryAfterSeconds }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
