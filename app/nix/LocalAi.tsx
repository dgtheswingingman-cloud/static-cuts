"use client";

// NIX on your PC: whether a PC is answering NIX's AI jobs (free, through
// Ollama in the desktop app), and how the queue is doing. While no PC is
// online, those jobs use Claude as before.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Ai = {
  online: boolean; auto_apply: boolean; queued: number; running: number; done_24h: number; failed_24h: number; avg_s: number | null;
  workers: { worker: string; model: string | null; ollama: boolean; last_seen: string; jobs_done: number; last_error: string | null }[];
};

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export default function LocalAi() {
  const [ai, setAi] = useState<Ai | null>(null);

  useEffect(() => {
    const load = () => supabase.rpc("admin_nix_ai").then(({ data }) => setAi((data as Ai) ?? null));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  if (!ai) return null;
  return (
    <section className="cr-box">
      <div className="section-label">NIX on your PC</div>
      <div className="comment-meta" style={{ marginBottom: 8 }}>
        {ai.online
          ? "A PC is online: NIX's AI jobs (sub-version checks, album of the week blurbs) run there for free."
          : <>No PC online, so NIX&apos;s AI jobs use Claude. Switch on &ldquo;Run NIX on this PC&rdquo; in the <Link href="/desktop" className="text-link">desktop app</Link> (Local Cuts page) to run them free on your own model.</>}
        {" "}Last 24 h: {ai.done_24h} job{ai.done_24h === 1 ? "" : "s"} answered{ai.failed_24h ? `, ${ai.failed_24h} failed` : ""}
        {ai.queued || ai.running ? `; ${ai.queued} waiting, ${ai.running} in progress` : ""}
        {ai.avg_s != null ? `; about ${ai.avg_s} s a job` : ""}.
        {" "}{ai.auto_apply ? "Its sub-version answers are applied straight away (undoable)." : "Its sub-version answers wait on the review page with its note, so you can see how good it is first."}
      </div>
      {ai.workers.map((w) => (
        <div key={w.worker} className="review-row nix-row">
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">{w.worker} <span className="comment-meta">· checked in {ago(w.last_seen)}</span></div>
            <div className="review-row-meta">
              <span>{w.ollama ? (w.model ?? "no model chosen") : "Ollama not running"}</span>
              <span>{w.jobs_done} job{w.jobs_done === 1 ? "" : "s"} done</span>
              {w.last_error && <span className="feature-tag">{w.last_error}</span>}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
