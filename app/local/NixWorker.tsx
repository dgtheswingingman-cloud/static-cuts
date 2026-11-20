"use client";

// "Run NIX on this PC" (owner only, in the desktop app). While it's on, this
// PC answers NIX's AI jobs with its own model through Ollama, for free:
//   every 30 s  tell the site this PC is online and which model it uses
//   in between  take the next queued job, answer it, hand the answer back
// The site only sends AI work here while the PC checks in; otherwise Claude
// does it as before. Turning it off (or closing the app) stops it; a job left
// half-done goes back in the queue after 15 minutes.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { desktop, type AiStatus } from "./desktop";

const ON_KEY = "nix_worker_on";
const MODEL_KEY = "nix_worker_model";
// A good default for a laptop: ~5 GB, fine on a 6–8 GB graphics card, slower on CPU only.
const SUGGESTED = "qwen2.5:7b";

function read(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key: string, v: string | null) { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch { /* fine */ } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function NixWorker() {
  const [on, setOn] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [doing, setDoing] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const live = useRef({ on: false, model: null as string | null, pc: "this PC" });

  useEffect(() => {
    setOn(read(ON_KEY) === "1");
    setModel(read(MODEL_KEY));
    desktop.aiStatus().then(setStatus);
  }, []);

  // The model to use: the chosen one if installed, else the suggested one, else the first.
  const models = status?.models ?? [];
  const use = model && models.includes(model) ? model
    : models.find((m) => m === SUGGESTED || m.startsWith(SUGGESTED + "-")) ?? models[0] ?? null;
  live.current = { on, model: use, pc: status?.pc ?? "this PC" };

  // Check in every 30 s while on.
  useEffect(() => {
    if (!on) return;
    let stop = false;
    (async () => {
      while (!stop) {
        const s = await desktop.aiStatus();
        setStatus(s);
        const m = live.current.model;
        const { error } = await supabase.rpc("nix_ai_heartbeat", {
          p_worker: s.pc, p_ollama: s.ollama, p_model: s.ollama ? m : null, p_models: s.models,
          p_error: s.ollama ? null : "Ollama isn't running",
        });
        if (error) setErr(error.message);
        await sleep(30000);
      }
    })();
    return () => { stop = true; };
  }, [on]);

  // Work: one job at a time.
  useEffect(() => {
    if (!on) return;
    let stop = false;
    (async () => {
      await sleep(2000);
      while (!stop) {
        const m = live.current.model;
        if (!m) { await sleep(20000); continue; }
        const pc = live.current.pc;
        const { data: job, error } = await supabase.rpc("nix_ai_claim", { p_worker: pc, p_model: m });
        if (error) { setErr(error.message); await sleep(30000); continue; }
        if (!job) { setDoing(null); await sleep(20000); continue; }
        const j = job as { id: number; kind: string; prompt: string; json: boolean };
        setDoing(j.kind);
        const t0 = Date.now();
        let output: string | null = null;
        let failed: string | null = null;
        try { output = await desktop.aiGenerate(m, j.prompt, j.json); } catch (e) { failed = String(e).slice(0, 400); }
        await supabase.rpc("nix_ai_finish", { p_id: j.id, p_output: output, p_error: failed, p_ms: Date.now() - t0 });
        if (failed) setErr(failed); else { setErr(null); setDone((n) => n + 1); }
        setDoing(null);
      }
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  function toggle(v: boolean) {
    setOn(v);
    write(ON_KEY, v ? "1" : null);
  }

  return (
    <div className="lc-nix">
      <div className="lc-desk-title">NIX on this PC</div>
      <label className="lc-share">
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} disabled={status?.appTooOld} />
        <span><b>Run NIX on this PC</b>: NIX&apos;s AI work (checking sub-versions, album of the week blurbs) runs here on your own model, for free, instead of Claude. Only you see this.</span>
      </label>
      <p className="lc-desk-status">
        {!status ? "Looking for Ollama…"
          : status.appTooOld ? "This needs the newest version of the app. It updates itself; restart it from the tray icon when it offers."
          : !status.ollama ? <>Ollama isn&apos;t running. Install it from <a className="text-link" href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">ollama.com</a>, then in a terminal run <code>ollama pull {SUGGESTED}</code> (about 5 GB). Ollama starts with Windows after that.</>
          : models.length === 0 ? <>Ollama is running but has no models yet. In a terminal run <code>ollama pull {SUGGESTED}</code> (about 5 GB).</>
          : !on ? <>Ready: Ollama is running with {models.length} model{models.length === 1 ? "" : "s"}.</>
          : doing ? <>Working on a {doing} job with {use}…</>
          : <>On, using {use}. Waiting for work{done ? ` (${done} job${done === 1 ? "" : "s"} done since the app opened)` : ""}.</>}
      </p>
      {status?.ollama && models.length > 1 && (
        <label className="lc-nix-model">
          <span>Model</span>
          <select value={use ?? ""} onChange={(e) => { setModel(e.target.value); write(MODEL_KEY, e.target.value); }}>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      )}
      {err && <p className="lc-desk-err">{err}</p>}
    </div>
  );
}
