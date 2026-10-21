// Supabase Edge Function: artist-info
//
// Fills in artist pages' photo and short "about" text, a few artists at a
// time (timer twice an hour, followed artists first):
//   photo: from Spotify (one request covers up to 50 artists)
//   about: the short bio from Last.fm, with a link back (their text is
//          shared under Creative Commons). Skipped when Last.fm's page is
//          about several artists with the same name.
// Every call takes a ticket from that service's shared allowance.

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function paused(service: string) {
  const { data } = await db.from("sc_private_settings").select("value").eq("key", `${service}_pause_until`).maybeSingle();
  return !!(data?.value && Date.parse(data.value) > Date.now());
}

function cleanBio(html: string) {
  return html
    .replace(/<a [^>]*>Read more on Last\.fm<\/a>\.?/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);

  const { data: next, error } = await db.rpc("sc_artist_info_next", { p_secret: secret, p_limit: 8 });
  if (error) return json({ error: error.message }, 403);
  const artists = (next ?? []) as { artist_id: string; name: string; spotify_artist_id: string | null; lastfm_name: string | null; need_image: boolean; need_bio: boolean }[];
  if (artists.length === 0) return json({ ok: true, idle: true });

  const out: Record<string, Record<string, unknown>> = {};
  for (const a of artists) out[a.artist_id] = { artist_id: a.artist_id };

  // Photos from Spotify, all in one request.
  const ids = artists.filter((a) => a.need_image && a.spotify_artist_id).map((a) => a.spotify_artist_id as string);
  const cid = Deno.env.get("SPOTIFY_CLIENT_ID"), csec = Deno.env.get("SPOTIFY_CLIENT_SECRET");
  if (ids.length && cid && csec && !(await paused("spotify"))) {
    const { data: t1 } = await db.rpc("sc_spotify_allow", { p_want: 2 });
    if (t1 === 2) {
      const tok = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${cid}:${csec}`) },
        body: "grant_type=client_credentials",
      });
      const token = tok.ok ? (await tok.json())?.access_token : null;
      if (token) {
        const res = await fetch(`https://api.spotify.com/v1/artists?ids=${ids.slice(0, 50).join(",")}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 429) {
          const wait = parseInt(res.headers.get("Retry-After") || "60", 10);
          await db.from("sc_private_settings").upsert({ key: "spotify_pause_until", value: new Date(Date.now() + Math.max(wait, 600) * 1000).toISOString() }, { onConflict: "key" });
        } else if (res.ok) {
          const body = await res.json();
          for (const sa of (body?.artists ?? []) as any[]) {
            if (!sa) continue;
            const imgs = ((sa.images ?? []) as { url: string; width: number }[]).sort((x, y) => (x.width ?? 0) - (y.width ?? 0));
            const pick = imgs.find((i) => (i.width ?? 0) >= 300) ?? imgs[imgs.length - 1];
            const ours = artists.find((a) => a.spotify_artist_id === sa.id);
            if (ours && pick?.url) out[ours.artist_id].image_url = pick.url;
          }
        }
      }
    }
  }

  // About text from Last.fm, one artist at a time.
  const key = Deno.env.get("LASTFM_API_KEY");
  if (key && !(await paused("lastfm"))) {
    for (const a of artists.filter((x) => x.need_bio)) {
      const { data: ok } = await db.rpc("sc_api_allow", { p_service: "lastfm", p_want: 1 });
      if (ok !== 1) break;
      const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&autocorrect=1&artist=${encodeURIComponent(a.lastfm_name || a.name)}&api_key=${key}&format=json`);
      await sleep(1000);
      if (!res.ok) continue;
      const body = await res.json();
      if (body?.error === 29) break; // Last.fm says slow down
      const bio = cleanBio(String(body?.artist?.bio?.summary ?? ""));
      if (bio.length < 40 || /there (are|is) (more than one|multiple|at least|several)/i.test(bio)) continue;
      out[a.artist_id].bio = bio.slice(0, 1500);
      out[a.artist_id].bio_source = "Last.fm";
      out[a.artist_id].bio_source_url = body?.artist?.url ?? null;
    }
  }

  const { data: saved } = await db.rpc("sc_artist_info_save", { p_secret: secret, p_items: Object.values(out) });
  return json({ ok: true, saved, photos: Object.values(out).filter((o) => o.image_url).length, abouts: Object.values(out).filter((o) => o.bio).length });
});
