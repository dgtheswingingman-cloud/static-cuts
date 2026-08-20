// Supabase Edge Function: match-spotify
//
// Finds tracks with no confirmed spotify_url, searches the real Spotify Web
// API (Client Credentials flow -- no user login needed), and writes back a
// confirmed link when it finds a good match. Run repeatedly (see the loop
// script) until every track has been checked.
//
// Required secrets (set via `supabase secrets set`):
//   SPOTIFY_CLIENT_ID
//   SPOTIFY_CLIENT_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically by
// Supabase for every Edge Function -- you don't need to set those yourself.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SPOTIFY_CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID")!;
const SPOTIFY_CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") || "50");

    const { data: tracks, error } = await supabase
      .from("tracks")
      .select("id, title, artist_id, artists(name)")
      .is("spotify_url", null)
      .is("spotify_search_attempted_at", null)
      .eq("is_official", true)
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
    let matched = 0;
    let checked = 0;
    let rateLimited = false;
    let retryAfterSeconds = 0;

    for (const track of tracks) {
      checked++;
      const artistName = (track as any).artists?.name || "";
      const cleanedTitle = cleanTitle(track.title);
      const q = `track:${cleanedTitle} artist:${artistName}`;
      const searchUrl = `https://api.spotify.com/v1/search?type=track&limit=3&q=${encodeURIComponent(q)}`;
      const sres = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } });

      if (sres.status === 429) {
        rateLimited = true;
        // Spotify tells us the real wait time via this header -- use it
        // instead of guessing. Falls back to 30s only if it's missing.
        const header = sres.headers.get("Retry-After");
        retryAfterSeconds = header ? parseInt(header, 10) : 30;
        break; // stop this batch, caller will retry after the given wait
      }

      const sdata = await sres.json();
      const items = sdata?.tracks?.items || [];
      if (items.length > 0) {
        // Prefer an exact (case-insensitive) title match; otherwise take the top result.
        const best =
          items.find((i: any) => i.name.toLowerCase() === cleanedTitle.toLowerCase()) || items[0];
        const spotifyUrl = best?.external_urls?.spotify;
        if (spotifyUrl) {
          await supabase.from("tracks").update({ spotify_url: spotifyUrl, spotify_search_attempted_at: new Date().toISOString() }).eq("id", track.id);
          matched++;
        } else {
          await supabase.from("tracks").update({ spotify_search_attempted_at: new Date().toISOString() }).eq("id", track.id);
        }
      } else {
        // No results at all -- still record that we checked it, so it
        // doesn't get re-searched again on every future run.
        await supabase.from("tracks").update({ spotify_search_attempted_at: new Date().toISOString() }).eq("id", track.id);
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
