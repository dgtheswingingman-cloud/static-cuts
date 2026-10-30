// Supabase Edge Function: local-ai
//
// Local Cuts "ask Claude": for music files that didn't match cleanly, Claude
// gets each file's title, artist, file name and length plus the closest songs
// (and their versions) on the site (sc_local_candidates), and picks the song
// and exact version, or says it isn't here and tidies it up (title, status,
// version, producers, features) so it can be suggested as a new song.
// Only text is sent, never music. Signed-in people only; each call takes a
// ticket from the shared 'claude' allowance and one from the person's daily
// Local Cuts limit (sc_local_ai_take).
//
// POST {items: [{ref, title, artist, file_name, length}]}  (up to 25)
//   -> {results: [{ref, track_id, title, version_of, artist_id, artist_name,
//                  confidence, why, clean}]}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const AI_PAUSE = "claude_pause_until";
const AI_MODEL = "claude-haiku-5-5";
const STATUSES = ["released", "leaked", "snippet", "rumored", "teased", "announced"];

type Item = { ref: string; title: string; artist: string; file_name: string; length: number | null };
type Cand = { id: string; title: string; version_of: string | null; status: string | null; length: number | null; album: string | null };
type Found = { ref: string; artist_id: string | null; artist_name?: string; candidates: Cand[] };
type Clean = { title: string | null; artist: string | null; status: string | null; version: string | null; producers: string | null; featuring: string | null; note: string | null };

const mmss = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "?");
const cut = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");
const str = (v: unknown, n = 200) => { const s = cut(v, n); return s ? s : null; };

function buildPrompt(items: Item[], found: Map<string, Found>, codes: Map<string, Map<string, Cand>>) {
  const blocks = items.map((it, i) => {
    const f = found.get(it.ref)!;
    const lines = [
      `FILE ${i + 1}`,
      `  title in file: ${JSON.stringify(cut(it.title, 200))}`,
      `  artist in file: ${JSON.stringify(cut(it.artist, 120))}`,
      `  file name: ${JSON.stringify(cut(it.file_name, 200))}`,
      `  length: ${mmss(it.length)}`,
    ];
    if (!f.artist_id) {
      lines.push("  This artist isn't on the site (under this spelling), so there are no songs to pick from.");
    } else {
      const map = new Map<string, Cand>();
      const byId = new Map(f.candidates.map((c, k) => [c.id, `${i + 1}${String.fromCharCode(97 + (k % 26))}${k >= 26 ? Math.floor(k / 26) : ""}`]));
      lines.push(`  Songs on the site by ${f.artist_name}, closest first:`);
      if (f.candidates.length === 0) lines.push("    (none close)");
      f.candidates.forEach((c) => {
        const code = byId.get(c.id)!;
        map.set(code, c);
        const parent = c.version_of ? byId.get(c.version_of) : null;
        lines.push(`    ${code}) ${JSON.stringify(cut(c.title, 150))} — ${c.version_of ? `version of ${parent ?? "another song"}` : "main song"}, ${c.status ?? "status unknown"}, ${mmss(c.length)}${c.album ? `, ${JSON.stringify(cut(c.album, 80))}` : ""}`);
      });
      codes.set(it.ref, map);
    }
    return lines.join("\n");
  });
  return `You are matching someone's music files to songs in a fan-run music archive (released songs, leaks, snippets and versions).

${blocks.join("\n\n")}

For each file, decide:
- pick: the code of the song on the site that this file IS (the exact version if you can tell), or null if none of them is this song.
  Use the title, the version hints ("V2", "Demo", "Mixed", "OG", "Snippet"...) and the length (within a few seconds is a strong sign of the same version). Don't pick a song just because the name is similar: it must be the same song. If the file is clearly a version that isn't listed, pick null.
- confidence: "high" (sure), "medium" (probably), "low" (a guess).
- why: under 12 words.
- clean: what the file really is, tidied:
  title (the song name only: no artist, no "(prod. X)", no [CDQ]/[HQ]/"Leak"/"Final"/".mp3"; keep a real version name like "(Remix)" or "[V2]"),
  artist (the main artist's proper name), status (released / leaked / snippet / rumored / teased / announced, or null if nothing says),
  version (e.g. "V2", "Demo", "Snippet 2", or null), producers (or null), featuring (or null), note (quality or other useful detail like "CDQ", or null).

Reply with ONLY a JSON object, no other text:
{"files":[{"file":1,"pick":"1a" or null,"confidence":"high","why":"...","clean":{"title":"...","artist":"...","status":null,"version":null,"producers":null,"featuring":null,"note":null}}]}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // Who's asking.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who } = await db.auth.getUser(token);
    const user = who?.user;
    if (!user) return json({ error: "Log in to ask Claude." }, 401);

    const body = await req.json().catch(() => null);
    const items: Item[] = (Array.isArray(body?.items) ? body.items : []).slice(0, 25).map((x: any, i: number) => ({
      ref: cut(x?.ref, 200) || String(i), title: cut(x?.title, 300), artist: cut(x?.artist, 200), file_name: cut(x?.file_name, 300),
      length: Number.isFinite(Number(x?.length)) && Number(x.length) > 0 ? Math.round(Number(x.length)) : null,
    })).filter((x: Item) => x.title || x.file_name);
    if (items.length === 0) return json({ results: [] });

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "Claude isn't set up on the site yet." }, 500);

    // Premium only (the owner always has it).
    const owner = user.email === "dg.theswingingman@gmail.com";
    const { data: isPremium } = owner ? { data: true } : await db.rpc("is_premium", { p_user: user.id });
    if (isPremium !== true) return json({ error: "Asking Claude comes with premium." }, 403);

    // Allowances: the person's daily Local Cuts limit, then the shared one.
    const { data: mine } = await db.rpc("sc_local_ai_take", { p_user: user.id, p_calls: 1 });
    if (mine !== 1) return json({ error: "You've used today's Claude allowance for Local Cuts. It resets tomorrow." }, 429);
    const { data: pause } = await db.from("sc_private_settings").select("value").eq("key", AI_PAUSE).maybeSingle();
    if (pause?.value && Date.parse(pause.value) > Date.now()) return json({ error: "Claude asked us to slow down. Try again in a few minutes." }, 429);
    const { data: ticket, error: tErr } = await db.rpc("sc_api_allow", { p_service: "claude", p_want: 1 });
    if (!tErr && ticket !== 1) return json({ error: "The site's Claude allowance is used up for now. Try again in a minute." }, 429);

    // The closest songs on the site for each file.
    const { data: cands, error: cErr } = await db.rpc("sc_local_candidates", {
      p_items: items.map((i) => ({ ref: i.ref, artist: i.artist, title: i.title || i.file_name })),
    });
    if (cErr) return json({ error: cErr.message }, 500);
    const found = new Map<string, Found>(((cands as Found[]) ?? []).map((f) => [f.ref, f]));
    const codes = new Map<string, Map<string, Cand>>();
    const prompt = buildPrompt(items, found, codes);

    // Ask Claude; a garbled answer gets one more try.
    let answer: any = null;
    for (let attempt = 0; attempt < 2 && !answer; attempt++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: AI_MODEL, max_tokens: 8000,
          messages: [{ role: "user", content: attempt === 0 ? prompt : prompt + "\n\nIMPORTANT: reply with valid JSON only (escape any quotes inside strings)." }],
        }),
      });
      if (res.status === 429 || res.status === 529) {
        const wait = Number(res.headers.get("retry-after")) || 60;
        await db.from("sc_private_settings").upsert({ key: AI_PAUSE, value: new Date(Date.now() + Math.max(wait, 120) * 1000).toISOString() }, { onConflict: "key" });
        return json({ error: "Claude is busy. Try again in a few minutes." }, 429);
      }
      const out: any = await res.json().catch(() => null);
      if (!res.ok) return json({ error: `Claude couldn't answer (${out?.error?.message ?? res.status}).` }, 502);
      const text = String((out?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text ?? "").join("")).replace(/```(?:json)?/g, "");
      try { answer = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch {
        console.error("local-ai unreadable answer", attempt, out?.stop_reason, text.length, text.slice(0, 400), "…", text.slice(-300));
      }
    }
    if (!answer) return json({ error: "Claude's answer couldn't be read.", retry: true }, 502);

    // Keep only what makes sense: picks must be one of that file's songs.
    const byFile = new Map<number, any>();
    for (const f of Array.isArray(answer?.files) ? answer.files : []) if (Number.isInteger(f?.file)) byFile.set(f.file, f);
    const results: { ref: string; track_id: string | null; title: string | null; version_of: string | null; artist_id: string | null; artist_name: string | null; confidence: string | null; why: string | null; clean: Clean }[] = [];
    const needArtist: { ref: string; artist: string }[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i], f = found.get(it.ref), a = byFile.get(i + 1) ?? {};
      const c = a.clean ?? {};
      const clean: Clean = {
        title: str(c.title, 300), artist: str(c.artist, 200),
        status: STATUSES.includes(c.status) ? c.status : null,
        version: str(c.version, 80), producers: str(c.producers, 300), featuring: str(c.featuring, 300), note: str(c.note, 200),
      };
      const pick = typeof a.pick === "string" ? codes.get(it.ref)?.get(a.pick.trim()) : undefined;
      const confidence = ["high", "medium", "low"].includes(a.confidence) ? a.confidence : "low";
      if (!f?.artist_id && clean.artist) needArtist.push({ ref: it.ref, artist: clean.artist });
      results.push({
        ref: it.ref, track_id: pick?.id ?? null, title: pick?.title ?? null, version_of: pick?.version_of ?? null,
        artist_id: f?.artist_id ?? null, artist_name: f?.artist_name ?? null,
        confidence: pick ? confidence : null, why: str(a.why, 160), clean,
      });
    }
    // Artists Claude tidied ("@playboicarti" -> "Playboi Carti"): are they here?
    if (needArtist.length) {
      const { data: again } = await db.rpc("sc_local_candidates", { p_items: needArtist.map((n) => ({ ref: n.ref, artist: n.artist, title: "" })) });
      for (const g of (again as Found[]) ?? []) {
        const r = results.find((x) => x.ref === g.ref);
        if (r && g.artist_id) { r.artist_id = g.artist_id; r.artist_name = g.artist_name ?? null; }
      }
    }
    return json({ results });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
