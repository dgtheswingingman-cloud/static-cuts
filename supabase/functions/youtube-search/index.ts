// Supabase Edge Function: youtube-search
//
// Looks on YouTube for songs that have no listen link, one song per run
// (timer every 15 minutes; YouTube allows about 100 searches a day free).
// Videos whose title has the song's name and whose title or channel has the
// artist's name go to the song's possible links for review, never straight
// onto the song. Official channels ("Artist", "Artist - Topic", VEVO) are
// marked as such.
//
// Secret (Edge Functions > Secrets): YOUTUBE_API_KEY. Without it the timer
// does nothing.

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
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function norm(s: string) {
  return (s || "").toLowerCase()
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s*[([]\s*(feat|ft|featuring|with|prod)\b[^)\]]*[)\]]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);
  const key = Deno.env.get("YOUTUBE_API_KEY");
  if (!key) return json({ ok: true, idle: "no YouTube key yet" });

  const { data: next, error } = await db.rpc("sc_youtube_next", { p_secret: secret, p_limit: 1 });
  if (error) return json({ error: error.message }, 403);
  const songs = (next ?? []) as { track_id: string; title: string; artist: string }[];
  if (songs.length === 0) return json({ ok: true, idle: "nothing to look for" });

  const results: unknown[] = [];
  for (const s of songs) {
    // A ticket from the YouTube search allowance (1 a minute, 90 a day).
    const { data: ok } = await db.rpc("sc_api_allow", { p_service: "ytsearch", p_want: 1 });
    if (ok !== 1) return json({ ok: true, stopped: "YouTube search allowance used up for now", results });

    const q = `${s.artist} ${s.title}`;
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=8&q=${encodeURIComponent(q)}&key=${key}`);
    if (res.status === 403 || res.status === 429) {
      // Out of YouTube's daily allowance (or asked to slow down): stop until tomorrow.
      const until = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
      await db.from("sc_private_settings").upsert({ key: "ytsearch_pause_until", value: until }, { onConflict: "key" });
      return json({ ok: true, stopped: `YouTube said ${res.status}; paused for 12 hours`, results });
    }
    if (!res.ok) return json({ error: `YouTube returned ${res.status}` }, 500);
    const body = await res.json();

    const song = norm(s.title), artist = norm(s.artist);
    const items = ((body?.items ?? []) as any[]).map((v) => {
      const title = String(v?.snippet?.title ?? "");
      const channel = String(v?.snippet?.channelTitle ?? "");
      const t = norm(title), c = norm(channel);
      const official = c === artist || c === artist + "topic" || (c.includes(artist) && c.includes("vevo"));
      const matches = song.length > 0 && t.includes(song) && (t.includes(artist) || c.includes(artist));
      return { id: v?.id?.videoId as string, title, channel, official, matches };
    }).filter((v) => v.id && v.matches)
      .sort((a, b) => Number(b.official) - Number(a.official))
      .slice(0, 2)
      .map((v) => ({
        url: `https://www.youtube.com/watch?v=${v.id}`,
        title: v.title,
        official: v.official,
        confidence: v.official ? 0.9 : 0.6,
        notes: `YouTube search: "${v.title}" on ${v.channel}${v.official ? " (the artist's own channel)" : ""}`,
      }));

    const { data: saved } = await db.rpc("sc_youtube_save", { p_secret: secret, p_track_id: s.track_id, p_items: items });
    results.push({ song: `${s.artist} - ${s.title}`, found: saved ?? 0 });
  }
  return json({ ok: true, results });
});
