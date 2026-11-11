// Supabase Edge Function: cover-search
//
// Cover art for songs that have none (released ones first, then unconfirmed
// imports). For each song:
//   Deezer link -> the track's album cover (api.deezer.com/track/<id>)
//   Apple link  -> the iTunes lookup's artwork, at 600x600
//   neither     -> a Deezer search; only an exact artist + title match counts
// No keys needed. Deezer calls share their own budget ("deezercover"), Apple
// uses the iTunes budget. Called by a timer every 2 minutes through run-job.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Same tidying as the Deezer sync: no "(Album Version)", "(Explicit)", remaster notes.
const tidyTitle = (t: string) => t
  .replace(/\s*[\(\[](album version( explicit)?|explicit( version)?|explicit album version|lp version|album|main version|(\d{4} )?remaster(ed)?( explicit)?( version)?( \d{4})?)[\)\]]/gi, "")
  .replace(/\s+-\s+(album version|explicit|main version|(\d{4} )?remaster(ed)?( version)?( \d{4})?)$/i, "")
  .trim();
const plain = (x: string) => tidyTitle(x).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\s*[\(\[]\s*(feat|ft|with)\b[^\)\]]*[\)\]]/g, "").replace(/&/g, "and").replace(/[^\p{L}\p{N}]+/gu, "");

async function ticket(service: string) {
  const { data } = await db.rpc("sc_api_allow", { p_service: service, p_want: 1 });
  return data === 1;
}
async function deezer(path: string): Promise<any | null | "stop"> {
  if (!(await ticket("deezercover"))) return "stop";
  const res = await fetch(`https://api.deezer.com${path}`).catch(() => null);
  await sleep(400);
  if (!res) return null;
  if (res.status === 429) return "stop";
  const body = await res.json().catch(() => null);
  if (body?.error?.code === 4) return "stop";
  return body?.error ? null : body;
}

type Item = { id: string; title: string; artist: string; deezer_url: string | null; apple_url: string | null };

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);
  const { data: todo, error } = await db.rpc("sc_cover_search_next", { p_secret: secret, p_limit: 30 });
  if (error) return json({ error: error.message }, 403);

  const out: { track_id: string; cover_url: string | null; how: string }[] = [];
  let stopped: string | null = null;
  const started = Date.now();
  for (const t of (todo ?? []) as Item[]) {
    if (Date.now() - started > 100_000) break;
    let cover: string | null = null, how = "none";
    const dz = t.deezer_url?.match(/deezer\.com\/(?:[a-z]{2}\/)?track\/(\d+)/)?.[1];
    const ap = t.apple_url?.match(/[?&]i=(\d+)/)?.[1] ?? t.apple_url?.match(/\/song\/[^/]+\/(\d+)/)?.[1];
    if (dz) {
      const r = await deezer(`/track/${dz}`);
      if (r === "stop") { stopped = "deezer allowance used up"; break; }
      cover = r?.album?.cover_xl ?? null; how = cover ? "deezer-link" : "none";
    } else if (ap && (await ticket("itunes"))) {
      // (no iTunes allowance left this minute: try the Deezer search instead)
      const res = await fetch(`https://itunes.apple.com/lookup?id=${ap}`).catch(() => null);
      await sleep(400);
      const r = res?.ok ? await res.json().catch(() => null) : null;
      const art: string | undefined = r?.results?.[0]?.artworkUrl100;
      cover = art ? art.replace(/\/\d+x\d+bb\./, "/600x600bb.") : null; how = cover ? "apple-link" : "none";
    }
    if (!cover && t.title && t.artist) {
      const q = `artist:"${t.artist.replace(/"/g, "")}" track:"${tidyTitle(t.title).replace(/"/g, "")}"`;
      const r = await deezer(`/search?q=${encodeURIComponent(q)}&limit=10`);
      if (r === "stop") { stopped = "deezer allowance used up"; break; }
      const want = plain(t.title), who = plain(t.artist);
      const hit = ((r?.data ?? []) as any[]).find((x) => plain(String(x?.title ?? "")) === want && plain(String(x?.artist?.name ?? "")) === who && x?.album?.cover_xl);
      if (hit) { cover = hit.album.cover_xl; how = "deezer-search"; }
    }
    out.push({ track_id: t.id, cover_url: cover, how });
  }
  const { data: saved, error: e2 } = await db.rpc("sc_cover_search_save", { p_secret: secret, p_items: out });
  if (e2) return json({ error: e2.message }, 500);
  return json({ ok: true, checked: out.length, saved, by: out.reduce((m: Record<string, number>, x) => ((m[x.how] = (m[x.how] ?? 0) + 1), m), {}), stopped });
});
