// Supabase Edge Function: lastfm-me
//
// "Your Last.fm": for the signed-in person, reads their most-played songs and
// artists from Last.fm (their linked username) and matches them to the
// archive: which songs are here, which you've collected, which artists you
// follow. Two Last.fm calls a look, each taking a ticket from the shared
// Last.fm allowance.
//
// POST {period: "7day" | "1month" | "12month" | "overall"} with the user's
// sign-in token.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const service = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const PERIODS = ["7day", "1month", "12month", "overall"];

async function lastfm(params: Record<string, string>, key: string) {
  const { data: ok } = await service.rpc("sc_api_allow", { p_service: "lastfm", p_want: 1 });
  if (ok !== 1) throw new Error("Last.fm is busy with other jobs right now. Try again in a minute.");
  const q = new URLSearchParams({ ...params, api_key: key, format: "json" });
  const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${q}`);
  const body = await res.json().catch(() => null);
  if (body?.error === 6) throw new Error("Last.fm doesn't know that username. Check it in Settings.");
  if (body?.error === 17) throw new Error("That Last.fm profile is private. Turn on public listening history in Last.fm's privacy settings.");
  if (body?.error === 29) throw new Error("Last.fm asked us to slow down. Try again in a few minutes.");
  if (!res.ok || body?.error) throw new Error(`Last.fm: ${body?.message ?? res.status}`);
  return body;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await service.auth.getUser(jwt);
  if (!who?.user) return json({ error: "Sign in first." }, 401);
  const key = Deno.env.get("LASTFM_API_KEY");
  if (!key) return json({ error: "Last.fm isn't set up on the site yet." }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const period = PERIODS.includes(body?.period) ? body.period : "1month";

  // As the person, so matching knows what they've collected and follow.
  const me = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: username } = await me.rpc("rpc_my_lastfm");
  if (!username) return json({ error: "Link your Last.fm username in Settings first." }, 400);

  try {
    const tracksBody = await lastfm({ method: "user.gettoptracks", user: username, period, limit: "100" }, key);
    const artistsBody = await lastfm({ method: "user.gettopartists", user: username, period, limit: "50" }, key);
    const rawTracks = ((tracksBody?.toptracks?.track ?? []) as any[]).map((t) => ({
      title: String(t?.name ?? ""), artist: String(t?.artist?.name ?? ""), plays: parseInt(t?.playcount ?? "0", 10),
    }));
    const rawArtists = ((artistsBody?.topartists?.artist ?? []) as any[]).map((a) => ({
      name: String(a?.name ?? ""), plays: parseInt(a?.playcount ?? "0", 10),
    }));
    const { data: matched, error: mErr } = await me.rpc("rpc_match_my_songs", {
      p_items: rawTracks.map((t) => ({ artist: t.artist, title: t.title })), p_artist_id: null,
    });
    if (mErr) throw new Error(mErr.message);
    const { data: artistMatches, error: aErr } = await me.rpc("rpc_match_artists", { p_names: rawArtists.map((a) => a.name) });
    if (aErr) throw new Error(aErr.message);
    const m = (matched ?? []) as any[];
    const am = (artistMatches ?? []) as any[];
    return json({
      ok: true, username, period,
      tracks: rawTracks.map((t, i) => ({ ...t, track_id: m[i]?.track_id ?? null, archive_title: m[i]?.title ?? null,
        artist_id: m[i]?.artist_id ?? null, owned: !!m[i]?.owned })),
      artists: rawArtists.map((a, i) => ({ ...a, artist_id: am[i]?.artist_id ?? null, following: !!am[i]?.following })),
    });
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 502);
  }
});
