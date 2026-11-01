// Supabase Edge Function: musicbrainz-sync
//
// Band members from MusicBrainz (https://musicbrainz.org, open data). Every
// 2 minutes, for up to 50 seconds, one artist at a time (sc_mb_next):
//   1. find them on MusicBrainz: saved id, else their Spotify link (exact),
//      else their name (only when exactly one MusicBrainz artist has it)
//   2. read their band links ("member of band", "collaboration"): who's in
//      the band, or which bands they're in, with instrument and years
//   3. save (sc_mb_save), plus from the same reply official links, country,
//      real name and active years (sc_mb_info)
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

// Official links worth showing, by MusicBrainz link type (or the site for
// "social network" links). Ended links are left out.
function linkLabel(type: string, url: string): string | null {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  if (type === "official homepage") return "Website";
  if (type === "youtube") return "YouTube";
  if (type === "soundcloud") return "SoundCloud";
  if (type === "bandcamp") return "Bandcamp";
  if (type === "wikipedia") return "Wikipedia";
  if (type === "social network" || type === "video channel") {
    if (/instagram\.com$/.test(host)) return "Instagram";
    if (/(twitter|x)\.com$/.test(host)) return "X";
    if (/tiktok\.com$/.test(host)) return "TikTok";
    if (/facebook\.com$/.test(host)) return "Facebook";
    if (/youtube\.com$/.test(host)) return "YouTube";
  }
  return null;
}

function artistInfo(d: any) {
  const seen = new Set<string>();
  const links = ((d.relations ?? []) as any[])
    .filter((r) => r["target-type"] === "url" && !r.ended && r.url?.resource)
    .map((r) => ({ type: linkLabel(r.type, r.url.resource), url: r.url.resource as string }))
    .filter((l) => l.type && !seen.has(l.type) && seen.add(l.type)) as { type: string; url: string }[];
  const legal = ((d.aliases ?? []) as any[]).find((x) => x.type === "Legal name" && !x.ended)?.name ?? null;
  const info: Record<string, unknown> = {
    links: links.slice(0, 8),
    country: typeof d.country === "string" ? d.country : null,
    real_name: legal && legal !== d.name ? legal : null,
  };
  // Active years for bands only (for a person MusicBrainz's dates are birth
  // and death). Only say it ended when MusicBrainz says so.
  if (d.type && d.type !== "Person" && d.type !== "Character") {
    const life = d["life-span"] ?? {};
    info.from = year(life.begin) || null;
    if (life.ended) info.to = year(life.end) || null;
  }
  return info;
}

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
  const d = await mb(`/artist/${mbid}?inc=artist-rels+url-rels+aliases&fmt=json`);
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
  // From the same reply: official links, country, real name, active years.
  // (Saved only if the match above was kept.)
  await db.rpc("sc_mb_info", { p_secret: secret, p_artist: a.artist_id, p_info: { ...artistInfo(d), mbid } });
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
