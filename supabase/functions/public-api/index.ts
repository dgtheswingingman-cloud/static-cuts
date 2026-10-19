// Supabase Edge Function: public-api
//
// Read-only access to the archive for other fan sites and bots, with a key
// the admin hands out (Admin → API keys). Every key has its own limits
// (default 60 calls a minute, 5,000 a day). Answers credit Static Cuts.
//
//   GET ?path=/artists                         every artist
//   GET ?path=/artists/<id>                    one artist with all its songs
//   GET ?path=/songs/<id>                      one song with its versions
//   GET ?path=/search&q=<words>                songs matching the words
// Send the key as the "x-api-key" header.

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

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { global: { fetch: steadyFetch } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-api-key, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const CREDIT = { source: "Static Cuts// (static-cuts.com)", note: "Please credit and link Static Cuts when you use this data." };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(status < 400 ? { ...CREDIT, ...(body as object) } : body), {
    status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
  });
}

const SONG_FIELDS = "id, title, artist_id, parent_track_id, release_status, album, track_number, release_date, leak_date, producers, featured_artists, aliases, spotify_url, cover_url";
const page = (id: string) => `https://static-cuts.com/song/${id}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Read-only: use GET." }, 405);

  const { data: check } = await db.rpc("sc_api_key_check", { p_key: req.headers.get("x-api-key") ?? "" });
  if (!check || check.error === "bad_key") return json({ error: "Missing or unknown API key. Ask the Static Cuts admin for one." }, 401);
  if (check.error === "rate_limited") return json({ error: "Too many calls. Slow down and try again in a minute." }, 429);

  const url = new URL(req.url);
  const path = (url.searchParams.get("path") ?? "/").replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean);

  try {
    if (parts[0] === "artists" && parts.length === 1) {
      const { data } = await db.from("artists").select("id, name").order("name");
      return json({ artists: (data ?? []).map((a) => ({ ...a, url: `https://static-cuts.com/artist/${a.id}` })) });
    }
    if (parts[0] === "artists" && parts.length === 2) {
      const { data: artist } = await db.from("artists").select("id, name").eq("id", parts[1]).maybeSingle();
      if (!artist) return json({ error: "No artist with that id." }, 404);
      const songs: unknown[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await db.from("tracks").select(SONG_FIELDS).eq("artist_id", artist.id).order("id").range(from, from + 999);
        songs.push(...(data ?? []).map((t: any) => ({ ...t, url: page(t.id) })));
        if (!data || data.length < 1000) break;
      }
      return json({ artist: { ...artist, url: `https://static-cuts.com/artist/${artist.id}` }, songs });
    }
    if (parts[0] === "songs" && parts.length === 2) {
      const { data: song } = await db.from("tracks").select(SONG_FIELDS).eq("id", parts[1]).maybeSingle();
      if (!song) return json({ error: "No song with that id." }, 404);
      const main = song.parent_track_id ?? song.id;
      const { data: versions } = await db.from("tracks").select(SONG_FIELDS).or(`id.eq.${main},parent_track_id.eq.${main}`);
      return json({ song: { ...song, url: page(song.id) }, versions: (versions ?? []).filter((v: any) => v.id !== song.id).map((v: any) => ({ ...v, url: page(v.id) })) });
    }
    if (parts[0] === "search") {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (q.length < 2) return json({ error: "Add ?q= with at least 2 letters." }, 400);
      const { data, error } = await db.rpc("rpc_search_songs", { p_q: q });
      if (error) throw error;
      return json({ total: data?.total ?? 0, songs: (data?.items ?? []).map((s: any) => ({ ...s, url: page(s.id) })) });
    }
    return json({ error: "Unknown path. Try ?path=/artists, /artists/<id>, /songs/<id> or /search&q=…" }, 404);
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
