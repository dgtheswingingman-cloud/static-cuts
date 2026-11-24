// Supabase Edge Function: nix-check
//
// Claude (Haiku) checks NIX's work: every suggestion NIX makes on
// /review/nix, then every review note (clean-up, bio mix-ups, Deezer,
// duplicates), one kind at a time (15-40 items a call) for up to 45 seconds
// a run (NIX timer "nix-check", every 2 minutes while anything is waiting).
//
// Claude says agree / disagree / unsure, and the right answer when it
// disagrees (sc_nix_check_save). Nothing on the site changes because of it:
// the review page sorts by it, review pages show it next to NIX's note, and
// Claude's disagreements go into NIX's next prompts as worked examples.
//
// Then the final say (sc_nix_judge_batch / sc_nix_judge_save): every item
// where the check disagreed with NIX goes to a second, more careful pass
// (medium effort) that sees both answers and picks who was right and the
// correct answer. That moves NIX-was-right suggestions to "Claude agrees",
// dismisses wrong ones, keeps corrected values for review, and gives NIX's
// prompts reliable worked examples.
//
// It's background work: it stops when NIX's share of Claude's monthly
// budget is used (sc_ai_can_spend('background')), takes a 'claude' ticket
// per call (sc_api_allow), and leaves half of each minute's tickets for
// people using Local Cuts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const AI_PAUSE = "claude_pause_until";
const AI_MODEL = "claude-haiku-5-5";

async function canSpend() {
  const { data } = await db.rpc("sc_ai_can_spend", { p_who: "background" });
  return data !== false;
}
async function spent(out: any) {
  const u = out?.usage;
  if (!u) return;
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  await db.rpc("sc_ai_spend_add", { p_job: "nix-check", p_input: input, p_output: u.output_tokens ?? 0 });
}

// "1|agree", "2|disagree|keep linked|a remaster is a version", "3|unsure|why"
type Verdict = { n: number; v: string; answer?: string; why?: string };
function readLines(text: string): Verdict[] {
  const out: Verdict[] = [];
  for (const raw of text.split("\n")) {
    const m = raw.trim().replace(/^[-*]\s*/, "").match(/^(\d+)\s*[|.:)]\s*(agree|disagree|unsure)\b\s*\|?\s*(.*)$/i);
    if (!m) continue;
    const v = m[2].toLowerCase();
    const rest = m[3].split("|").map((s) => s.trim()).filter(Boolean);
    if (v === "disagree") out.push({ n: Number(m[1]), v, answer: rest[0] ?? "", why: rest.slice(1).join(" | ") || rest[0] || "" });
    else out.push({ n: Number(m[1]), v, why: rest.join(" | ") });
  }
  return out;
}

// "1|nix|why", "2|checker|answer|why", "3|neither|answer|why", "4|unsure|why"
type Judged = { n: number; side: string; answer?: string; why?: string };
function readJudged(text: string): Judged[] {
  const out: Judged[] = [];
  for (const raw of text.split("\n")) {
    const m = raw.trim().replace(/^[-*]\s*/, "").match(/^(\d+)\s*[|.:)]\s*(nix|checker|neither|unsure)\b\s*\|?\s*(.*)$/i);
    if (!m) continue;
    const side = m[2].toLowerCase();
    const rest = m[3].split("|").map((x) => x.trim()).filter(Boolean);
    if (side === "checker" || side === "neither") out.push({ n: Number(m[1]), side, answer: rest[0] ?? "", why: rest.slice(1).join(" | ") || "" });
    else out.push({ n: Number(m[1]), side, why: rest.join(" | ") });
  }
  return out;
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ ok: true, skipped: "Claude isn't set up" });
  const started = Date.now();
  const done = { checked: 0, agree: 0, disagree: 0, unsure: 0, judged: 0, nix_right: 0, nix_wrong: 0, calls: 0, kinds: [] as string[] };
  let stopped: string | null = null;

  while (Date.now() - started < 45_000) {
    const { data: pause } = await db.from("sc_private_settings").select("value").eq("key", AI_PAUSE).maybeSingle();
    if (pause?.value && Date.parse(pause.value) > Date.now()) { stopped = "Claude is paused for a moment"; break; }
    if (!(await canSpend())) { stopped = "NIX's share of Claude's budget is used for today or this month"; break; }
    // Leave room for people using Local Cuts: at most half the minute's tickets.
    const { data: perMin } = await db.from("sc_private_settings").select("value").eq("key", "claude_per_minute").maybeSingle();
    const { data: used } = await db.from("api_budget").select("calls").in("service", ["claude", "claudemax"]).eq("minute", new Date(Math.floor(Date.now() / 60000) * 60000).toISOString());
    const usedNow = (used ?? []).reduce((n: number, r: any) => n + (r.calls ?? 0), 0);
    if (usedNow >= Math.floor(Number(perMin?.value ?? 20) / 2)) { stopped = "leaving room for Local Cuts this minute"; break; }

    // Checking first; when nothing is waiting, the final say on disagreements.
    let { data: batch, error } = await db.rpc("sc_nix_check_batch", { p_secret: secret, p_limit: 40 });
    if (error) return json({ error: error.message, ...done }, 403);
    if (!batch) ({ data: batch, error } = await db.rpc("sc_nix_judge_batch", { p_secret: secret, p_limit: 15 }));
    if (error) return json({ error: error.message, ...done }, 403);
    if (!batch) break; // nothing waiting
    const judging = (batch as any).stage === "judge";
    // A careful pass can take a while: only start one with time to finish.
    if (judging && Date.now() - started > 25_000) break; // claims expire in 5 minutes
    const keys = (batch as any).keys as string[];
    if (!done.kinds.includes((batch as any).kind)) done.kinds.push((batch as any).kind);
    const { data: ticket } = await db.rpc("sc_api_allow", { p_service: "claude", p_want: 1 });
    if (ticket !== 1) { stopped = "no Claude ticket this minute"; break; } // claims expire in 5 minutes

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      // Titles, version audit, duplicates and clean-up: thinking off, a quick
      // call per item. Eras, reading notes, bios and Deezer: a little thinking
      // (low effort), because answering straight off got those wrong too often.
      body: JSON.stringify({
        model: AI_MODEL, messages: [{ role: "user", content: (batch as any).prompt }],
        ...(judging
          ? { max_tokens: 16000, output_config: { effort: "medium" } }
          : (batch as any).think
          ? { max_tokens: 8000, output_config: { effort: "low" } }
          : { max_tokens: 2500, thinking: { type: "disabled" } }),
      }),
    }).catch(() => null);
    if (!res) { stopped = "couldn't reach Claude"; break; }
    if (res.status === 429 || res.status === 529) {
      const wait = Number(res.headers.get("retry-after")) || 60;
      await db.from("sc_private_settings").upsert({ key: AI_PAUSE, value: new Date(Date.now() + Math.max(wait, 120) * 1000).toISOString() }, { onConflict: "key" });
      stopped = "Claude is busy";
      break;
    }
    const out: any = await res.json().catch(() => null);
    done.calls++;
    await spent(out);
    if (!res.ok) return json({ error: `Claude: ${out?.error?.message ?? res.status}`, ...done }, 502);
    const text = String((out?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text ?? "").join(""));
    if (judging) {
      const judged = readJudged(text).filter((x) => x.n >= 1 && x.n <= keys.length);
      const { data: saved, error: jErr } = await db.rpc("sc_nix_judge_save", { p_secret: secret, p_keys: keys, p_items: judged });
      if (jErr) return json({ error: jErr.message, ...done }, 500);
      done.judged += Number(saved) || 0;
      for (const j of judged) { if (j.side === "nix") done.nix_right++; else if (j.side !== "unsure") done.nix_wrong++; }
      if (!judged.length) { stopped = `couldn't read the final say: ${text.slice(0, 300)}`; break; }
      continue;
    }
    const items = readLines(text).filter((x) => x.n >= 1 && x.n <= keys.length);
    const { data: saved, error: sErr } = await db.rpc("sc_nix_check_save", { p_secret: secret, p_keys: keys, p_items: items, p_model: AI_MODEL });
    if (sErr) return json({ error: sErr.message, ...done }, 500);
    done.checked += Number(saved) || 0;
    for (const it of items) done[it.v as "agree" | "disagree" | "unsure"]++;
    if (!items.length) { stopped = `couldn't read Claude's answer: ${text.slice(0, 300)}`; break; }
  }
  return json({ ok: true, ...done, stopped });
});
