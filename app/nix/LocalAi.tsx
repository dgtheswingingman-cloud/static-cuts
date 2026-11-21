"use client";

// NIX on your PC: whether a PC is answering NIX's AI jobs (free, through
// Ollama in the desktop app), and how the queue is doing. While no PC is
// online, those jobs use Claude as before.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Job = { kind: string; label: string; done: number; done_24h: number; done_1h: number; left: number; suggested: number; agreed: number; decided: number;
  checked?: number; claude_agreed?: number; claude_disagreed?: number; to_check?: number };
const JOB_LINK: Record<string, string> = {
  duplicates: "/review/duplicates", cleanup: "/review/cleanup", mixups: "/review/cleanup", deezer: "/review/deezer",
  titles: "/review/nix", audit: "/review/nix", notes: "/review/nix", eras: "/review/nix",
};
type Spend = { cap_usd: number; month_usd: number; today_usd: number; calls_month: number; by_job: { job: string; calls: number; usd: number }[] };
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
  const [spend, setSpend] = useState<Spend | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    const load = () => {
      supabase.rpc("admin_nix_ai").then(({ data }) => setAi((data as Ai) ?? null));
      supabase.rpc("admin_ai_spend").then(({ data }) => setSpend((data as Spend) ?? null));
      supabase.rpc("admin_nix_jobs_progress").then(({ data }) => setJobs((data as Job[]) ?? []));
    };
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
      {jobs.length > 0 && (
        <div className="nix-jobs">
          <div className="nix-jobs-row nix-jobs-head">
            <span>Job</span><span>Done</span><span>Left</span><span>Last hour</span><span>Finish</span><span>Claude agrees</span><span>You agree</span>
          </div>
          {jobs.map((j) => {
            const rate = j.done_1h || Math.round(j.done_24h / 24);
            const hours = rate > 0 ? j.left / rate : null;
            return (
              <div key={j.kind} className="nix-jobs-row">
                <Link href={JOB_LINK[j.kind] ?? "/nix"} className="text-link">{j.label}</Link>
                <span>{j.done.toLocaleString("en-GB")}{j.suggested ? ` (${j.suggested.toLocaleString("en-GB")} to review)` : ""}</span>
                <span>{j.left.toLocaleString("en-GB")}</span>
                <span>{j.done_1h.toLocaleString("en-GB")}</span>
                <span>{j.left === 0 ? "done" : hours == null ? "—" : hours < 1 ? "within the hour" : hours < 48 ? `~${Math.round(hours)} h` : `~${Math.round(hours / 24)} days`}</span>
                <span title={j.to_check ? `${j.to_check.toLocaleString("en-GB")} still to check` : undefined}>
                  {(j.claude_agreed ?? 0) + (j.claude_disagreed ?? 0) > 0
                    ? `${Math.round(((j.claude_agreed ?? 0) / ((j.claude_agreed ?? 0) + (j.claude_disagreed ?? 0))) * 100)}% of ${((j.claude_agreed ?? 0) + (j.claude_disagreed ?? 0)).toLocaleString("en-GB")}`
                    : j.to_check ? "checking…" : "—"}
                </span>
                <span>{j.decided ? `${Math.round((j.agreed / j.decided) * 100)}% of ${j.decided}` : "—"}</span>
              </div>
            );
          })}
          <p className="comment-meta" style={{ marginTop: 6 }}>
            Notes show on each review page as &ldquo;NIX: …&rdquo;; suggestions wait on <Link href="/review/nix" className="text-link">NIX suggestions</Link>.
            Speeds and finish times are rough, from the last hour. Artists people follow go first.
            Claude checks everything NIX does; &ldquo;Claude agrees&rdquo; leaves out the ones it wasn&apos;t sure about.
          </p>
        </div>
      )}
      {spend && (
        <div className="comment-meta" style={{ marginBottom: 8 }}>
          <b>Claude this month:</b> ${Number(spend.month_usd).toFixed(2)} of ${Number(spend.cap_usd).toFixed(2)} (about £10 with VAT),
          {" "}{Number(spend.calls_month).toLocaleString("en-GB")} calls; today ${Number(spend.today_usd).toFixed(2)}.
          {spend.by_job.length > 0 && <> {spend.by_job.map((j) => `${j.job} $${Number(j.usd).toFixed(2)}`).join(", ")}.</>}
          {" "}NIX&apos;s own jobs stop at 60% so Local Cuts always has room; everything stops at the cap until the 1st.
        </div>
      )}
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
