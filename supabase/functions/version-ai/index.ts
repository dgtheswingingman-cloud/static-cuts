// Supabase Edge Function: version-ai
//
// Claude (Haiku) goes through the open sub-version suggestions ("is
// 'Precious [V8]' a version of 'Precious'?"), ~40 at a time, for up to 40
// seconds a run (timer every 2 minutes). Clear yes: applied, as one undoable
// batch. Clear no: dismissed. Unsure: left on the review page with Claude's
// note. Every call takes a 'claude' ticket (sc_api_allow), shared with
// Local Cuts, so people using the site always come first (we stop at half
// the minute's allowance).
//
// While Nathan's PC is running NIX (desktop app, Ollama) the suggestions go
// to the NIX queue instead (free, no daily cap). The PC's yes/no is left for
// review with its note unless nix_ai_auto_apply is 'on'.
//
// NIX learns from your decisions: every prompt includes recent cases where
// you decided differently from what the AI said (sc_nix_lessons), and every
// answer is saved with the model that gave it, so /nix can show how often
// each model agrees with you.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const AI_PAUSE = "claude_pause_until";
const AI_MODEL = "claude-haiku-5-5";

// Claude's monthly budget (about £5 site wide, sc_ai_can_spend): may this
// spend now, and record what each call really cost (from Claude's reply).
async function canSpend(who: "person" | "background") {
  const { data } = await db.rpc("sc_ai_can_spend", { p_who: who });
  return data !== false;
}
async function spent(job: string, out: any) {
  const u = out?.usage;
  if (!u) return;
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  await db.rpc("sc_ai_spend_add", { p_job: job, p_input: input, p_output: u.output_tokens ?? 0 });
}

type Sug = { id: string; artist: string; song: string; status: string; action: string; version: string | null; main_song: string | null; main_exists: boolean; main_artist: string | null };

type Lesson = { line: string; answer: string };

const describe = (s: Sug) =>
  `artist: ${s.artist} | song: "${s.song}" (${s.status}) | suggested main song: "${s.main_song}"` +
  (s.main_exists ? (s.main_artist && s.main_artist !== s.artist ? ` (exists, by ${s.main_artist})` : " (exists)") : " (would be created)") +
  ` | version tag: ${s.version ?? "-"}`;

// Recent cases the archive's owner decided differently from the AI.
async function lessons(): Promise<Lesson[]> {
  const { data } = await db.rpc("sc_nix_lessons", { p_kind: "version-ai", p_limit: 12 });
  return (data ?? []) as Lesson[];
}

function prompt(list: Sug[], past: Lesson[] = []) {
  const lines = list.map((s, i) => `${i + 1}. ${describe(s)}`);
  const learned = past.length
    ? `\n\nThe archive's owner decided these past cases (where the AI was wrong or unsure). Follow the same judgement for similar cases:\n${past.map((l) => `- ${l.line} -> ${l.answer}`).join("\n")}`
    : "";
  return `You check a music archive's automatic "sub-version" suggestions. Each says: this song is a version of that main song (an alternate take of the SAME composition), so it should be grouped under it.

Say "yes" when the song is clearly a version of the same composition: numbered versions ([V1], [V2]), demos, early/alt/rough versions, remixes, live versions, instrumentals, a cappellas, sped up / slowed, remasters, radio/clean/extended edits, karaoke, acoustic, reference tracks, OG/leak versions, "Original", snippets of the same song.
Freestyles, "Demo 1", covers and hooks of a named song count as versions of it ("DEAD (Freestyle)" is a version of "DEAD").
Say "no" when they are probably different songs: the MAIN song's title is itself generic and shared by unrelated tracks (Intro, Outro, Skit, Interlude, Untitled, ???) and the tag is just a disc/album/year/project label; "Pt. 2"/"Part II" sequels; or a tag that names a different album the song isn't from.
Say "unsure" when it isn't a version but the same recording (only a feat./with credit or an alternate subtitle, e.g. "Song (feat. X)" or "Song (Other Name)") — note "same song, possible duplicate" — or when you can't tell.
Only "yes" or "no" when you're confident.${learned}

Suggestions:
${lines.join("\n")}

Reply with JSON only: {"r":[{"n":1,"v":"yes|no|unsure","why":"a few words"}, ...]} covering every number.`;
}

// {"r":[{"n":1,"v":"yes","why":"..."}]} -> rows for sc_version_ai_save.
function readVerdicts(text: string, ids: string[], local: { model: string | null; autoApply: boolean } | null, lines: string[] = []) {
  const clean = text.replace(/```(?:json)?/g, "");
  let answer: any = null;
  try { answer = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1)); } catch { return null; }
  return (Array.isArray(answer?.r) ? answer.r : [])
    .filter((x: any) => Number.isInteger(x?.n) && x.n >= 1 && x.n <= ids.length)
    .map((x: any) => {
      const v = ["yes", "no"].includes(x.v) ? x.v : "unsure";
      const why = String(x.why ?? "").slice(0, 240);
      const seen = { answer: v, model: local ? (local.model ?? "local") : AI_MODEL, line: lines[x.n - 1] ?? null };
      if (local && !local.autoApply) {
        // Left for review, with what the PC thought.
        return { id: ids[x.n - 1], verdict: "unsure", note: `NIX on PC${local.model ? ` (${local.model})` : ""} says ${v}: ${why}`.slice(0, 300), ...seen };
      }
      return { id: ids[x.n - 1], verdict: v, note: why, ...seen };
    });
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);
  const started = Date.now();
  const done = { checked: 0, yes: 0, no: 0, unsure: 0, applied: 0 };

  // NIX on Nathan's PC: save what it finished, then queue more while it's online.
  const { data: ai } = await db.rpc("sc_nix_ai_state", { p_secret: secret, p_kind: "version-ai" });
  const { data: got } = await db.rpc("sc_nix_ai_collect", { p_secret: secret, p_kind: "version-ai" });
  let byPc = 0;
  for (const j of (got ?? []) as { payload: { ids: string[]; lines?: string[] }; output: string | null; error: string | null; model: string | null }[]) {
    if (j.error || !j.output) continue; // their claims run out and they're tried again
    const items = readVerdicts(j.output, j.payload.ids ?? [], { model: j.model, autoApply: !!ai?.auto_apply }, j.payload.lines ?? []);
    if (!items?.length) continue;
    const { data: saved } = await db.rpc("sc_version_ai_save", { p_secret: secret, p_items: items });
    byPc += items.length;
    done.applied += (saved as any)?.applied ?? 0;
  }
  if (ai?.online) {
    if (ai.waiting > 0) return json({ ok: true, checked_by_pc: byPc, applied: done.applied, waiting_for_pc: ai.waiting });
    const { data: list, error } = await db.rpc("sc_version_ai_next", { p_secret: secret, p_limit: 40 });
    if (error) return json({ error: error.message }, 403);
    const sugs = (list ?? []) as Sug[];
    if (sugs.length) {
      await db.rpc("sc_nix_ai_enqueue", { p_secret: secret, p_kind: "version-ai", p_prompt: prompt(sugs, await lessons()), p_payload: { ids: sugs.map((x) => x.id), lines: sugs.map(describe) }, p_json: true });
    }
    return json({ ok: true, checked_by_pc: byPc, applied: done.applied, sent_to_pc: sugs.length });
  }

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ ok: true, skipped: "Claude isn't set up", checked_by_pc: byPc });
  if (!(await canSpend("background"))) return json({ ok: true, skipped: "Claude's monthly budget: NIX's share is used", checked_by_pc: byPc });

  // Daily cap, so a big import is worked through over a few days instead of
  // spending in one go: version_ai_per_day (default 500) suggestions a UTC
  // day, plus any "check more today" an admin asked for (version_ai_extra,
  // "YYYY-MM-DD:N", only counts on that day).
  const today = new Date().toISOString().slice(0, 10);
  const { data: capRow } = await db.from("sc_private_settings").select("value").eq("key", "version_ai_per_day").maybeSingle();
  const { data: extraRow } = await db.from("sc_private_settings").select("value").eq("key", "version_ai_extra").maybeSingle();
  const [extraDay, extraN] = String(extraRow?.value ?? "").split(":");
  const cap = (Number(capRow?.value) >= 0 && capRow?.value != null ? Number(capRow.value) : 500) + (extraDay === today ? Number(extraN) || 0 : 0);
  const { count: checkedToday } = await db.from("version_suggestions").select("id", { count: "exact", head: true }).gte("ai_checked_at", `${today}T00:00:00Z`);
  const left = () => cap - (checkedToday ?? 0) - done.checked;
  if (left() <= 0) return json({ ok: true, skipped: `daily cap reached (${cap})`, ...done });

  const past = await lessons();
  while (Date.now() - started < 40_000 && left() > 0) {
    const { data: pause } = await db.from("sc_private_settings").select("value").eq("key", AI_PAUSE).maybeSingle();
    if (pause?.value && Date.parse(pause.value) > Date.now()) break;
    if (done.checked > 0 && !(await canSpend("background"))) break;
    // Leave room for people using Local Cuts: at most half the minute's tickets.
    const { data: perMin } = await db.from("sc_private_settings").select("value").eq("key", "claude_per_minute").maybeSingle();
    const { data: used } = await db.from("api_budget").select("calls").in("service", ["claude", "claudemax"]).eq("minute", new Date(Math.floor(Date.now() / 60000) * 60000).toISOString());
    const usedNow = (used ?? []).reduce((n: number, r: any) => n + (r.calls ?? 0), 0);
    if (usedNow >= Math.floor(Number(perMin?.value ?? 20) / 2)) break;

    const { data: list, error } = await db.rpc("sc_version_ai_next", { p_secret: secret, p_limit: Math.min(40, left()) });
    if (error) return json({ error: error.message }, 403);
    const sugs = (list ?? []) as Sug[];
    if (sugs.length === 0) break;
    const { data: ticket } = await db.rpc("sc_api_allow", { p_service: "claude", p_want: 1 });
    if (ticket !== 1) break; // claims expire in 10 minutes

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 4000, messages: [{ role: "user", content: prompt(sugs, past) }] }),
    }).catch(() => null);
    if (!res) break;
    if (res.status === 429 || res.status === 529) {
      const wait = Number(res.headers.get("retry-after")) || 60;
      await db.from("sc_private_settings").upsert({ key: AI_PAUSE, value: new Date(Date.now() + Math.max(wait, 120) * 1000).toISOString() }, { onConflict: "key" });
      break;
    }
    const out: any = await res.json().catch(() => null);
    await spent("version-ai", out);
    if (!res.ok) return json({ error: `Claude: ${out?.error?.message ?? res.status}`, ...done }, 502);
    const text = String((out?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text ?? "").join(""));
    const items = readVerdicts(text, sugs.map((x) => x.id), null, sugs.map(describe));
    if (!items) break; // left for next time
    const { data: saved, error: sErr } = await db.rpc("sc_version_ai_save", { p_secret: secret, p_items: items });
    if (sErr) return json({ error: sErr.message, ...done }, 500);
    done.checked += items.length;
    for (const it of items) done[it.verdict as "yes" | "no" | "unsure"]++;
    done.applied += (saved as any)?.applied ?? 0;
  }
  return json({ ok: true, ...done });
});
