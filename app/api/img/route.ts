// Same-site copy of an artist photo or cover, so the browser can read its
// colours (pages pick their accent colour from the artist's photo). Only
// image hosts the archive already uses are allowed; results are cached.

const ALLOWED = [/(^|\.)genius\.com$/, /^images\.rapgenius\.com$/, /(^|\.)spotifycdn\.com$/, /^i\.scdn\.co$/, /(^|\.)sndcdn\.com$/, /\.supabase\.co$/];

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("u") ?? "";
  let target: URL;
  try { target = new URL(raw); } catch { return new Response("bad url", { status: 400 }); }
  if (target.protocol !== "https:" || !ALLOWED.some((re) => re.test(target.hostname))) {
    return new Response("not allowed", { status: 403 });
  }
  const res = await fetch(target, { redirect: "follow" }).catch(() => null);
  const type = res?.headers.get("content-type") ?? "";
  if (!res || !res.ok || !type.startsWith("image/")) return new Response("not found", { status: 404 });
  const body = await res.arrayBuffer();
  if (body.byteLength > 5_000_000) return new Response("too big", { status: 413 });
  return new Response(body, {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=604800, s-maxage=2592000, immutable" },
  });
}
