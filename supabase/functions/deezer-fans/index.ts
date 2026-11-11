// Supabase Edge Function: deezer-fans
//
// Reads each artist's Deezer fan count (api.deezer.com/artist/<id>, no key)
// once a month, for the home page's Featured mix: how big an artist is.
// Up to 100 artists a run; every call takes a 'deezer' ticket and respects
// deezer_pause_until, like deezer-sync.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function paused() {
  const { data } = await db.from("sc_private_settings").select("value").eq("key", "deezer_pause_until").maybeSingle();
  return !!(data?.value && Date.parse(data.value) > Date.now());
}
async function pause(minutes: number) {
  await db.from("sc_private_settings").upsert({ key: "deezer_pause_until", value: new Date(Date.now() + minutes * 60_000).toISOString() }, { onConflict: "key" });
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);
  if (await paused()) return json({ ok: true, paused: true });
  const { data: list, error } = await db.rpc("sc_deezer_fans_next", { p_secret: secret, p_limit: 100 });
  if (error) return json({ error: error.message }, 403);
  const items: { artist_id: string; fans: number }[] = [];
  const started = Date.now();
  for (const a of (list ?? []) as { artist_id: string; deezer_id: string }[]) {
    if (Date.now() - started > 40_000) break;
    const { data: ticket } = await db.rpc("sc_api_allow", { p_service: "deezer", p_want: 1 });
    if (ticket !== 1) break;
    const res = await fetch(`https://api.deezer.com/artist/${encodeURIComponent(a.deezer_id)}`).catch(() => null);
    if (!res) break;
    if (res.status === 429) { await pause(5); break; }
    const body: any = await res.json().catch(() => null);
    if (body?.error?.code === 4) { await pause(2); break; }
    if (typeof body?.nb_fan === "number") items.push({ artist_id: a.artist_id, fans: body.nb_fan });
    else if (body?.error) items.push({ artist_id: a.artist_id, fans: 0 });
  }
  if (items.length) {
    const { error: saveErr } = await db.rpc("sc_deezer_fans_save", { p_secret: secret, p_items: items });
    if (saveErr) return json({ error: saveErr.message }, 500);
  }
  return json({ ok: true, saved: items.length });
});
