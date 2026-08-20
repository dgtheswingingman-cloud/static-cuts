// Supabase Edge Function: find-possible-links
//
// For tracks with no confirmed spotify_url and no candidates yet, runs a
// general web search (Brave Search API) for "{artist} {title}" and stores
// the top few results as unverified "possible matches". This is purely an
// identification aid -- it does not attempt to find download/access links,
// and nothing it stores is treated as a real link on the site until a
// human reviews it and submits it through the normal correction/approval
// flow.
//
// Required secret (set via `supabase secrets set`):
//   BRAVE_API_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BRAVE_API_KEY = Deno.env.get("BRAVE_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Restrict results to sites actually likely to identify an unreleased
// track -- not the open web, which mostly returns irrelevant noise for
// underground/leaked material.
const MUSIC_SITES = ["genius.com", "soundcloud.com", "youtube.com", "bandcamp.com", "discogs.com"];
const SITE_FILTER = MUSIC_SITES.map((s) => `site:${s}`).join(" OR ");

function cleanTitle(title: string): string {
  return title.replace(/\*+$/, "").trim();
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") || "15");

    // Tracks with no confirmed link that haven't been searched yet.
    const { data: alreadySearched } = await supabase
      .from("track_link_candidates")
      .select("track_id");
    const searchedIds = new Set((alreadySearched ?? []).map((r: any) => r.track_id));

    const { data: candidateTracks, error } = await supabase
      .from("tracks")
      .select("id, title, artist_id, artists(name)")
      .is("spotify_url", null)
      .eq("is_official", false)
      .limit(limit * 3); // over-fetch since we filter already-searched client-side
    if (error) throw error;

    const tracks = (candidateTracks ?? []).filter((t: any) => !searchedIds.has(t.id)).slice(0, limit);

    if (tracks.length === 0) {
      return new Response(JSON.stringify({ done: true, checked: 0, found: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let checked = 0;
    let found = 0;
    let rateLimited = false;

    for (const track of tracks) {
      checked++;
      const artistName = (track as any).artists?.name || "";
      const q = `${artistName} ${cleanTitle(track.title)} (${SITE_FILTER})`;
      const searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=3`;

      const sres = await fetch(searchUrl, {
        headers: { Accept: "application/json", "X-Subscription-Token": BRAVE_API_KEY },
      });

      if (sres.status === 429) {
        rateLimited = true;
        break;
      }

      const sdata = await sres.json();
      const results = sdata?.web?.results ?? [];

      if (results.length === 0) {
        // No results at all -- still record that we searched, with zero
        // rows, by inserting a placeholder-free marker isn't possible with
        // this schema, so we just skip; next run will retry it. Fine at
        // this scale.
      } else {
        const rows = results.slice(0, 3).map((r: any) => ({
          track_id: track.id,
          artist_id: track.artist_id,
          url: r.url,
          title: r.title,
          source_domain: domainOf(r.url),
        }));
        const { error: insertErr } = await supabase.from("track_link_candidates").insert(rows);
        if (insertErr) {
          // Surface this instead of silently pretending it worked.
          return new Response(
            JSON.stringify({ error: "Database insert failed: " + insertErr.message, checked, found }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        found++;
      }

      // Brave's free tier is rate-limited per second -- pace requests.
      await new Promise((res) => setTimeout(res, 1100));
    }

    return new Response(JSON.stringify({ done: false, checked, found, rateLimited }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
