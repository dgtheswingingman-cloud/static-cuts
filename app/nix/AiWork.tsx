"use client";

// NIX's AI work, for the control room (/nix):
//   useAiData   the laptop, the job scoreboard and Claude's budget (every minute)
//   Scoreboard  each AI job: how far it's got, how often Claude agrees, the
//               final say on disagreements, and what's waiting for you
//   PcStatus    which PC is answering, the queue, how fast
//   Spend       Claude this month
//   Switches    which suggestion jobs NIX makes (owner)
//   Teaching    the worked examples NIX's next prompt for a job carries

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useIsOwner } from "../useIsAdmin";

export type Job = {
  kind: string; label: string; done: number; done_24h: number; done_1h: number; left: number; suggested: number;
  agreed: number; decided: number; checked?: number; claude_agreed?: number; claude_disagreed?: number; to_check?: number;
  judged?: number; nix_right?: number; nix_wrong?: number; to_judge?: number; making?: boolean; right?: number; wrong?: number;
};
export type Spend = { cap_usd: number; month_usd: number; today_usd: number; calls_month: number; by_job: { job: string; calls: number; usd: number }[] };
export type Ai = {
  online: boolean; auto_apply: boolean; queued: number; running: number; done_24h: number; failed_24h: number; avg_s: number | null;
  workers: { worker: string; model: string | null; ollama: boolean; last_seen: string; jobs_done: number; last_error: string | null }[];
};

const JOB_LINK: Record<string, string> = {
  links: "/review/links", duplicates: "/review/duplicates", cleanup: "/review/cleanup", mixups: "/review/cleanup", deezer: "/review/deezer",
  titles: "/review/nix", audit: "/review/nix", notes: "/review/nix", eras: "/review/nix",
};
const SUGGEST_KINDS = ["titles", "audit", "notes", "eras"];
const n = (x: number | undefined) => (x ?? 0).toLocaleString("en-GB");
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export function useAiData() {
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
  return { ai, spend, jobs, reloadJobs: () => supabase.rpc("admin_nix_jobs_progress").then(({ data }) => setJobs((data as Job[]) ?? [])) };
}

// How often NIX is right on a job: Claude's agreements out of everything it
// could call either way, with the final say counted in.
export function trust(j: Job) {
  const agree = j.right ?? 0;
  const wrong = j.wrong ?? 0;
  return { agree, wrong, total: agree + wrong };
}

export function verdict(j: Job): { label: string; tone: "good" | "warn" | "bad" | "plain" } {
  const t = trust(j);
  if (t.total < 30) return { label: "too early to say", tone: "plain" };
  const r = t.agree / t.total;
  if (r >= 0.85) return { label: "trustworthy", tone: "good" };
  if (r >= 0.6) return { label: "mostly right", tone: "warn" };
  return { label: "often wrong", tone: "bad" };
}

type Week = { week_start: string; lines: string[] };

// The weekly summary (sc_nix_weekly_build, Mondays): the latest one, with
// the previous weeks a click away. The owner also gets it as a notification.
export function ThisWeek() {
  const [weeks, setWeeks] = useState<Week[] | null>(null);
  const [i, setI] = useState(0);
  useEffect(() => { supabase.rpc("admin_nix_weekly").then(({ data }) => setWeeks((data as Week[]) ?? [])); }, []);
  if (!weeks || weeks.length === 0) return null;
  const w = weeks[Math.min(i, weeks.length - 1)];
  const label = new Date(w.week_start + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <section className="cr-box nix-week">
      <div className="nix-week-head">
        <div className="section-label">NIX&apos;s week · from {label}</div>
        {weeks.length > 1 && (
          <div className="nix-actions">
            <button className="st-btn" disabled={i >= weeks.length - 1} onClick={() => setI(i + 1)}>Earlier</button>
            <button className="st-btn" disabled={i === 0} onClick={() => setI(i - 1)}>Later</button>
          </div>
        )}
      </div>
      <ul className="nix-week-lines">{w.lines.map((l, k) => <li key={k}>{l}</li>)}</ul>
    </section>
  );
}

export function Scoreboard({ jobs }: { jobs: Job[] }) {
  if (!jobs.length) return null;
  return (
    <section className="cr-box">
      <div className="section-label">How NIX is doing</div>
      <div className="comment-meta" style={{ marginBottom: 8 }}>
        Claude checks everything NIX does. When they disagree, a more careful second pass has the final say, and
        NIX learns from it. Nothing changes on the site until someone accepts it.
      </div>
      <div className="nix-score">
        {jobs.map((j) => {
          const v = verdict(j);
          const t = trust(j);
          const waiting = j.suggested || 0;
          return (
            <div key={j.kind} className={`nix-score-card nix-tone-${v.tone}${j.making === false ? " nix-off" : ""}`}>
              <div className="nix-score-head">
                <Link href={JOB_LINK[j.kind] ?? "/nix"} className="text-link">{j.label}</Link>
                <span className={`nix-pill nix-pill-${v.tone}`}>{j.making === false ? "stopped" : v.label}</span>
              </div>
              <div className="nix-score-big">{pct(t.agree, t.total)}<span> right, by Claude</span></div>
              <div className="nix-score-bar" aria-hidden><i style={{ width: t.total ? `${(t.agree / t.total) * 100}%` : 0 }} /></div>
              <div className="nix-score-meta">
                <span>{n(j.done)} done</span>
                {j.left > 0 && j.making !== false && <span>{n(j.left)} left</span>}
                {(j.judged ?? 0) > 0 && <span>final say: {n(j.nix_right)} NIX right, {n(j.nix_wrong)} wrong</span>}
                {((j.to_check ?? 0) + (j.to_judge ?? 0)) > 0 && <span>{n((j.to_check ?? 0) + (j.to_judge ?? 0))} being checked</span>}
                {waiting > 0 && <span><Link href={JOB_LINK[j.kind] ?? "/nix"} className="text-link">{n(waiting)} waiting for you</Link></span>}
                {j.decided > 0 && <span>you agreed {pct(j.agreed, j.decided)} of {n(j.decided)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function PcStatus({ ai, jobs }: { ai: Ai | null; jobs: Job[] }) {
  if (!ai) return null;
  const left = jobs.filter((j) => j.making !== false);
  return (
    <section className="cr-box">
      <div className="section-label">The PC running NIX</div>
      <div className="comment-meta" style={{ marginBottom: 8 }}>
        {ai.online
          ? "A PC is online, so NIX's AI work runs there for free."
          : <>No PC online, so NIX&apos;s AI work waits (sub-version checks and album of the week blurbs fall back to Claude). Switch on &ldquo;Run NIX on this PC&rdquo; in the <Link href="/desktop" className="text-link">desktop app</Link>.</>}
        {" "}Last 24 h: {n(ai.done_24h)} job{ai.done_24h === 1 ? "" : "s"} answered{ai.failed_24h ? `, ${ai.failed_24h} failed` : ""}
        {ai.queued || ai.running ? `; ${ai.queued} waiting, ${ai.running} in progress` : ""}
        {ai.avg_s != null ? `; about ${ai.avg_s} s a job` : ""}.
      </div>
      {ai.workers.map((w) => (
        <div key={w.worker} className="review-row nix-row">
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">{w.worker} <span className="comment-meta">· checked in {ago(w.last_seen)}</span></div>
            <div className="review-row-meta">
              <span>{w.ollama ? (w.model ?? "no model chosen") : "Ollama not running"}</span>
              <span>{n(w.jobs_done)} jobs done</span>
              {w.last_error && <span className="feature-tag">{w.last_error}</span>}
            </div>
          </div>
        </div>
      ))}
      {left.length > 0 && (
        <div className="nix-jobs">
          <div className="nix-jobs-row nix-jobs-head"><span>Job</span><span>Done</span><span>Left</span><span>Last hour</span><span>Finish</span></div>
          {left.map((j) => {
            const rate = j.done_1h || Math.round(j.done_24h / 24);
            const hours = rate > 0 ? j.left / rate : null;
            return (
              <div key={j.kind} className="nix-jobs-row">
                <span>{j.label}</span>
                <span>{n(j.done)}</span>
                <span>{n(j.left)}</span>
                <span>{n(j.done_1h)}</span>
                <span>{j.left === 0 ? "nothing new" : hours == null ? "—" : hours < 1 ? "within the hour" : hours < 48 ? `~${Math.round(hours)} h` : `~${Math.round(hours / 24)} days`}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function Spend({ spend }: { spend: Spend | null }) {
  if (!spend) return null;
  const used = Number(spend.month_usd), cap = Number(spend.cap_usd);
  return (
    <section className="cr-box">
      <div className="section-label">Claude this month</div>
      <div className="nix-score-big">${used.toFixed(2)}<span> of ${cap.toFixed(2)} (about £10 with VAT)</span></div>
      <div className="nix-score-bar" aria-hidden><i style={{ width: `${Math.min(100, (used / Math.max(cap, 0.01)) * 100)}%` }} /></div>
      <div className="comment-meta" style={{ marginTop: 6 }}>
        {n(spend.calls_month)} calls; today ${Number(spend.today_usd).toFixed(2)}.
        {spend.by_job.length > 0 && <> {spend.by_job.map((j) => `${j.job} $${Number(j.usd).toFixed(2)}`).join(", ")}.</>}
        {" "}NIX&apos;s checking stops at 60% so Local Cuts always has room; everything stops at the cap until the 1st.
      </div>
    </section>
  );
}

const ABOUT: Record<string, string> = {
  titles: "Tidies titles and pulls producers and features out of them.",
  audit: "Looks for songs filed as versions of the wrong song.",
  notes: "Reads song notes for leak dates, producers, features and other names.",
  eras: "Guesses the era of unreleased songs from their dates and notes.",
};

export function Switches({ jobs }: { jobs: Job[] }) {
  const isOwner = useIsOwner();
  const [on, setOn] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { supabase.rpc("admin_nix_kinds").then(({ data }) => setOn((data as string[]) ?? [])); }, []);
  async function flip(kind: string, v: boolean) {
    setBusy(kind);
    const { data, error } = await supabase.rpc("admin_nix_kinds", { p_kind: kind, p_on: v });
    if (error) setErr(error.message); else setOn((data as string[]) ?? []);
    setBusy(null);
  }
  if (!on) return null;
  return (
    <section className="cr-box">
      <div className="section-label">What NIX works on</div>
      <div className="comment-meta" style={{ marginBottom: 8 }}>
        Review notes (duplicates, clean-up, bios, Deezer) always run. These suggestion jobs can be switched off when
        they aren&apos;t worth the laptop&apos;s time; what&apos;s already waiting stays on the review page.
      </div>
      {SUGGEST_KINDS.map((k) => {
        const j = jobs.find((x) => x.kind === k);
        const v = j ? verdict(j) : null;
        return (
          <label key={k} className="nix-switch nix-switch-row">
            <input type="checkbox" checked={on.includes(k)} disabled={!isOwner || busy === k} onChange={(e) => flip(k, e.target.checked)} />
            <span>
              <b>{j?.label ?? k}</b>: {ABOUT[k]}
              {v && <span className={`nix-pill nix-pill-${v.tone}`}>{v.label}</span>}
            </span>
          </label>
        );
      })}
      {!isOwner && <p className="comment-meta">Only the owner can switch these.</p>}
      {err && <p className="comment-meta nix-err">{err}</p>}
    </section>
  );
}

export function Teaching({ jobs }: { jobs: Job[] }) {
  const [kind, setKind] = useState("duplicates");
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    supabase.rpc("admin_nix_lessons", { p_kind: kind }).then(({ data }) => setText((data as string) ?? ""));
  }, [kind]);
  return (
    <section className="cr-box">
      <div className="section-label">What NIX is being taught</div>
      <div className="comment-meta" style={{ marginBottom: 8 }}>
        Every prompt NIX gets carries worked examples: your own decisions first, then the final say on its recent
        mistakes (with the right answer), then a couple it got right so it doesn&apos;t overcorrect. This is exactly
        what its next prompt for that job will include.
      </div>
      <label className="nix-model">
        <span>Job</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {jobs.map((j) => <option key={j.kind} value={j.kind}>{j.label}</option>)}
        </select>
      </label>
      <pre className="nix-lessons">{text === null ? "loading…" : text || "Nothing yet: examples appear as Claude checks its answers and you review them."}</pre>
    </section>
  );
}
