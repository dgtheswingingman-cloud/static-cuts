// Supabase Edge Function: genius-credits
//
// Fills empty producer, featured-artist, songwriter, release-date, album and
// artwork fields from Genius, and saves samples / interpolations / remixes /
// covers between songs, a few songs at a time (see 20261019190000_genius_credits.sql).
// The timer runs every minute. Owner's pace setting (sc_genius_pace):
//   normal: every 10 minutes, up to 15 songs, 1.5 seconds between requests
//   max ("extreme"): every minute, three workers for up to 50 seconds, with
//        the site paused for everyone else; ends after 3 hours or when
//        every song has been checked (sc_genius_extreme_done)
// If Genius says "too many requests" it pauses (10 minutes or what Genius
// asks) and drops back to normal by itself (sc_genius_slowed).
// Only confident matches are used: the title must match and the artist must
// be the song's main artist or one of its featured artists.

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
let gapMs = 2000;
const pause = () => new Promise((r) => setTimeout(r, gapMs));
const PACES: Record<string, { workers: number; songs: number; gap: number; seconds: number }> = {
  normal: { workers: 1, songs: 15, gap: 1500, seconds: 50 },
  max: { workers: 3, songs: 300, gap: 300, seconds: 50 },
};

// Genius song relations kept (the rest, like translations, aren't useful here).
const RELATIONS = new Set(["samples", "sampled_in", "interpolates", "interpolated_by", "remix_of", "remixed_by", "cover_of", "covered_by"]);

class SlowDown extends Error {}

// Lower-case letters and digits only, without feat./prod. notes or brackets.
function key(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/\s*[([]\s*(feat|ft|prod|with)\b[^)\]]*[)\]]/g, "")
    .replace(/\s+(feat|ft)\.?\s.*$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

class OutOfTickets extends Error {}

// Every Genius call takes a ticket from the shared Genius allowance
// (sc_api_allow), so this and the Genius imports together stay under the
// limit. No ticket: stop and carry on next run.
async function ticket() {
  const { data: pause } = await db.from("sc_private_settings").select("value").eq("key", "genius_pause_until").maybeSingle();
  if (pause?.value && Date.parse(pause.value) > Date.now()) throw new OutOfTickets("Genius has asked us to pause");
  const { data, error } = await db.rpc("sc_api_allow", { p_service: "genius", p_want: 1 });
  if (error) return; // allowance not set up yet: keep the usual gentle pace
  if (data !== 1) throw new OutOfTickets("Genius allowance used up for now");
}

async function genius(path: string, token: string) {
  await ticket();
  const res = await fetch(`https://api.genius.com${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) {
    const wait = parseInt(res.headers.get("Retry-After") || "600", 10);
    const until = new Date(Date.now() + Math.max(wait, 600) * 1000).toISOString();
    await db.from("sc_private_settings").upsert({ key: "genius_pause_until", value: until }, { onConflict: "key" });
    throw new SlowDown();
  }
  if (!res.ok) return null;
  return (await res.json())?.response ?? null;
}

type Todo = { track_id: string; title: string; artist: string; genius_artist_id: string | null; genius_song_id: number | null };

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);
  const token = Deno.env.get("GENIUS_ACCESS_TOKEN");
  if (!token) return json({ error: "GENIUS_ACCESS_TOKEN isn't set" }, 500);

  const { data: paceName } = await db.rpc("sc_genius_pace", { p_secret: secret });
  const paceKey = typeof paceName === "string" && PACES[paceName] ? paceName : "normal";
  // Normal pace: every 10 minutes (at :06, :16, …).
  if (paceKey === "normal" && new Date().getUTCMinutes() % 10 !== 6) return json({ ok: true, skipped: "normal pace" });
  const pace = PACES[paceKey];
  gapMs = pace.gap;
  const started = Date.now();

  const { data: todo, error } = await db.rpc("sc_genius_credit_next", { p_secret: secret, p_limit: pace.songs });
  if (error) return json({ error: error.message }, 403);
  const queue = [...((todo ?? []) as Todo[])];
  // Extreme with nothing left to check: back to normal, site comes back.
  if (queue.length === 0 && paceKey === "max") {
    await db.rpc("sc_genius_extreme_done", { p_secret: secret });
    return json({ ok: true, pace: paceKey, checked: 0, finished: true });
  }

  const results: Record<string, unknown>[] = [];
  let stopped: string | null = null;
  let slowed = false;
  let saved = 0;
  // Saved as it goes, so a run cut short keeps what it found.
  async function flush() {
    if (results.length === 0) return;
    const batch = results.splice(0, results.length);
    const { data } = await db.rpc("sc_genius_credit_save", { p_secret: secret, p_items: batch });
    saved += (data as number) ?? 0;
  }

  async function one(t: Todo) {

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
      if (!hit) { results.push({ track_id: t.track_id }); return; }
      id = hit.id;
    }
    const song = (await genius(`/songs/${id}?text_format=plain`, token))?.song;
    await pause();
    // Gone from Genius: noted (writers: "") so it isn't asked for again.
    if (!song) { results.push({ track_id: t.track_id, writers: "" }); return; }
    const c = song.release_date_components;
    results.push({
      track_id: t.track_id,
      genius_song_id: song.id,
      producers: (song.producer_artists ?? []).map((a: any) => a.name).join(", ") || null,
      featuring: (song.featured_artists ?? []).map((a: any) => a.name).join(", ") || null,
      release_date: c?.year && c?.month && c?.day
        ? `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}` : null,
      // Full-size art (was the 300px thumbnail).
      cover_url: [song.song_art_image_url, song.song_art_image_thumbnail_url]
        .find((u: string | null | undefined) => u && !/default_cover/.test(u)) ?? null,
      writers: (song.writer_artists ?? []).map((a: any) => a.name).join(", ") || "",
      album: song.album?.name ?? null,
      // Samples, interpolations, remixes and covers, both ways.
      relations: ((song.song_relationships ?? []) as any[])
        .filter((r) => RELATIONS.has(r.relationship_type ?? r.type))
        .flatMap((r) => ((r.songs ?? []) as any[]).slice(0, 25).map((x) => ({
          kind: r.relationship_type ?? r.type, id: x.id, title: x.title, artist: x.primary_artist?.name ?? x.artist_names ?? null, url: x.url ?? null,
        }))),
    });
  }

  async function worker() {
    while (!stopped && queue.length && Date.now() - started < pace.seconds * 1000) {
      const t = queue.shift()!;
      try {
        await one(t);
      } catch (e) {
        if (e instanceof SlowDown) { stopped = "Genius asked to slow down"; slowed = true; }
        else if (e instanceof OutOfTickets) stopped = e.message;
        else stopped = String((e as Error)?.message ?? e);
      }
      if (results.length >= 10) await flush();
    }
  }
  await Promise.all(Array.from({ length: pace.workers }, () => worker()));
  await flush();
  let pacedDown: string | null = null;
  if (slowed && paceKey !== "normal") {
    const { data: np } = await db.rpc("sc_genius_slowed", { p_secret: secret });
    pacedDown = (np as string) ?? null;
  }
  return json({ ok: true, pace: paceKey, checked: (todo ?? []).length - queue.length, matched: saved, stopped, paced_down: pacedDown });
});
