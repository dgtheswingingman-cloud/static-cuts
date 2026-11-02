// Supabase Edge Function: send-push
//
// Phone alerts. Called by a database timer every 2 minutes (see
// 20261021010000_community_pack.sql): sends new personal notifications
// (release day, followed artists, replies...) to every device where the
// person turned phone alerts on. Admin alerts stay on the site. A device
// that's gone (the browser says 404/410) is switched off.
//
// The signing keys live in sc_private_settings (vapid_public/vapid_private).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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

type Sub = { endpoint: string; p256dh: string; auth: string };
type Item = { title: string; body: string | null; link: string | null; subs: Sub[] | null };

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);

  const { data: keys } = await db.from("sc_private_settings").select("key, value").in("key", ["vapid_public", "vapid_private"]);
  const pub = keys?.find((k) => k.key === "vapid_public")?.value;
  const priv = keys?.find((k) => k.key === "vapid_private")?.value;
  // Phone alerts not switched on yet: nothing to do (not a failure).
  if (!pub || !priv) return json({ ok: true, skipped: "push keys aren't set up" });
  webpush.setVapidDetails("mailto:dg.theswingingman@gmail.com", pub, priv);

  const { data: items, error } = await db.rpc("sc_push_next", { p_secret: secret, p_limit: 50 });
  if (error) return json({ error: error.message }, 403);

  let sent = 0;
  const gone: string[] = [];
  for (const it of (items ?? []) as Item[]) {
    const payload = JSON.stringify({
      title: it.title,
      body: it.body ?? "",
      url: it.link ? new URL(it.link, "https://static-cuts.com").toString() : "https://static-cuts.com/notifications",
    });
    for (const s of it.subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 });
        sent++;
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) gone.push(s.endpoint);
      }
    }
  }
  if (gone.length) await db.rpc("sc_push_failed", { p_secret: secret, p_endpoints: gone });
  return json({ ok: true, notifications: (items ?? []).length, sent, switched_off: gone.length });
});
