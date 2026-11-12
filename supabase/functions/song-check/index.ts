// Supabase Edge Function: song-check
//
// Every service checks every song: POST {service: "deezer" | "apple"} (timer,
// through run-job). The database hands out songs this service hasn't looked
// at in 90 days (sc_song_check_next), whatever links they already have, and
// this fills in only what's empty (sc_song_check_save):
//   deezer: its Deezer link -> the track; else its ISRC -> /track/isrc:...;
//           else an exact artist + title search. Fills the Deezer link, ISRC,
//           length, album, release date, cover, explicit.
//   apple:  its Apple link -> lookup; else an exact artist + title search.
//           Fills the Apple link, release date, genre, explicit, cover.
// A match on an "unconfirmed" song also marks it released (quietly). Searches
// only count with the same artist and title, and length within 8 seconds
// when we know it. Allowances: 'deezersong' and the shared 'itunes'.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tidyTitle = (t: string) => t
  .replace(/\s*[\(\[](album version( explicit)?|explicit( version)?|explicit album version|lp version|album|main version|(\d{4} )?remaster(ed)?( explicit)?( version)?( \d{4})?)[\)\]]/gi, "")
  .replace(/\s+-\s+(album version|explicit|main version|(\d{4} )?remaster(ed)?( version)?( \d{4})?)$/i, "")
  .trim();
const plain = (x: string) => tidyTitle(x).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\s*[\(\[]\s*(feat|ft|with)\b[^\)\]]*[\)\]]/g, "").replace(/&/g, "and").replace(/[^\p{L}\p{N}]+/gu, "");
const near = (a: number | null, b: number | null) => !a || !b || Math.abs(a - b) <= 8;

async function ticket(service: string) {
  const { data } = await db.rpc("sc_api_allow", { p_service: service, p_want: 1 });
  return data === 1;
}

type Song = { id: string; title: string; artist: string; status: string; isrc: string | null; length_sec: number | null;
  deezer_url: string | null; apple_url: string | null; album: string | null; release_date: string | null; no_cover: boolean };
type Found = { track_id: string; found: string; deezer_id?: string; apple_url?: string; isrc?: string; length_sec?: number;
  album?: string; release_date?: string; cover?: string; explicit?: boolean; genre?: string };

async function deezer(path: string): Promise<any | null | "stop"> {
  if (!(await ticket("deezersong"))) return "stop";
  const res = await fetch(`https://api.deezer.com${path}`).catch(() => null);
  await sleep(250);
  if (!res) return null;
  if (res.status === 429) return "stop";
  const body = await res.json().catch(() => null);
  if (body?.error?.code === 4) return "stop";
  return body?.error ? null : body;
}

function fromDeezer(s: Song, d: any, how: string): Found {
  return {
    track_id: s.id, found: how, deezer_id: d?.id ? String(d.id) : undefined, isrc: d?.isrc || undefined,
    length_sec: Number(d?.duration) || undefined, album: d?.album?.title || undefined,
    release_date: d?.release_date || d?.album?.release_date || undefined, cover: d?.album?.cover_xl || undefined,
    explicit: typeof d?.explicit_lyrics === "boolean" ? d.explicit_lyrics : undefined,
  };
}

async function checkDeezer(s: Song): Promise<Found | "stop"> {
  const id = s.deezer_url?.match(/deezer\.com\/(?:[a-z]{2}\/)?track\/(\d+)/)?.[1];
  if (id) {
    const d = await deezer(`/track/${id}`);
    if (d === "stop") return "stop";
    if (d?.id) return fromDeezer(s, d, "deezer-link");
  }
  if (s.isrc) {
    const d = await deezer(`/track/isrc:${encodeURIComponent(s.isrc)}`);
    if (d === "stop") return "stop";
    if (d?.id && near(s.length_sec, Number(d.duration) || null)) return fromDeezer(s, d, "deezer-isrc");
  }
  if (!id && s.title && s.artist) {
    const q = `artist:"${s.artist.replace(/"/g, "")}" track:"${tidyTitle(s.title).replace(/"/g, "")}"`;
    const want = plain(s.title), who = plain(s.artist);
    const pick = (r: any) => ((r?.data ?? []) as any[]).find((x) => plain(String(x?.title ?? "")) === want
      && [x?.artist?.name, ...((x?.contributors ?? []) as any[]).map((c) => c?.name)].some((n) => plain(String(n ?? "")) === who)
      && near(s.length_sec, Number(x?.duration) || null));
    const r = await deezer(`/search?q=${encodeURIComponent(q)}&limit=10`);
    if (r === "stop") return "stop";
    let hit = pick(r);
    if (!hit) {
      // Strict search found nothing (Deezer's fussy about punctuation): a plain one.
      const r2 = await deezer(`/search?q=${encodeURIComponent(`${s.artist} ${tidyTitle(s.title)}`)}&limit=25`);
      if (r2 === "stop") return "stop";
      hit = pick(r2);
    }
    if (hit?.id) {
      // The search result has no ISRC or date: read the track itself.
      const d = await deezer(`/track/${hit.id}`);
      if (d === "stop") return fromDeezer(s, hit, "deezer-search");
      return fromDeezer(s, d?.id ? d : hit, "deezer-search");
    }
  }
  return { track_id: s.id, found: "none" };
}

function fromApple(s: Song, a: any, how: string): Found {
  const art: string | undefined = a?.artworkUrl100;
  return {
    track_id: s.id, found: how, apple_url: a?.trackViewUrl ? String(a.trackViewUrl).replace(/[?&]uo=\d+/, "") : undefined,
    length_sec: Number(a?.trackTimeMillis) ? Math.round(Number(a.trackTimeMillis) / 1000) : undefined,
    album: a?.collectionName || undefined, release_date: typeof a?.releaseDate === "string" ? a.releaseDate.slice(0, 10) : undefined,
    cover: art ? art.replace(/\/\d+x\d+bb\./, "/600x600bb.") : undefined, genre: a?.primaryGenreName || undefined,
    explicit: a?.trackExplicitness ? a.trackExplicitness === "explicit" : undefined,
  };
}

async function apple(url: string): Promise<any | null | "stop"> {
  if (!(await ticket("itunes"))) return "stop";
  const res = await fetch(url).catch(() => null);
  await sleep(500);
  if (!res) return null;
  if (res.status === 403 || res.status === 429) return "stop";
  return res.ok ? await res.json().catch(() => null) : null;
}

async function checkApple(s: Song): Promise<Found | "stop"> {
  const id = s.apple_url?.match(/[?&]i=(\d+)/)?.[1] ?? s.apple_url?.match(/\/song\/[^/]+\/(\d+)/)?.[1];
  if (id) {
    const r = await apple(`https://itunes.apple.com/lookup?id=${id}`);
    if (r === "stop") return "stop";
    const a = r?.results?.[0];
    if (a?.trackId) return fromApple(s, a, "apple-link");
  }
  if (!id && s.title && s.artist) {
    const r = await apple(`https://itunes.apple.com/search?term=${encodeURIComponent(`${s.artist} ${tidyTitle(s.title)}`.slice(0, 120))}&entity=song&limit=50`);
    if (r === "stop") return "stop";
    const want = plain(s.title), who = plain(s.artist);
    // Apple joins duets as "A & B": the artist only has to be one of them.
    const byArtist = (n: string) => n.split(/\s*(?:&|,|\bx\b)\s*/i).some((p) => plain(p) === who) || plain(n) === who;
    const hit = ((r?.results ?? []) as any[]).find((x) => plain(String(x?.trackName ?? "")) === want && byArtist(String(x?.artistName ?? ""))
      && x?.trackViewUrl && near(s.length_sec, Number(x?.trackTimeMillis) ? Math.round(Number(x.trackTimeMillis) / 1000) : null));
    if (hit) return fromApple(s, hit, "apple-search");
  }
  return { track_id: s.id, found: "none" };
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);
  const body = await req.json().catch(() => ({}));
  const service = body?.service === "apple" ? "apple" : "deezer";
  const { data: todo, error } = await db.rpc("sc_song_check_next", { p_secret: secret, p_service: service, p_limit: service === "apple" ? 15 : 40 });
  if (error) return json({ error: error.message }, 403);
  const out: Found[] = [];
  let stopped: string | null = null;
  const started = Date.now();
  for (const s of (todo ?? []) as Song[]) {
    if (Date.now() - started > 100_000) break;
    const f = service === "apple" ? await checkApple(s) : await checkDeezer(s);
    if (f === "stop") { stopped = `${service} allowance used up for now`; break; }
    out.push(f);
  }
  const { data: saved, error: e2 } = out.length ? await db.rpc("sc_song_check_save", { p_secret: secret, p_service: service, p_items: out }) : { data: null, error: null };
  if (e2) return json({ error: e2.message }, 500);
  return json({
    ok: true, service, checked: out.length, ...((saved as object) ?? {}),
    by: out.reduce((m: Record<string, number>, x) => ((m[x.found] = (m[x.found] ?? 0) + 1), m), {}), stopped,
  });
});
