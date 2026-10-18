// Supabase Edge Function: guest-artists
//
// Gives guests (artists only mentioned as "Feature on X's song") their own
// pages when Spotify confirms who they are (see
// 20261019230000_guest_artists.sql). Called by a timer every 10 minutes:
// up to 8 names, ~1.5 seconds between Spotify requests, stops completely if
// Spotify says to slow down.
//
// For each name:
//   1. search Spotify artists; keep exact name matches
//   2. if one is already an artist here (same Spotify id) -> link
//   3. else it needs 1,000+ followers (when Spotify reports them) AND one of
//      the guest's songs here found on Spotify under that artist -> create
//   4. otherwise -> review list

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const pause = () => new Promise((r) => setTimeout(r, 1500));
class SlowDown extends Error {}

function norm(s: string) {
  return (s || "").toLowerCase()
    .replace(/\s*[([]\s*(feat|ft|featuring|with|prod)\b[^)\]]*[)\]]/g, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

async function spotify(path: string, token: string) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  await pause();
  if (res.status === 429) throw new SlowDown(`Spotify asked to wait ${res.headers.get("Retry-After") ?? "?"}s`);
  if (!res.ok) return null;
  return res.json();
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);

  const { data: next, error } = await db.rpc("sc_guest_next", { p_secret: secret, p_limit: 8 });
  if (error) return json({ error: error.message }, 403);
  const guests = (next?.guests ?? []) as { key: string; name: string; titles: string[] | null }[];
  const known = (next?.known ?? {}) as Record<string, string>;
  if (guests.length === 0) return json({ ok: true, idle: true });

  const id = Deno.env.get("SPOTIFY_CLIENT_ID"), sec = Deno.env.get("SPOTIFY_CLIENT_SECRET");
  if (!id || !sec) return json({ error: "Spotify keys aren't set up" }, 500);
  const tok = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${id}:${sec}`) },
    body: "grant_type=client_credentials",
  });
  if (tok.status === 429) return json({ ok: true, stopped: "Spotify asked to slow down" });
  const token = (await tok.json())?.access_token as string;
  if (!token) return json({ error: "no Spotify token" }, 500);

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

      // Confirm with one of their songs here.
      let confirmed: any = null;
      for (const title of (g.titles ?? []).slice(0, 3)) {
        const t = await spotify(`/search?type=track&limit=10&q=${encodeURIComponent(`${title} ${g.name}`)}`, token);
        for (const tr of (t?.tracks?.items ?? []) as any[]) {
          if (norm(tr.name) !== norm(title)) continue;
          const hit = exact.find((a) => (tr.artists ?? []).some((x: any) => x.id === a.id));
          if (hit) { confirmed = hit; break; }
        }
        if (confirmed) break;
      }
      const followers = confirmed?.followers?.total;
      if (confirmed && (followers === undefined || followers === null || followers >= 1000)) {
        await db.rpc("sc_guest_result", {
          p_secret: secret, p_key: g.key, p_action: "create", p_spotify_id: confirmed.id, p_spotify_name: confirmed.name,
        });
        done.push({ name: g.name, result: "created" });
      } else {
        const note = confirmed ? `On Spotify but only ${followers} followers.`
          : exact.length > 1 ? `${exact.length} artists on Spotify with this name; none matched their songs.`
          : "On Spotify, but their songs here didn't match.";
        await db.rpc("sc_guest_result", { p_secret: secret, p_key: g.key, p_action: "review", p_note: note });
        done.push({ name: g.name, result: "review" });
      }
    }
  } catch (e) {
    stopped = e instanceof SlowDown ? e.message : String((e as Error)?.message ?? e);
  }
  return json({ ok: true, done, stopped });
});
