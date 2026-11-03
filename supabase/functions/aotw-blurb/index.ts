// Supabase Edge Function: aotw-blurb
//
// Claude (Haiku) writes a short blurb for each album on the Album of the
// week shortlist (sc_aotw_blurb_next / sc_aotw_blurb_save). The owner picks
// one and can edit its blurb. Takes a 'claude' ticket (sc_api_allow) and
// respects claude_pause_until, like the other Claude jobs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const AI_PAUSE = "claude_pause_until";
const AI_MODEL = "claude-haiku-5-5";

type Item = { week_start: string; artist_id: string; album_key: string; artist: string; title: string; year: number | null; unreleased: number; released: number; highlights: string[] };

function prompt(list: Item[]) {
  const lines = list.map((a, i) =>
    `${i + 1}. "${a.title}" by ${a.artist}${a.year ? ` (${a.year})` : ""} | unreleased songs from this era in the archive: ${a.unreleased}` +
    (a.highlights.length ? ` | some of them: ${a.highlights.slice(0, 4).join(", ")}` : ""));
  return `You write "Album of the week" blurbs for Static Cuts//, a fan archive of unreleased and released music (underground rap, Opium, Drain Gang and similar scenes).

For each album write 2 short sentences, 45 words at most: why it's worth a listen (sound, mood, place in the artist's story), then a nod to the unreleased songs from that era on the site if there are any.
Voice: a fan talking to fans. Casual, confident, British spelling. No hashtags, no emojis, no quotes from anyone, no "dive in" or "masterpiece".
Facts: only say things that are widely known. Never invent dates, chart positions, sales, features or stories. If you don't know the album well, talk about its sound and the artist instead.
Never say where to download or find leaks.

Albums:
${lines.join("\n")}

Reply with one line per album and nothing else, in this form:
1: the blurb
2: the blurb`;
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ ok: true, skipped: "Claude isn't set up" });

  const { data: pause } = await db.from("sc_private_settings").select("value").eq("key", AI_PAUSE).maybeSingle();
  if (pause?.value && Date.parse(pause.value) > Date.now()) return json({ ok: true, paused: true });

  const { data: list, error } = await db.rpc("sc_aotw_blurb_next", { p_secret: secret, p_limit: 8 });
  if (error) return json({ error: error.message }, 403);
  const items = (list ?? []) as Item[];
  if (items.length === 0) return json({ ok: true, written: 0 });
  const { data: ticket } = await db.rpc("sc_api_allow", { p_service: "claude", p_want: 1 });
  if (ticket !== 1) return json({ ok: true, waiting: "no ticket" }); // claims expire in 10 minutes

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: 8000, messages: [{ role: "user", content: prompt(items) }] }),
  }).catch(() => null);
  if (!res) return json({ ok: true, waiting: "Claude didn't answer" });
  if (res.status === 429 || res.status === 529) {
    const wait = Number(res.headers.get("retry-after")) || 60;
    await db.from("sc_private_settings").upsert({ key: AI_PAUSE, value: new Date(Date.now() + Math.max(wait, 120) * 1000).toISOString() }, { onConflict: "key" });
    return json({ ok: true, paused: true });
  }
  const out: any = await res.json().catch(() => null);
  if (!res.ok) return json({ error: `Claude: ${out?.error?.message ?? res.status}` }, 502);
  const text = String((out?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text ?? "").join(""));
  // "1: blurb" per line.
  const save = text.split("\n")
    .map((line) => line.match(/^\s*(\d+)[:.)]\s*(.+?)\s*$/))
    .filter((m): m is RegExpMatchArray => !!m && !!items[Number(m[1]) - 1] && m[2].length > 20)
    .map((m) => {
      const it = items[Number(m[1]) - 1];
      return { week_start: it.week_start, artist_id: it.artist_id, album_key: it.album_key, blurb: m[2].replace(/^["“]|["”]$/g, "") };
    });
  if (save.length === 0) return json({ ok: true, written: 0, note: "couldn't read Claude's answer", got: text.slice(0, 300), stop: out?.stop_reason ?? null, blocks: (out?.content ?? []).map((c: any) => c.type) });
  const { data: n, error: saveErr } = await db.rpc("sc_aotw_blurb_save", { p_secret: secret, p_items: save });
  if (saveErr) return json({ error: saveErr.message }, 500);
  return json({ ok: true, written: n });
});
