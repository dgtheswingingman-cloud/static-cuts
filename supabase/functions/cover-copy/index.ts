// Supabase Edge Function: cover-copy
//
// Cover suggestions a moderator approved (sc_cover_copy_next): fetch the
// picture, keep it under the covers bucket's 1 MB (shrinking big ones to
// 1000 px JPEG), save it as covers/suggested/<id>.jpg and hand it back
// (sc_cover_copy_done), which makes it a fan cover from whoever suggested it.
// Pictures that can't be fetched or read are marked failed with the reason.
// Called by a timer every 2 minutes through run-job, only when some wait.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const MAX = 1_000_000;

async function fetchPicture(url: string): Promise<{ data: Uint8Array; type: string } | string> {
  let u: URL;
  try { u = new URL(url); } catch { return "not a valid link"; }
  if (u.protocol !== "https:") return "not an https link";
  const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "Mozilla/5.0 (Static-Cuts cover copy)" } }).catch(() => null);
  if (!res) return "the site didn't answer";
  if (!res.ok) return `the site said ${res.status}`;
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/")) return `that link is a ${type || "page"}, not a picture`;
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.length > 15_000_000) return "the picture is over 15 MB";
  return { data, type };
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);
  const { data: todo, error } = await db.rpc("sc_cover_copy_next", { p_secret: secret, p_limit: 10 });
  if (error) return json({ error: error.message }, 403);
  const done = { live: 0, failed: 0 };
  for (const s of (todo ?? []) as { id: string; track_id: string; image_url: string }[]) {
    let url: string | null = null, why: string | null = null;
    try {
      const got = await fetchPicture(s.image_url);
      if (typeof got === "string") why = got;
      else {
        let body = got.data, type = got.type;
        // Big, or a type the bucket won't take: re-encode as JPEG, 1000 px at most.
        if (body.length > MAX || !["image/jpeg", "image/png", "image/webp"].includes(type)) {
          const img = await Image.decode(body).catch(() => null);
          if (!img) why = "couldn't read the picture";
          else {
            if (Math.max(img.width, img.height) > 1000) img.width >= img.height ? img.resize(1000, Image.RESIZE_AUTO) : img.resize(Image.RESIZE_AUTO, 1000);
            for (const q of [85, 70, 55]) { body = await img.encodeJPEG(q); if (body.length <= MAX) break; }
            type = "image/jpeg";
            if (body.length > MAX) why = "the picture is too big even shrunk";
          }
        }
        if (!why) {
          const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
          const path = `suggested/${s.id}.${ext}`;
          const { error: up } = await db.storage.from("covers").upload(path, body, { contentType: type, upsert: true });
          if (up) why = `couldn't save it: ${up.message}`;
          else url = db.storage.from("covers").getPublicUrl(path).data.publicUrl;
        }
      }
    } catch (e) {
      why = String((e as Error)?.message ?? e).slice(0, 200);
    }
    await db.rpc("sc_cover_copy_done", { p_secret: secret, p_id: s.id, p_url: url, p_error: why });
    if (url) done.live++; else done.failed++;
  }
  return json({ ok: true, ...done });
});
