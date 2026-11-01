// Supabase Edge Function: guest-artists
//
// Gives guests (artists only mentioned as "Feature on X's song") their own
// pages when Deezer confirms who they are (see
// 20261101170000_guests_on_deezer.sql). Called by a timer every 10 minutes:
// up to 20 names, every Deezer call with a 'deezer' ticket. (This used
// Spotify until 1 Nov; Spotify's 25 calls an hour are now kept for links.)
//
// For each name:
//   1. search Deezer artists; keep exact name matches
//   2. if one is already an artist here (same Deezer id) -> link
//   3. else confirm who they are: one of the guest's songs here found on
//      Deezer with that artist credited (main artist or featured)
//   4. none of their songs here on Deezer (usually unreleased features)?
//      Take their most popular released songs on Genius and look for those
//      on Deezer instead.
//   5. confirmed with 300+ Deezer fans -> new page (or "waiting" while
//      existing artists are filled in first); otherwise -> review list

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
const pause = () => sleep(1500);
class Stop extends Error {}
const MIN_FANS = 300;

// Deezer: a ticket from its shared allowance before every call, the shared
// pause, and a short gap between calls. Errors come back as 200 + {error}.
const DEEZER_PAUSE = "deezer_pause_until";
async function deezer(path: string): Promise<any | null> {
  const { data: ticket } = await db.rpc("sc_api_allow", { p_service: "deezer", p_want: 1 });
  if (ticket !== 1) throw new Stop("Deezer allowance used up for now; carrying on next run");
  const res = await fetch(`https://api.deezer.com${path}`).catch(() => null);
  await sleep(300);
  if (!res) return null;
  if (res.status === 429) { await setPause(DEEZER_PAUSE, 5); throw new Stop("Deezer asked us to slow down"); }
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (body?.error) {
    if (body.error.code === 4) { await setPause(DEEZER_PAUSE, 2); throw new Stop("Deezer asked us to slow down"); }
    return null;
  }
  return body;
}
async function setPause(key: string, minutes: number) {
  await db.from("sc_private_settings").upsert({ key, value: new Date(Date.now() + minutes * 60_000).toISOString() }, { onConflict: "key" });
}

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
      if (!song.release_date_components?.year) continue; // released songs are the ones on Deezer
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

type DzArtist = { id: number; name: string; nb_fan?: number };

// Is one of these titles on Deezer with one of the candidate artists
// credited? Returns that artist.
async function onDeezer(name: string, titles: string[], exact: DzArtist[]): Promise<DzArtist | null> {
  const ids = new Set(exact.map((a) => a.id));
  for (const title of titles) {
    const s = await deezer(`/search/track?q=${encodeURIComponent(`${title} ${name}`)}&limit=10`);
    const hits = ((s?.data ?? []) as any[]).filter((t) => norm(t.title_short || t.title) === norm(title));
    for (const t of hits) {
      if (ids.has(t.artist?.id)) return exact.find((a) => a.id === t.artist.id) ?? null;
    }
    // Featured rather than main artist: the song's full credits.
    for (const t of hits.slice(0, 2)) {
      const full = await deezer(`/track/${t.id}`);
      const c = ((full?.contributors ?? []) as any[]).find((x) => ids.has(x.id));
      if (c) return exact.find((a) => a.id === c.id) ?? null;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);

  const { data: next, error } = await db.rpc("sc_guest_next", { p_secret: secret, p_limit: 20 });
  if (error) return json({ error: error.message }, 403);
  const guests = (next?.guests ?? []) as { key: string; name: string; titles: string[] | null }[];
  if (guests.length === 0) return json({ ok: true, idle: true });
  const { data: pauseRow } = await db.from("sc_private_settings").select("value").eq("key", DEEZER_PAUSE).maybeSingle();
  if (pauseRow?.value && Date.parse(pauseRow.value) > Date.now()) return json({ ok: true, paused_until: pauseRow.value });

  // Artists already here, by Deezer id.
  const { data: knownRows } = await db.from("artists").select("id, deezer_artist_id").not("deezer_artist_id", "is", null);
  const known: Record<string, string> = {};
  for (const r of (knownRows ?? []) as { id: string; deezer_artist_id: string }[]) known[r.deezer_artist_id] = r.id;

  const geniusToken = Deno.env.get("GENIUS_ACCESS_TOKEN");
  const started = Date.now();
  const done: Record<string, string>[] = [];
  let stopped: string | null = null;
  try {
    for (const g of guests) {
      if (Date.now() - started > 120_000) break;
      const found = await deezer(`/search/artist?q=${encodeURIComponent(g.name)}&limit=10`);
      const exact = ((found?.data ?? []) as DzArtist[]).filter((a) => norm(a.name) === norm(g.name));

      // Already here under another name?
      const already = exact.find((a) => known[String(a.id)]);
      if (already) {
        await db.rpc("sc_guest_found", { p_secret: secret, p_key: g.key, p_action: "link", p_artist: known[String(already.id)] });
        done.push({ name: g.name, result: "linked" });
        continue;
      }
      if (exact.length === 0) {
        await db.rpc("sc_guest_found", { p_secret: secret, p_key: g.key, p_action: "review", p_note: "Not found on Deezer." });
        done.push({ name: g.name, result: "review" });
        continue;
      }

      // Confirm with one of their songs: first the ones here, then (if none
      // of those are on Deezer) their popular released songs on Genius.
      let confirmed = await onDeezer(g.name, (g.titles ?? []).slice(0, 3), exact);
      let via = "";
      let geniusNote = "";
      if (!confirmed && geniusToken) {
        const gen = await geniusTitles(g.name, geniusToken);
        const fresh = gen.titles.filter((t) => !(g.titles ?? []).some((x) => norm(x) === norm(t))).slice(0, 4);
        confirmed = fresh.length ? await onDeezer(g.name, fresh, exact) : null;
        if (confirmed) via = "genius";
        else geniusNote = !gen.found ? " Not found on Genius either."
          : fresh.length === 0 ? " No released songs on Genius to compare."
          : " Their Genius songs aren't on Deezer under this name either.";
      }
      const fans = confirmed?.nb_fan ?? 0;
      if (confirmed && fans >= MIN_FANS && next?.new_pages === false) {
        // Would be a new page, but existing artists come first: noted for later.
        await db.rpc("sc_guest_found", { p_secret: secret, p_key: g.key, p_action: "wait", p_deezer_id: String(confirmed.id) });
        done.push({ name: g.name, result: "waiting" });
      } else if (confirmed && fans >= MIN_FANS) {
        await db.rpc("sc_guest_found", {
          p_secret: secret, p_key: g.key, p_action: "create", p_deezer_id: String(confirmed.id), p_deezer_name: confirmed.name,
        });
        done.push({ name: g.name, result: via ? "created (Genius check)" : "created" });
      } else {
        const note = confirmed ? `On Deezer but only ${fans} fans.`
          : exact.length > 1 ? `${exact.length} artists on Deezer with this name; none matched their songs.`
          : "On Deezer, but their songs here didn't match.";
        // Keep the Deezer profile we found (if we're sure of it), so adding
        // them from the review list links it straight away.
        await db.rpc("sc_guest_found", {
          p_secret: secret, p_key: g.key, p_action: "review", p_note: confirmed ? note : note + geniusNote,
          p_deezer_id: confirmed ? String(confirmed.id) : null,
        });
        done.push({ name: g.name, result: "review" });
      }
    }
  } catch (e) {
    stopped = e instanceof Stop ? e.message : String((e as Error)?.message ?? e);
  }
  return json({ ok: true, checked: done.length, done, stopped });
});
