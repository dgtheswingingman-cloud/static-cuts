// Supabase Edge Function: fetch-covers
//
// Looks up artwork for songs with a Spotify link using Spotify's public
// embed info (https://open.spotify.com/oembed), which needs no API key.
// Called by a database timer every 10 minutes (see
// 20261019170000_cover_art.sql): up to 20 songs a run, 2 seconds apart,
// stopping early if Spotify says to slow down.

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

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);

  const { data: todo, error } = await db.rpc("sc_cover_next", { p_secret: secret, p_limit: 20 });
  if (error) return json({ error: error.message }, 403);

  const found: { track_id: string; cover_url: string | null }[] = [];
  let stopped: string | null = null;
  for (const t of (todo ?? []) as { track_id: string; spotify_url: string }[]) {
    const url = t.spotify_url.split("?")[0];
    try {
      const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
      if (res.status === 429) { stopped = `slow down (retry after ${res.headers.get("retry-after") ?? "?"}s)`; break; }
      if (res.ok) {
        const info = await res.json();
        found.push({ track_id: t.track_id, cover_url: typeof info?.thumbnail_url === "string" ? info.thumbnail_url : null });
      } else {
        found.push({ track_id: t.track_id, cover_url: null });
      }
    } catch {
      // Network hiccup: try this one again next run.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  const { data: saved, error: saveErr } = await db.rpc("sc_cover_save", { p_secret: secret, p_items: found });
  if (saveErr) return json({ error: saveErr.message }, 500);
  return json({ ok: true, checked: found.length, saved, stopped });
});
