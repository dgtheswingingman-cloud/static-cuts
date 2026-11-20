// Supabase Edge Function: desktop-update
//
// Where the desktop app asks "is there a newer version?" (Tauri updater). It
// answers 204 (no) or the newest signed Windows build: version, signature and
// a download link (from the private "desktop" bucket, valid for a day). The
// app checks the signature against the key it was built with, so a wrong or
// tampered file is refused. Publishing is done by the Windows build.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const parts = (v: string) => v.replace(/^v/, "").split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
function newer(a: string, b: string) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

Deno.serve(async (req) => {
  try {
    const u = new URL(req.url);
    const current = u.searchParams.get("current_version") ?? "0.0.0";
    const target = u.searchParams.get("target") ?? "windows";
    if (!target.startsWith("windows")) return new Response(null, { status: 204 });

    const { data: rel } = await db.from("desktop_releases").select("version, path, signature, created_at")
      .eq("platform", "windows").not("signature", "is", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!rel || !newer(rel.version, current)) return new Response(null, { status: 204 });

    const { data: signed } = await db.storage.from("desktop").createSignedUrl(rel.path, 86400);
    if (!signed) return new Response(null, { status: 204 });
    return Response.json({
      version: rel.version,
      notes: "A new version of the Static-Cuts app.",
      pub_date: new Date(rel.created_at).toISOString(),
      platforms: { "windows-x86_64": { signature: rel.signature, url: signed.signedUrl } },
    });
  } catch {
    return new Response(null, { status: 204 });
  }
});
