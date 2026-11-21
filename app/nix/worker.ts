// "Run NIX on this PC" (owner and admins who opt in, in the desktop app).
//
// One worker for the whole app window, started by NixHost (in the layout) so
// it keeps going whichever page is open. While it's on, this PC answers NIX's
// AI jobs with its own model through Ollama, for free:
//   every 30 s  tell the site this PC is online and which model it uses
//   in between  take the next queued job, answer it, hand the answer back
// The site only sends AI work here while the PC checks in; otherwise Claude
// does it. Turning it off (or closing the app) stops it; a job left half-done
// goes back in the queue after 15 minutes. The panel on /nix shows and
// changes it.

import { supabase } from "@/lib/supabase";
import { desktop, inDesktopApp, type AiStatus } from "../local/desktop";

const ON_KEY = "nix_worker_on";
const MODEL_KEY = "nix_worker_model";
// A good default for a laptop: ~5 GB, fine on a 6–8 GB graphics card, slower on CPU only.
export const SUGGESTED_MODEL = "qwen2.5:7b";

export type NixState = {
  allowed: boolean;
  on: boolean;
  status: AiStatus | null;
  model: string | null;    // the one in use
  chosen: string | null;   // the one picked in the menu (may not be installed)
  doing: string | null;
  done: number;
  err: string | null;
};

function read(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key: string, v: string | null) { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch { /* fine */ } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let state: NixState = { allowed: false, on: false, status: null, model: null, chosen: null, doing: null, done: 0, err: null };
const listeners = new Set<(s: NixState) => void>();
let generation = 0;

function set(p: Partial<NixState>) {
  state = { ...state, ...p };
  const models = state.status?.models ?? [];
  const m = state.chosen && models.includes(state.chosen) ? state.chosen
    : models.find((x) => x === SUGGESTED_MODEL || x.startsWith(SUGGESTED_MODEL + "-")) ?? models[0] ?? null;
  if (m !== state.model) state = { ...state, model: m };
  listeners.forEach((l) => l(state));
}

export const nixState = () => state;
export function subscribe(cb: (s: NixState) => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

// Called by NixHost: is this person allowed to run NIX here (owner or admin, in the desktop app)?
export function nixAllow(allowed: boolean) {
  if (!inDesktopApp()) allowed = false;
  if (allowed === state.allowed) return;
  set({ allowed, on: allowed && read(ON_KEY) === "1", chosen: read(MODEL_KEY) });
  if (allowed) desktop.aiStatus().then((s) => set({ status: s }));
  restart();
}

export function nixTurnOn(on: boolean) {
  write(ON_KEY, on ? "1" : null);
  set({ on });
  restart();
}

export function nixChoose(model: string) {
  write(MODEL_KEY, model);
  set({ chosen: model });
}

export async function nixRefresh() {
  if (state.allowed) set({ status: await desktop.aiStatus() });
}

function restart() {
  const g = ++generation;
  if (!state.allowed || !state.on) { set({ doing: null }); return; }
  checkIn(g);
  work(g);
}

async function checkIn(g: number) {
  while (g === generation) {
    const s = await desktop.aiStatus();
    set({ status: s });
    const { error } = await supabase.rpc("nix_ai_heartbeat", {
      p_worker: s.pc, p_ollama: s.ollama, p_model: s.ollama ? state.model : null, p_models: s.models,
      p_error: s.ollama ? null : "Ollama isn't running",
    });
    if (error) set({ err: error.message });
    await sleep(30000);
  }
}

async function work(g: number) {
  await sleep(2000);
  while (g === generation) {
    const m = state.model;
    if (!m) { await sleep(20000); continue; }
    const { data: job, error } = await supabase.rpc("nix_ai_claim", { p_worker: state.status?.pc ?? "this PC", p_model: m });
    if (g !== generation) break;
    if (error) { set({ err: error.message }); await sleep(30000); continue; }
    if (!job) { set({ doing: null }); await sleep(20000); continue; }
    const j = job as { id: number; kind: string; prompt: string; json: boolean };
    set({ doing: j.kind });
    const t0 = Date.now();
    let output: string | null = null;
    let failed: string | null = null;
    try { output = await desktop.aiGenerate(m, j.prompt, j.json); } catch (e) { failed = String(e).slice(0, 400); }
    // Hand it back even if it was switched off meanwhile, so the job isn't stuck.
    await supabase.rpc("nix_ai_finish", { p_id: j.id, p_output: output, p_error: failed, p_ms: Date.now() - t0 });
    set(failed ? { err: failed, doing: null } : { err: null, done: state.done + 1, doing: null });
  }
}
