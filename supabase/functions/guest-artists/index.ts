// Supabase Edge Function: guest-artists
//
// Gives guests (artists only mentioned as "Feature on X's song") their own
// pages when Spotify confirms who they are (see
// 20261019230000_guest_artists.sql). Called by a timer every 20 minutes:
// up to 4 names, ~1.5 seconds between Spotify requests, stops completely if
// Spotify says to slow down.
//
// For each name:
//   1. search Spotify artists; keep exact name matches
//   2. if one is already an artist here (same Spotify id) -> link
//   3. else it needs 1,000+ followers (when Spotify reports them) AND one of
//      the guest's songs here found on Spotify under that artist -> create
//   4. none of their songs here on Spotify (usually because they're
//      unreleased features)? Find the guest on Genius, take their most
//      popular released songs there and look for those on Spotify instead.
//      A hit under one of the same-name Spotify artists confirms who they are.
//   5. otherwise -> review list
// While followed artists still have songs waiting for their Spotify or
// Genius check, step 3 waits: existing artists are filled in first.

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
const pause = () => new Promise((r) => setTimeout(r, 1500));
class SlowDown extends Error { constructor(msg: string, public wait: number) { super(msg); } }
class OutOfTickets extends Error {}

// A ticket from the shared Spotify allowance (sc_spotify_allow: a few a minute,
// 25 an hour, 600 a day across every job) before every Spotify call.
async function ticket() {
  const { data } = await db.rpc("sc_spotify_allow", { p_want: 1 });
  if (data !== 1) throw new OutOfTickets("Spotify allowance used up for now; carrying on next run");
}
// Shared with the other Spotify jobs: see match-spotify.
const PAUSE_KEY = "spotify_pause_until";

// Genius: a ticket from its shared allowance (sc_api_allow 'genius') before
// every call, and the shared pause.
const GENIUS_PAUSE = "genius_pause_until";
const NOT_A_SONG = /tracklist|album art|liner notes|credits|setlist|discography|translation|romanized|annotated|\binterview\b|\bspeech\b|cover art|snippet/i;
async function genius(path: string, token: string) {
  const { data: p } = await db.from("sc_private_settings").select("value").eq("key", GENIUS_PAUSE).maybeSingle();
  if (p?.value && Date.parse(p.value) > Date.now()) return null;
  const { data, error } = await db.rpc("sc_api_allow", { p_service: "genius", p_want: 1 });
  if (!error && data !== 1) return null; // no Genius tickets right now: skip the extra check this time
  const res = await fetch(`https://api.genius.com${path}`, { headers: { Authorization: `Bearer ${token}` } });
  await pause();
  if (res.status === 429) {
    const wait = Number(res.headers.get("Retry-After")) || 60;
    const until = new Date(Date.now() + Math.max(wait, 600) * 1000).toISOString();
    await db.from("sc_private_settings").upsert({ key: GENIUS_PAUSE, value: until }, { onConflict: "key" });
    return null;
  }
  if (!res.ok) return null;
  return res.json();
}

// The guest's most popular released songs on Genius (their own, not
// features), from up to two Genius artists with exactly this name.
async function geniusTitles(name: string, token: string): Promise<{ titles: string[]; found: boolean }> {
  const s = await genius(`/search?per_page=20&q=${encodeURIComponent(name)}`, token);
  const ids: string[] = [];
  for (const h of (s?.response?.hits ?? []) as any[]) {
    const a = h.result?.primary_artist;
    if (a && norm(a.name) === norm(name) && !ids.includes(String(a.id))) ids.push(String(a.id));
  }
  const titles: string[] = [];
  for (const id of ids.slice(0, 2)) {
    const d = await genius(`/artists/${id}/songs?per_page=20&sort=popularity`, token);
    for (const song of (d?.response?.songs ?? []) as any[]) {
      const t = String(song.title || "").trim();
      if (!t || NOT_A_SONG.test(t) || String(song.primary_artist?.id) !== id) continue;
      if (!song.release_date_components?.year) continue; // released songs are the ones on Spotify
      if (!titles.some((x) => norm(x) === norm(t))) titles.push(t);
      if (titles.length >= 3 * (ids.indexOf(id) + 1)) break;
    }
  }
  return { titles, found: ids.length > 0 };
}

function norm(s: string) {
  return (s || "").toLowerCase()
    .replace(/\s*[([]\s*(feat|ft|featuring|with|prod)\b[^)\]]*[)\]]/g, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

async function spotify(path: string, token: string) {
  await ticket();
  const res = await fetch(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  await pause();
  if (res.status === 429) {
    const wait = Number(res.headers.get("Retry-After")) || 60;
    throw new SlowDown(`Spotify asked to wait ${wait}s`, wait);
  }
  if (!res.ok) return null;
  return res.json();
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

  const { data: next, error } = await db.rpc("sc_guest_next", { p_secret: secret, p_limit: 4 });
  if (error) return json({ error: error.message }, 403);
  const guests = (next?.guests ?? []) as { key: string; name: string; titles: string[] | null }[];
  const known = (next?.known ?? {}) as Record<string, string>;
  if (guests.length === 0) return json({ ok: true, idle: true });
  const { data: pauseRow } = await db.from("sc_private_settings").select("value").eq("key", PAUSE_KEY).maybeSingle();
  if (pauseRow?.value && Date.parse(pauseRow.value) > Date.now()) return json({ ok: true, paused_until: pauseRow.value });

  const token = await cachedSpotifyToken();
  if (!token) return json({ ok: true, stopped: "Spotify allowance used up for now" });

  const geniusToken = Deno.env.get("GENIUS_ACCESS_TOKEN");
  const done: Record<string, string>[] = [];
  let stopped: string | null = null;
  try {
    for (const g of guests) {
      const found = await spotify(`/search?type=artist&limit=10&q=${encodeURIComponent(g.name)}`, token);
      const exact = ((found?.artists?.items ?? []) as any[]).filter((a) => norm(a.name) === norm(g.name));

      // Already here under another name?
      const already = exact.find((a) => known[a.id]);
      if (already) {
        await db.rpc("sc_guest_result", { p_secret: secret, p_key: g.key, p_action: "link", p_artist: known[already.id] });
        done.push({ name: g.name, result: "linked" });
        continue;
      }
      if (exact.length === 0) {
        await db.rpc("sc_guest_result", { p_secret: secret, p_key: g.key, p_action: "review", p_note: "Not found on Spotify." });
        done.push({ name: g.name, result: "review" });
        continue;
      }

      // Confirm with one of their songs: first the ones here, then (if none
      // of those are on Spotify) their popular released songs on Genius.
      const onSpotify = async (titles: string[]) => {
        for (const title of titles) {
          const t = await spotify(`/search?type=track&limit=10&q=${encodeURIComponent(`${title} ${g.name}`)}`, token);
          for (const tr of (t?.tracks?.items ?? []) as any[]) {
            if (norm(tr.name) !== norm(title)) continue;
            const hit = exact.find((a) => (tr.artists ?? []).some((x: any) => x.id === a.id));
            if (hit) return hit;
          }
        }
        return null;
      };
      let confirmed: any = await onSpotify((g.titles ?? []).slice(0, 3));
      let via = "";
      let geniusNote = "";
      if (!confirmed && geniusToken) {
        const gen = await geniusTitles(g.name, geniusToken);
        const fresh = gen.titles.filter((t) => !(g.titles ?? []).some((x) => norm(x) === norm(t))).slice(0, 4);
        confirmed = fresh.length ? await onSpotify(fresh) : null;
        if (confirmed) via = "genius";
        else geniusNote = !gen.found ? " Not found on Genius either."
          : fresh.length === 0 ? " No released songs on Genius to compare."
          : " Their Genius songs aren't on Spotify under this name either.";
      }
      const followers = confirmed?.followers?.total;
      if (confirmed && next?.new_pages === false && (followers === undefined || followers === null || followers >= 1000)) {
        // Would be a new page, but existing artists come first: noted for later.
        await db.rpc("sc_guest_wait", { p_secret: secret, p_key: g.key, p_spotify_id: confirmed.id });
        done.push({ name: g.name, result: "waiting" });
      } else if (confirmed && (followers === undefined || followers === null || followers >= 1000)) {
        await db.rpc("sc_guest_result", {
          p_secret: secret, p_key: g.key, p_action: "create", p_spotify_id: confirmed.id, p_spotify_name: confirmed.name,
        });
        done.push({ name: g.name, result: via ? "created (Genius check)" : "created" });
      } else {
        const note = confirmed ? `On Spotify but only ${followers} followers.`
          : exact.length > 1 ? `${exact.length} artists on Spotify with this name; none matched their songs.`
          : "On Spotify, but their songs here didn't match.";
        const fullNote = confirmed ? note : note + geniusNote;
        // Keep the Spotify profile we found (if we're sure of it), so adding
        // them from the review list links it straight away.
        await db.rpc("sc_guest_result", { p_secret: secret, p_key: g.key, p_action: "review", p_note: fullNote, p_spotify_id: confirmed?.id ?? null });
        done.push({ name: g.name, result: "review" });
      }
    }
  } catch (e) {
    stopped = e instanceof SlowDown || e instanceof OutOfTickets ? e.message : String((e as Error)?.message ?? e);
    if (e instanceof SlowDown) {
      const until = new Date(Date.now() + Math.max(e.wait, 600) * 1000).toISOString();
      await db.from("sc_private_settings").upsert({ key: PAUSE_KEY, value: until }, { onConflict: "key" });
    }
  }
  return json({ ok: true, done, stopped });
});
