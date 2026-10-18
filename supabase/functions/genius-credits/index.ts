// Supabase Edge Function: genius-credits
//
// Fills empty producer, featured-artist, release-date and artwork fields from
// Genius, a few songs at a time (see 20261019190000_genius_credits.sql).
// Called by a database timer every 10 minutes: up to 15 songs, about 2
// seconds between Genius requests, stops if Genius asks it to slow down.
// Only confident matches are used: the title must match and the artist must
// be the song's main artist or one of its featured artists.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const pause = () => new Promise((r) => setTimeout(r, 2000));

class SlowDown extends Error {}

// Lower-case letters and digits only, without feat./prod. notes or brackets.
function key(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/\s*[([]\s*(feat|ft|prod|with)\b[^)\]]*[)\]]/g, "")
    .replace(/\s+(feat|ft)\.?\s.*$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

async function genius(path: string, token: string) {
  const res = await fetch(`https://api.genius.com${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) throw new SlowDown();
  if (!res.ok) return null;
  return (await res.json())?.response ?? null;
}

type Todo = { track_id: string; title: string; artist: string; genius_artist_id: string | null; genius_song_id: number | null };

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);
  const token = Deno.env.get("GENIUS_ACCESS_TOKEN");
  if (!token) return json({ error: "GENIUS_ACCESS_TOKEN isn't set" }, 500);

  const { data: todo, error } = await db.rpc("sc_genius_credit_next", { p_secret: secret, p_limit: 15 });
  if (error) return json({ error: error.message }, 403);

  const results: Record<string, unknown>[] = [];
  let stopped: string | null = null;
  try {
    for (const t of (todo ?? []) as Todo[]) {
      let id = t.genius_song_id;
      if (!id) {
        const q = `${t.title.replace(/[([].*?[)\]]/g, " ")} ${t.artist}`.replace(/\s+/g, " ").trim();
        const s = await genius(`/search?per_page=10&q=${encodeURIComponent(q)}`, token);
        await pause();
        const want = key(t.title);
        const artistId = t.genius_artist_id && /^\d+$/.test(t.genius_artist_id) ? Number(t.genius_artist_id) : null;
        const hit = (s?.hits ?? []).map((h: any) => h.result).find((r: any) =>
          r && key(r.title) === want &&
          ((artistId && (r.primary_artist?.id === artistId || (r.featured_artists ?? []).some((a: any) => a.id === artistId))) ||
           key(r.primary_artist?.name) === key(t.artist) ||
           (r.featured_artists ?? []).some((a: any) => key(a.name) === key(t.artist))));
        if (!hit) { results.push({ track_id: t.track_id }); continue; }
        id = hit.id;
      }
      const song = (await genius(`/songs/${id}?text_format=plain`, token))?.song;
      await pause();
      if (!song) { results.push({ track_id: t.track_id }); continue; }
      const c = song.release_date_components;
      results.push({
        track_id: t.track_id,
        genius_song_id: song.id,
        producers: (song.producer_artists ?? []).map((a: any) => a.name).join(", ") || null,
        featuring: (song.featured_artists ?? []).map((a: any) => a.name).join(", ") || null,
        release_date: c?.year && c?.month && c?.day
          ? `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}` : null,
        cover_url: song.song_art_image_thumbnail_url && !/default_cover/.test(song.song_art_image_thumbnail_url)
          ? song.song_art_image_thumbnail_url : null,
      });
    }
  } catch (e) {
    if (e instanceof SlowDown) stopped = "Genius asked to slow down";
    else stopped = String((e as Error)?.message ?? e);
  }

  const { data: saved, error: saveErr } = await db.rpc("sc_genius_credit_save", { p_secret: secret, p_items: results });
  if (saveErr) return json({ error: saveErr.message }, 500);
  return json({ ok: true, checked: results.length, matched: saved, stopped });
});
