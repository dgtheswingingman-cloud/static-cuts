// Supabase Edge Function: desktop-download
//
// The Static-Cuts desktop app's installer, for premium members. The installer
// lives in the private "desktop" storage bucket (uploaded by the Windows build,
// .github/workflows/desktop.yml); the newest one is the latest row in
// desktop_releases. A signed-in premium member gets a download link that works
// for 10 minutes; anyone else gets told why not.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who } = await db.auth.getUser(token);
    const user = who?.user;
    if (!user) return json({ error: "Log in to download the app." }, 401);

    const { data: premium } = await db.rpc("is_premium", { p_user: user.id });
    if (!premium) return json({ error: "The desktop app is part of premium." }, 403);

    const { data: rel } = await db.from("desktop_releases").select("version, path, size, created_at")
      .eq("platform", "windows").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!rel) return json({ error: "The first download isn't up yet. Check back soon." }, 404);

    const name = `Static-Cuts ${rel.version} setup.exe`;
    const { data: signed, error } = await db.storage.from("desktop").createSignedUrl(rel.path, 600, { download: name });
    if (error || !signed) return json({ error: "The download couldn't be made just now. Try again in a minute." }, 500);
    return json({ url: signed.signedUrl, version: rel.version, size: rel.size, released: rel.created_at });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
