// Supabase Edge Function: version-ai
//
// Claude (Haiku) goes through the open sub-version suggestions ("is
// 'Precious [V8]' a version of 'Precious'?"), ~40 at a time, for up to 40
// seconds a run (timer every 2 minutes). Clear yes: applied, as one undoable
// batch. Clear no: dismissed. Unsure: left on the review page with Claude's
// note. Every call takes a 'claude' ticket (sc_api_allow), shared with
// Local Cuts, so people using the site always come first (we stop at half
// the minute's allowance).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const AI_PAUSE = "claude_pause_until";
const AI_MODEL = "claude-haiku-5-5";

type Sug = { id: string; artist: string; song: string; status: string; action: string; version: string | null; main_song: string | null; main_exists: boolean; main_artist: string | null };

function prompt(list: Sug[]) {
  const lines = list.map((s, i) =>
    `${i + 1}. artist: ${s.artist} | song: "${s.song}" (${s.status}) | suggested main song: "${s.main_song}"` +
    (s.main_exists ? (s.main_artist && s.main_artist !== s.artist ? ` (exists, by ${s.main_artist})` : " (exists)") : " (would be created)") +
    ` | version tag: ${s.version ?? "-"}`);
  return `You check a music archive's automatic "sub-version" suggestions. Each says: this song is a version of that main song (an alternate take of the SAME composition), so it should be grouped under it.

Say "yes" when the song is clearly a version of the same composition: numbered versions ([V1], [V2]), demos, early/alt/rough versions, remixes, live versions, instrumentals, a cappellas, sped up / slowed, remasters, radio/clean/extended edits, karaoke, acoustic, reference tracks, OG/leak versions, "Original", snippets of the same song.
Freestyles, "Demo 1", covers and hooks of a named song count as versions of it ("DEAD (Freestyle)" is a version of "DEAD").
Say "no" when they are probably different songs: the MAIN song's title is itself generic and shared by unrelated tracks (Intro, Outro, Skit, Interlude, Untitled, ???) and the tag is just a disc/album/year/project label; "Pt. 2"/"Part II" sequels; or a tag that names a different album the song isn't from.
Say "unsure" when it isn't a version but the same recording (only a feat./with credit or an alternate subtitle, e.g. "Song (feat. X)" or "Song (Other Name)") — note "same song, possible duplicate" — or when you can't tell.
Only "yes" or "no" when you're confident.

Suggestions:
${lines.join("\n")}

Reply with JSON only: {"r":[{"n":1,"v":"yes|no|unsure","why":"a few words"}, ...]} covering every number.`;
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ ok: true, skipped: "Claude isn't set up" });
  const started = Date.now();
  const done = { checked: 0, yes: 0, no: 0, unsure: 0, applied: 0 };

  while (Date.now() - started < 40_000) {
    const { data: pause } = await db.from("sc_private_settings").select("value").eq("key", AI_PAUSE).maybeSingle();
    if (pause?.value && Date.parse(pause.value) > Date.now()) break;
    // Leave room for people using Local Cuts: at most half the minute's tickets.
    const { data: perMin } = await db.from("sc_private_settings").select("value").eq("key", "claude_per_minute").maybeSingle();
    const { data: used } = await db.from("api_budget").select("calls").in("service", ["claude", "claudemax"]).eq("minute", new Date(Math.floor(Date.now() / 60000) * 60000).toISOString());
    const usedNow = (used ?? []).reduce((n: number, r: any) => n + (r.calls ?? 0), 0);
    if (usedNow >= Math.floor(Number(perMin?.value ?? 20) / 2)) break;

    const { data: list, error } = await db.rpc("sc_version_ai_next", { p_secret: secret, p_limit: 40 });
    if (error) return json({ error: error.message }, 403);
    const sugs = (list ?? []) as Sug[];
    if (sugs.length === 0) break;
    const { data: ticket } = await db.rpc("sc_api_allow", { p_service: "claude", p_want: 1 });
    if (ticket !== 1) break; // claims expire in 10 minutes

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 4000, messages: [{ role: "user", content: prompt(sugs) }] }),
    }).catch(() => null);
    if (!res) break;
    if (res.status === 429 || res.status === 529) {
      const wait = Number(res.headers.get("retry-after")) || 60;
      await db.from("sc_private_settings").upsert({ key: AI_PAUSE, value: new Date(Date.now() + Math.max(wait, 120) * 1000).toISOString() }, { onConflict: "key" });
      break;
    }
    const out: any = await res.json().catch(() => null);
    if (!res.ok) return json({ error: `Claude: ${out?.error?.message ?? res.status}`, ...done }, 502);
    const text = String((out?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text ?? "").join("")).replace(/```(?:json)?/g, "");
    let answer: any = null;
    try { answer = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { /* left for next time */ }
    if (!answer) break;

    const items = (Array.isArray(answer?.r) ? answer.r : [])
      .filter((x: any) => Number.isInteger(x?.n) && x.n >= 1 && x.n <= sugs.length)
      .map((x: any) => ({ id: sugs[x.n - 1].id, verdict: ["yes", "no"].includes(x.v) ? x.v : "unsure", note: String(x.why ?? "").slice(0, 300) }));
    const { data: saved, error: sErr } = await db.rpc("sc_version_ai_save", { p_secret: secret, p_items: items });
    if (sErr) return json({ error: sErr.message, ...done }, 500);
    done.checked += items.length;
    for (const it of items) done[it.verdict as "yes" | "no" | "unsure"]++;
    done.applied += (saved as any)?.applied ?? 0;
  }
  return json({ ok: true, ...done });
});
