// Supabase Edge Function: run-job
//
// The timers' doorway to the background jobs. The database sends its timer
// calls in batches and waits for the slowest call in a batch before sending
// the next, so one long job (a 5-minute sheet sync) held up every other
// timer. Now each timer calls this instead: it answers straight away and
// runs the real job in the background (EdgeRuntime.waitUntil), then writes
// what the job said to job_runs (what the Control room and the hourly
// background check read).
//
// Body: { fn: "deezer-sync", body: {...} }. The timer's x-cron-secret is
// passed on; the job itself checks it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// The jobs timers may start, and how long each may take.
const JOBS: Record<string, number> = {
  "apple-music": 90_000, "artist-info": 150_000, "deezer-sync": 90_000, "fetch-covers": 150_000,
  "genius-credits": 90_000, "import-artist": 150_000, "guest-artists": 170_000, "check-links": 170_000,
  "musicbrainz-sync": 90_000, "send-push": 60_000, "sheet-import": 320_000, "match-spotify": 90_000,
  "verify-spotify-links": 90_000, "youtube-search": 90_000, "version-ai": 90_000,
};

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "not authorized" }, 403);
  const body = await req.json().catch(() => null) as { fn?: string; body?: unknown } | null;
  const fn = body?.fn ?? "";
  const limit = JOBS[fn];
  if (!limit) return json({ error: "unknown job" }, 400);

  const started = new Date();
  const work = (async () => {
    let status: number | null = null;
    let result: string | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": secret },
        body: JSON.stringify(body?.body ?? {}),
        signal: AbortSignal.timeout(limit),
      });
      status = res.status;
      result = (await res.text()).slice(0, 2000);
    } catch (e) {
      error = String((e as Error)?.message ?? e).slice(0, 500);
    }
    await db.from("job_runs").insert({
      job: fn, label: typeof (body?.body as any)?.source === "string" ? `${fn}:${(body?.body as any).source}` : fn,
      started_at: started.toISOString(), finished_at: new Date().toISOString(), status, result, error,
    });
  })();
  EdgeRuntime.waitUntil(work);
  return json({ ok: true, started: fn }, 202);
});
