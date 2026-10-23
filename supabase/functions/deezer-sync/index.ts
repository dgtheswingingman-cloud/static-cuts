// Supabase Edge Function: deezer-sync
//
// Reads artists' releases from Deezer's public catalogue (no sign-in), a
// little at a time, each call with a 'deezer' ticket. The timer runs every
// minute. Owner's pace setting (sc_deezer_mode):
//   normal:   every other minute, up to 60 calls
//   flat out: every minute, one worker for up to 50 seconds
//   extreme:  every minute, five workers at once for up to 50 seconds (the
//             site is paused for everyone else meanwhile) The database decides what's next (sc_deezer_next):
//   search: find the artist on Deezer by name
//   list:   a page of their albums, EPs and singles
//   album:  one release's songs, matched to the page and added if missing

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NORMAL = { workers: 1, calls: 60, gap: 300, seconds: 50 };
const TURBO = { workers: 1, calls: 300, gap: 100, seconds: 50 };
const EXTREME = { workers: 5, calls: 300, gap: 250, seconds: 50 };

async function paused() {
  const { data } = await db.from("sc_private_settings").select("value").eq("key", "deezer_pause_until").maybeSingle();
  return !!(data?.value && Date.parse(data.value) > Date.now());
}
async function pause(minutes: number) {
  await db.from("sc_private_settings").upsert({ key: "deezer_pause_until", value: new Date(Date.now() + minutes * 60_000).toISOString() }, { onConflict: "key" });
}

// Deezer answers errors with 200 and {error: {code}}. Code 4 = too many calls.
let gap = NORMAL.gap;
async function deezer(path: string): Promise<{ ok: true; body: any } | { ok: false; stop: boolean }> {
  const res = await fetch(`https://api.deezer.com${path}`).catch(() => null);
  await sleep(gap);
  if (!res) return { ok: false, stop: false };
  if (res.status === 429) { await pause(5); return { ok: false, stop: true }; }
  if (!res.ok) return { ok: false, stop: res.status >= 500 };
  const body = await res.json().catch(() => null);
  if (body?.error) {
    if (body.error.code === 4) { await pause(2); return { ok: false, stop: true }; }
    if (body.error.code === 800) return { ok: true, body: { data: [] } }; // nothing there
    return { ok: false, stop: false };
  }
  return { ok: true, body };
}

// Deezer has clean (edited) copies of explicit albums and labels songs
// "(Album Version)", "(Explicit)" and so on. Clean copies are skipped and the
// labels taken off, so they match the songs already on the page.
const CLEAN = /[\(\[][^\)\]]*\b(edited|clean)\b[^\)\]]*[\)\]]|\s-\s(edited|clean)( version)?$|radio edit/i;
const tidyTitle = (t: string) => t
  .replace(/\s*[\(\[](album version( explicit)?|explicit( version)?|explicit album version|lp version|album|main version|(\d{4} )?remaster(ed)?( explicit)?( version)?( \d{4})?)[\)\]]/gi, "")
  .replace(/\s+-\s+(album version|explicit|main version|(\d{4} )?remaster(ed)?( version)?( \d{4})?)$/i, "")
  .trim();

const plain = (x: string) => {
  const p = x.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
  return p || x.toLowerCase().trim();
};

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);
  if (await paused()) return json({ ok: true, paused: true });
  let { data: modeName, error: modeErr } = await db.rpc("sc_deezer_mode", { p_secret: secret });
  if (modeErr) {
    // Older database without the pace setting function: read the switch.
    const { data: t } = await db.from("sc_private_settings").select("value").eq("key", "deezer_turbo").maybeSingle();
    modeName = t?.value === "on" ? "on" : "off";
  }
  // Normal pace: every other minute.
  if (modeName === "off" && new Date().getUTCMinutes() % 2 === 1) return json({ ok: true, skipped: "normal pace" });
  const mode = modeName === "extreme" ? EXTREME : modeName === "on" ? TURBO : NORMAL;
  gap = mode.gap;
  const started = Date.now();

  const done = { mode: modeName, searched: 0, linked: 0, listed: 0, releases: 0, matched: 0, added: 0 };
  let stop = false, empty = 0, calls = 0;
  let failed: string | null = null;

  // One step: claim the next piece of work and do it.
  async function step() {
      const { data: next, error } = await db.rpc("sc_deezer_next", { p_secret: secret });
      if (error) { failed = error.message; return; }
      if (!next) { empty++; return; }
      const { data: ticket } = await db.rpc("sc_api_allow", { p_service: "deezer", p_want: 1 });
      if (ticket !== 1) { stop = true; return; }

      if (next.kind === "search") {
        const r = await deezer(`/search/artist?q=${encodeURIComponent(next.name)}&limit=10`);
        if (!r.ok) { if (r.stop) stop = true; return; } // try again next run
        const exact = ((r.body?.data ?? []) as { id: number; name: string; nb_fan: number }[])
          .filter((a) => plain(a.name) === plain(next.name))
          .sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0));
        // One exact match, or a clear favourite (5× the fans of the next one).
        const pick = exact.length === 1 || (exact.length > 1 && (exact[0].nb_fan ?? 0) >= 5 * Math.max(1, exact[1].nb_fan ?? 0)) ? exact[0] : null;
        await db.rpc("sc_deezer_link", { p_secret: secret, p_artist: next.artist_id, p_deezer_id: pick ? String(pick.id) : null });
        await db.rpc("sc_deezer_unclaim", { p_secret: secret, p_artist: next.artist_id });
        done.searched++; if (pick) done.linked++;
      } else if (next.kind === "list") {
        const r = await deezer(`/artist/${next.deezer_id}/albums?limit=100&index=${next.index ?? 0}`);
        if (!r.ok) { if (r.stop) stop = true; return; } // try again next run
        const raw = ((r.body?.data ?? []) as { id: number; title: string; record_type: string; release_date: string; cover_xl?: string; cover_big?: string; link: string; explicit_lyrics?: boolean }[]);
        // Same title twice (explicit and clean copies): keep the explicit one.
        const explicitTitles = new Set(raw.filter((a) => a.explicit_lyrics).map((a) => a.title.toLowerCase()));
        const albums = raw
          .filter((a) => ["album", "ep", "single"].includes(a.record_type))
          .filter((a) => a.explicit_lyrics || !explicitTitles.has(a.title.toLowerCase()))
          .filter((a) => !CLEAN.test(a.title))
          .map((a) => ({ id: String(a.id), title: a.title, kind: a.record_type, release_date: a.release_date, cover: a.cover_xl || a.cover_big || null, link: a.link }));
        const total = Number(r.body?.total ?? 0);
        const nextIndex = r.body?.next && (next.index ?? 0) + 100 < Math.max(total, 1) ? (next.index ?? 0) + 100 : null;
        await db.rpc("sc_deezer_listed", { p_secret: secret, p_artist: next.artist_id, p_albums: albums, p_next: nextIndex });
        await db.rpc("sc_deezer_unclaim", { p_secret: secret, p_artist: next.artist_id });
        done.listed++;
      } else if (next.kind === "album") {
        const r = await deezer(`/album/${next.album_id}/tracks?limit=300`);
        if (!r.ok) { if (r.stop) stop = true; return; } // try again next run
        const tracks = ((r.body?.data ?? []) as { title: string; track_position: number; disk_number: number; link: string; artist?: { name: string } }[])
          .filter((t) => !CLEAN.test(t.title))
          .map((t) => ({ title: tidyTitle(t.title), position: t.track_position, disk: t.disk_number, link: t.link, artist: t.artist?.name ?? "" }));
        const { data: res } = await db.rpc("sc_deezer_album_save", { p_secret: secret, p_artist: next.artist_id, p_album: next.album_id, p_tracks: tracks });
        done.releases++;
        done.matched += (res?.matched as number) ?? 0;
        done.added += (res?.added as number) ?? 0;
      } else return;
  }

  async function worker() {
    while (!stop && !failed && empty === 0 && calls < mode.calls * mode.workers && Date.now() - started < mode.seconds * 1000) {
      calls++;
      await step();
    }
  }
  await Promise.all(Array.from({ length: mode.workers }, () => worker()));
  if (failed) return json({ error: failed }, 403);
  // Extreme with nothing left: back to normal and the site comes back.
  if (empty > 0 && modeName === "extreme") await db.rpc("sc_deezer_extreme_done", { p_secret: secret });
  return json({ ok: true, ...done });
});
