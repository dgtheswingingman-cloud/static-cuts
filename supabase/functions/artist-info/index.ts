// Supabase Edge Function: artist-info
//
// Fills in artist pages' photo and short "about" text, a few artists at a
// time (timer twice an hour, followed artists first):
//   photo: from Spotify (one artist per request), or Genius if Spotify has none
//   about: the short bio from Last.fm, with a link back (their text is
//          shared under Creative Commons). Skipped when Last.fm's page is
//          about several artists with the same name.
//   genres: Last.fm's top tags for up to 30 artists a run (junk like "seen
//          live" left out), plus their "similar artists" list
//   Spotify link: for up to 4 artists without one, from one of their songs'
//          Spotify links, or a search accepted only when exactly one
//          Spotify artist has that name
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

// Last.fm tags are whatever listeners typed. Keep the ones that are genres.
const JUNK = /seen live|favou?rite|^\d{2,4}s?$|\bbest\b|\blove\b|awesome|albums i own|under \d|beautiful|\bcool\b|sexy|amazing|check ?out|spotify|vocalists?|^(all|male|female|usa?|uk|american|british|english|swedish|canadian|german|french|australian|new york|atlanta|chicago|california|london|florida|texas|memphis|houston|los angeles|philadelphia|detroit|black|white|soundcloud|youtube|tiktok|music|artist|singer|rapper|producer|dj|band|other|misc|unknown|my music|instrumental|good|cute|sad|chill|hype)$/i;
const FIXED: Record<string, string> = {
  "hip hop": "Hip-Hop", "hip-hop": "Hip-Hop", "hiphop": "Hip-Hop", "rnb": "R&B", "r&b": "R&B", "r and b": "R&B",
  "rhythm and blues": "R&B", "contemporary r&b": "Contemporary R&B", "edm": "EDM", "idm": "IDM", "uk drill": "UK Drill",
  "uk garage": "UK Garage", "uk hip hop": "UK Hip-Hop", "uk rap": "UK Rap", "lo-fi": "Lo-Fi", "lofi": "Lo-Fi", "emo": "Emo",
};
function tidyTag(raw: string, artistName: string): string | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (t.length < 2 || t.length > 30 || JUNK.test(t)) return null;
  const plain = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (plain(t) === plain(artistName)) return null;
  if (FIXED[t]) return FIXED[t];
  return t.replace(/(^|[\s-])([a-z])/g, (_m, sep, c) => sep + c.toUpperCase()).replace(/\bUk\b/g, "UK").replace(/\bUs\b/g, "US").replace(/\bHip Hop\b/g, "Hip-Hop");
}

function cleanBio(html: string) {
  return html
    .replace(/<a [^>]*>Read more on Last\.fm<\/a>\.?/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// One Spotify sign-in lasts an hour, so it's kept and shared by every
// Spotify job instead of signing in again each run (each sign-in takes a
// ticket). Returns null when there's no ticket for a new one right now.
async function cachedSpotifyToken(): Promise<string | null> {
  const { data: rows } = await db.from("sc_private_settings").select("key, value")
    .in("key", ["spotify_token", "spotify_token_expires"]);
  const saved = Object.fromEntries(((rows ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  if (saved.spotify_token && Date.parse(saved.spotify_token_expires ?? "") > Date.now() + 5 * 60_000) return saved.spotify_token;
  const id = Deno.env.get("SPOTIFY_CLIENT_ID"), secret = Deno.env.get("SPOTIFY_CLIENT_SECRET");
  if (!id || !secret) return null;
  const { data: t } = await db.rpc("sc_spotify_allow", { p_want: 1 });
  if (t !== 1) return null;
  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${id}:${secret}`) },
    body: "grant_type=client_credentials",
  });
  if (resp.status === 429) {
    const wait = Math.max(parseInt(resp.headers.get("Retry-After") || "60", 10) || 60, 600);
    await db.from("sc_private_settings").upsert({ key: "spotify_pause_until", value: new Date(Date.now() + wait * 1000).toISOString() }, { onConflict: "key" });
    return null;
  }
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.access_token) return null;
  await db.from("sc_private_settings").upsert([
    { key: "spotify_token", value: data.access_token },
    { key: "spotify_token_expires", value: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString() },
  ], { onConflict: "key" });
  return data.access_token as string;
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);

  const { data: next, error } = await db.rpc("sc_artist_info_next", { p_secret: secret, p_limit: 8 });
  if (error) return json({ error: error.message }, 403);
  const artists = (next ?? []) as { artist_id: string; name: string; spotify_artist_id: string | null; lastfm_name: string | null; need_image: boolean; need_bio: boolean }[];

  const out: Record<string, Record<string, unknown>> = {};
  for (const a of artists) out[a.artist_id] = { artist_id: a.artist_id };

  // Photos: Spotify first, one artist per request (Spotify no longer allows
  // asking for several artists at once for apps like ours), then Genius for
  // any still without one. Each request takes a ticket.
  const needPhoto = artists.filter((a) => a.need_image);
  if (needPhoto.some((a) => a.spotify_artist_id) && !(await paused("spotify"))) {
    const token = await cachedSpotifyToken();
    for (const a of needPhoto.filter((x) => x.spotify_artist_id)) {
      if (!token) break;
      const { data: t } = await db.rpc("sc_spotify_allow", { p_want: 1 });
      if (t !== 1) break;
      const res = await fetch(`https://api.spotify.com/v1/artists/${a.spotify_artist_id}`, { headers: { Authorization: `Bearer ${token}` } });
      await sleep(1500);
      if (res.status === 429) {
        const wait = parseInt(res.headers.get("Retry-After") || "60", 10);
        await db.from("sc_private_settings").upsert({ key: "spotify_pause_until", value: new Date(Date.now() + Math.max(wait, 600) * 1000).toISOString() }, { onConflict: "key" });
        break;
      }
      if (!res.ok) continue;
      const sa = await res.json();
      const imgs = ((sa?.images ?? []) as { url: string; width: number }[]).sort((x, y) => (x.width ?? 0) - (y.width ?? 0));
      const pick = imgs.find((i) => (i.width ?? 0) >= 300) ?? imgs[imgs.length - 1];
      if (pick?.url) out[a.artist_id].image_url = pick.url;
    }
  }
  const gtoken = Deno.env.get("GENIUS_ACCESS_TOKEN");
  const stillNone = needPhoto.filter((a) => !out[a.artist_id].image_url);
  if (stillNone.length && gtoken && !(await paused("genius"))) {
    const { data: rows } = await db.from("artists").select("id, genius_artist_id").in("id", stillNone.map((a) => a.artist_id));
    for (const r of (rows ?? []) as { id: string; genius_artist_id: string | null }[]) {
      if (!r.genius_artist_id || !/^\d+$/.test(r.genius_artist_id)) continue;
      const { data: t, error: te } = await db.rpc("sc_api_allow", { p_service: "genius", p_want: 1 });
      if (!te && t !== 1) break;
      const res = await fetch(`https://api.genius.com/artists/${r.genius_artist_id}`, { headers: { Authorization: `Bearer ${gtoken}` } });
      await sleep(1000);
      if (!res.ok) continue;
      const url = (await res.json())?.response?.artist?.image_url as string | undefined;
      // Genius uses a placeholder picture for artists without a photo.
      if (url && !/default_avatar|placeholder/i.test(url)) out[r.id].image_url = url;
    }
  }

  // Spotify links for artists without one (their releases can then be read).
  const { data: look } = await db.rpc("sc_spotify_lookup_next", { p_secret: secret, p_limit: 4 });
  const lookups: { artist_id: string; spotify_artist_id: string | null }[] = [];
  if (((look ?? []) as unknown[]).length && !(await paused("spotify"))) {
    const token = await cachedSpotifyToken();
    const plain = (x: string) => {
      const p = x.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
      return p || x.toLowerCase().trim();
    };
    for (const a of (look ?? []) as { artist_id: string; name: string; track_id: string | null }[]) {
      if (!token) break;
      const { data: t } = await db.rpc("sc_spotify_allow", { p_want: 1 });
      if (t !== 1) break;
      const url = a.track_id
        ? `https://api.spotify.com/v1/tracks/${a.track_id}`
        : `https://api.spotify.com/v1/search?type=artist&limit=10&q=${encodeURIComponent(a.name)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      await sleep(1500);
      if (res.status === 429) {
        const wait = parseInt(res.headers.get("Retry-After") || "60", 10);
        await db.from("sc_private_settings").upsert({ key: "spotify_pause_until", value: new Date(Date.now() + Math.max(wait, 600) * 1000).toISOString() }, { onConflict: "key" });
        break;
      }
      // Only a clear answer counts (found, or not on Spotify); anything else is tried next time.
      if (!res.ok && res.status !== 404 && res.status !== 400) continue;
      let found: string | null = null;
      if (res.ok) {
        const body = await res.json().catch(() => null);
        const list = ((a.track_id ? body?.artists : body?.artists?.items) ?? []) as { id: string; name: string }[];
        const exact = list.filter((x) => x?.name && plain(x.name) === plain(a.name));
        // A song of theirs names them for sure; a search only when there's no doubt.
        if (a.track_id ? exact.length >= 1 : exact.length === 1) found = exact[0].id;
      }
      lookups.push({ artist_id: a.artist_id, spotify_artist_id: found });
    }
  }
  if (lookups.length) await db.rpc("sc_spotify_lookup_save", { p_secret: secret, p_items: lookups });

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

  // Genres and similar artists from Last.fm, up to 30 artists a run.
  const genreItems: { artist_id: string; tags: string[]; similar: string[] }[] = [];
  if (key && !(await paused("lastfm"))) {
    const { data: todo } = await db.rpc("sc_artist_genres_next", { p_secret: secret, p_limit: 30 });
    for (const a of (todo ?? []) as { artist_id: string; name: string; lastfm_name: string | null }[]) {
      const { data: ok } = await db.rpc("sc_api_allow", { p_service: "lastfm", p_want: 1 });
      if (ok !== 1) break;
      const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&autocorrect=1&artist=${encodeURIComponent(a.lastfm_name || a.name)}&api_key=${key}&format=json`);
      await sleep(1000);
      if (!res.ok && res.status !== 404) continue;
      const body = await res.json().catch(() => null);
      if (body?.error === 29) break; // Last.fm says slow down
      const rawTags = ((body?.artist?.tags?.tag ?? []) as { name: string }[]).map((t) => t?.name ?? "");
      const tags: string[] = [];
      for (const r of rawTags) {
        const t = tidyTag(r, a.name);
        if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
      }
      const similar = ((body?.artist?.similar?.artist ?? []) as { name: string }[]).map((x) => x?.name ?? "").filter(Boolean);
      genreItems.push({ artist_id: a.artist_id, tags: tags.slice(0, 5), similar: similar.slice(0, 10) });
    }
  }
  let genres = 0;
  if (genreItems.length) {
    const { data: g } = await db.rpc("sc_artist_genres_save", { p_secret: secret, p_items: genreItems });
    genres = (g as number) ?? 0;
  }
  return json({ ok: true, saved, photos: Object.values(out).filter((o) => o.image_url).length, abouts: Object.values(out).filter((o) => o.bio).length, genres, spotify_links: lookups.filter((l) => l.spotify_artist_id).length });
});
