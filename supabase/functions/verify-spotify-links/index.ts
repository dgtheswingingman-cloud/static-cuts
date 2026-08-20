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

function extractSpotifyTrackId(url: string): string | null {
  const match = url.match(/track\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") || "30");

    const { data: tracks, error } = await supabase
      .from("tracks")
      .select("id, spotify_url")
      .not("spotify_url", "is", null)
      .order("spotify_link_verified_at", { ascending: true, nullsFirst: true })
      .limit(limit);
    if (error) throw error;

    if (!tracks || tracks.length === 0) {
      return new Response(JSON.stringify({ done: true, checked: 0, deadFound: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    let token: string;
    try {
      token = await getSpotifyToken();
    } catch (e: any) {
      return new Response(
        JSON.stringify({ done: false, checked: 0, deadFound: 0, rateLimited: true, retryAfterSeconds: e?.retryAfterSeconds || 60 }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    let checked = 0;
    let deadFound = 0;
    let rateLimited = false;
    let retryAfterSeconds = 0;

    for (const track of tracks) {
      const spotifyId = extractSpotifyTrackId(track.spotify_url);
      if (!spotifyId) {
        // Malformed/unexpected URL format -- skip it, don't touch it.
        checked++;
        continue;
      }

      const res = await fetch(`https://api.spotify.com/v1/tracks/${spotifyId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 429) {
        rateLimited = true;
        const header = res.headers.get("Retry-After");
        retryAfterSeconds = header ? parseInt(header, 10) : 30;
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
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
