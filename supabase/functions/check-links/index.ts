// Supabase Edge Function: check-links
//
// Dead link checker. Called by a database timer every 30 minutes (see
// 20261020100000_wrap_up_pack.sql): looks at up to 15 YouTube and
// SoundCloud links, using their public "embed info" pages (oEmbed), which
// say "not found" once a video or track has been taken down. Private or
// embed-blocked links aren't counted as dead. A link is only treated as gone
// after two "not found" answers a day apart; the database does the rest.
//
// Every call takes a ticket from that site's shared allowance first
// (sc_api_allow), with 2 seconds between calls.

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

function oembedFor(url: string): { service: string; endpoint: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  if (host === "youtube.com" || host === "youtu.be") {
    // Videos only: channels and playlists aren't something oEmbed can check.
    if (host === "youtube.com" && !u.searchParams.get("v") && !u.pathname.startsWith("/shorts/")) return null;
    // YouTube Music and phone links work on the normal site.
    u.hostname = host === "youtu.be" ? "youtu.be" : "www.youtube.com";
    return { service: "youtube", endpoint: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u.toString())}` };
  }
  if (host === "soundcloud.com") {
    u.hostname = "soundcloud.com";
    return { service: "soundcloud", endpoint: `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(u.toString())}` };
  }
  return null;
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);

  const { data: due, error } = await db.rpc("sc_link_check_next", { p_secret: secret, p_limit: 15 });
  if (error) return json({ error: error.message }, 403);

  const results: { url: string; status: number }[] = [];
  const stopped: Record<string, string> = {};
  for (const { url } of (due ?? []) as { url: string }[]) {
    const o = oembedFor(url);
    if (!o || stopped[o.service]) continue;
    const { data: ticket } = await db.rpc("sc_api_allow", { p_service: o.service, p_want: 1 });
    if (ticket !== 1) { stopped[o.service] = "allowance used up or paused"; continue; }
    let status = 0;
    try {
      const res = await fetch(o.endpoint, { redirect: "follow" });
      status = res.status;
      await res.body?.cancel();
    } catch {
      status = 0; // network trouble: try again next time
    }
    if (status === 429) {
      const until = new Date(Date.now() + 3600 * 1000).toISOString();
      await db.from("sc_private_settings").upsert({ key: `${o.service}_pause_until`, value: until }, { onConflict: "key" });
      stopped[o.service] = "asked to slow down";
      continue;
    }
    // Only real answers are saved; 0 and 5xx mean "couldn't tell".
    if (status > 0 && status < 500) results.push({ url, status });
    await sleep(2000);
  }

  const { data: saved, error: saveErr } = await db.rpc("sc_link_check_save", { p_secret: secret, p_items: results });
  if (saveErr) return json({ error: saveErr.message }, 500);
  return json({ ok: true, ...saved, stopped });
});
