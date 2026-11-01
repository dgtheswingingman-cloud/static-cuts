// Supabase Edge Function: musicbrainz-sync
//
// Band members from MusicBrainz (https://musicbrainz.org, open data). Every
// 2 minutes, for up to 50 seconds, one artist at a time (sc_mb_next):
//   1. find them on MusicBrainz: saved id, else their Spotify link (exact),
//      else their name (only when exactly one MusicBrainz artist has it)
//   2. read their band links ("member of band", "collaboration"): who's in
//      the band, or which bands they're in, with instrument and years
//   3. save (sc_mb_save)
// MusicBrainz allows one request a second and asks for a named client.
// Every request takes a 'musicbrainz' ticket (sc_api_allow).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = "StaticCuts/1.0 ( https://static-cuts.com )";
const MB = "https://musicbrainz.org/ws/2";

class Stop extends Error {}

async function paused() {
  const { data } = await db.from("sc_private_settings").select("value").eq("key", "musicbrainz_pause_until").maybeSingle();
  return !!(data?.value && Date.parse(data.value) > Date.now());
}

let last = 0;
async function mb(path: string): Promise<any | null> {
  const { data: ticket } = await db.rpc("sc_api_allow", { p_service: "musicbrainz", p_want: 1 });
  if (ticket !== 1) throw new Stop();
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(`${MB}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } }).catch(() => null);
  if (!res) throw new Stop();
  if (res.status === 503 || res.status === 429) {
    await db.from("sc_private_settings").upsert({ key: "musicbrainz_pause_until", value: new Date(Date.now() + 10 * 60_000).toISOString() }, { onConflict: "key" });
    throw new Stop();
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Stop();
  return await res.json().catch(() => null);
}

const plain = (x: string) => {
  const p = (x || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9$]/g, "");
  return p || (x || "").toLowerCase().trim();
};

// Attributes that aren't a role.
const NOT_ROLE = new Set(["original", "additional", "minor", "guest", "founder", "support", "principal", "task", "eponymous"]);
const year = (d?: string | null) => (d && /^\d{4}/.test(d) ? d.slice(0, 4) : "");

type Next = { artist_id: string; name: string; spotify_id: string | null; mbid: string | null };

async function findId(a: Next): Promise<{ mbid: string | null; by: string }> {
  if (a.mbid && /^[0-9a-f-]{36}$/.test(a.mbid)) return { mbid: a.mbid, by: "saved" };
  if (a.spotify_id) {
    const u = await mb(`/url?resource=${encodeURIComponent(`https://open.spotify.com/artist/${a.spotify_id}`)}&inc=artist-rels&fmt=json`);
    const ids = [...new Set(((u?.relations ?? []) as any[]).filter((r) => r.artist?.id).map((r) => r.artist.id as string))];
    if (ids.length === 1) return { mbid: ids[0], by: "spotify" };
  }
  const s = await mb(`/artist?query=${encodeURIComponent(`artist:"${a.name.replace(/"/g, "")}"`)}&limit=25&fmt=json`);
  const exact = ((s?.artists ?? []) as any[]).filter((x) => plain(x.name) === plain(a.name));
  if (exact.length === 1 && Number(exact[0].score ?? 0) >= 95) return { mbid: exact[0].id, by: "name" };
  return { mbid: null, by: "none" };
}

async function one(a: Next) {
  const { mbid, by } = await findId(a);
  if (!mbid) {
    await db.rpc("sc_mb_save", { p_secret: secret, p_artist: a.artist_id, p_mbid: null, p_type: null, p_matched_by: by, p_links: [] });
    return { found: false, links: 0 };
  }
  const d = await mb(`/artist/${mbid}?inc=artist-rels&fmt=json`);
  if (!d) {
    await db.rpc("sc_mb_save", { p_secret: secret, p_artist: a.artist_id, p_mbid: null, p_type: null, p_matched_by: by, p_links: [] });
    return { found: false, links: 0 };
  }
  const links = ((d.relations ?? []) as any[])
    .filter((r) => (r.type === "member of band" || r.type === "collaboration") && r.artist?.id && r.artist.id !== mbid)
    .map((r) => ({
      // backward: they're a member of this artist; forward: this artist is a member of theirs.
      kind: r.direction === "backward" ? "member" : "group",
      mbid: r.artist.id,
      name: r.artist.name,
      roles: ((r.attributes ?? []) as string[]).filter((x) => !NOT_ROLE.has(x)),
      begin: year(r.begin),
      end: year(r.end),
      ended: !!r.ended,
    }));
  const { data: n } = await db.rpc("sc_mb_save", {
    p_secret: secret, p_artist: a.artist_id, p_mbid: mbid, p_type: d.type ?? null, p_matched_by: by, p_links: links,
  });
  return { found: true, links: (n as number) ?? 0 };
}

let secret = "";

Deno.serve(async (req) => {
  secret = req.headers.get("x-cron-secret") ?? "";
  if (!secret) return json({ error: "not authorized" }, 403);
  if (await paused()) return json({ ok: true, paused: true });
  const started = Date.now();
  const done = { artists: 0, found: 0, links: 0 };
  try {
    while (Date.now() - started < 45_000) {
      const { data: next, error } = await db.rpc("sc_mb_next", { p_secret: secret });
      if (error) return json({ error: error.message }, 403);
      if (!next) break;
      const r = await one(next as Next);
      done.artists++;
      if (r.found) done.found++;
      done.links += r.links;
    }
  } catch (e) {
    if (!(e instanceof Stop)) return json({ error: String((e as Error)?.message ?? e), ...done }, 500);
  }
  return json({ ok: true, ...done });
});
