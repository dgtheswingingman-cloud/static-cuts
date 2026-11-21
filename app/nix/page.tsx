"use client";
import "../styles/control.css";
import "../styles/nix.css";

// NIX, the archivist: every automatic job in one place. What NIX did today,
// what it fixed (undoable), what went wrong, what's stuck, and each job's
// pace (jobs with nothing to do slow down on their own).

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin, useIsOwner } from "../useIsAdmin";
import NoAccess from "../components/NoAccess";
import { CALENDAR, JOB_GROUPS, KNOWN_JOBS } from "./jobs";
import LocalAi from "./LocalAi";
import NixPanel from "./NixPanel";
import Learning from "./Learning";

type Task = {
  name: string; kind: "api" | "db"; every_min: number; max_every_min: number; at_time: string | null; only_if: boolean;
  enabled: boolean; running: boolean; next_at: string; last_run_at: string | null; last_ms: number | null;
  last_idle: boolean | null; idle_runs: number; last_result: string | null; runs_today: number; skipped_today: number;
  runs_24h: number; worked_24h: number; failed_24h: number; last_failed_at: string | null; behind: boolean;
};
type Nix = {
  generated_at: string;
  tasks: Task[];
  calendar: { name: string; schedule: string; active: boolean; last_run: string | null; last_status: string | null }[];
  activity: { name: string; at: string; result: string | null }[];
  failures: { name: string; at: string; error: string }[];
  fixes: { at: string; label: string; kind: string; undone: boolean; changes: number }[];
  totals: { runs: number; worked: number; failed: number };
};

function ago(iso: string | null) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
function until(iso: string) {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (mins <= 0) return "due now";
  if (mins < 60) return `in ${mins} min`;
  const h = Math.round(mins / 60);
  return `in ${h} h`;
}
const n = (x: number) => x.toLocaleString("en-GB");
const mins = (m: number) => (m >= 1440 ? `${Math.round(m / 1440)} day` : m >= 60 ? `${Math.round(m / 60)} h` : `${m} min`);

// A job's latest run failed (as opposed to failures it has since recovered from).
function failingNow(t: Task) {
  return t.failed_24h > 0 && !!t.last_failed_at && (!t.last_run_at || new Date(t.last_failed_at) >= new Date(t.last_run_at));
}

function pace(t: Task) {
  if (t.at_time) return `daily at ${t.at_time} UTC`;
  const base = `every ${mins(t.every_min)}`;
  if (t.last_idle && t.idle_runs > 0 && t.max_every_min > t.every_min) {
    const now = Math.min(t.max_every_min, t.every_min * 2 ** Math.min(t.idle_runs, 10));
    return `${base}, slowed to ${mins(now)}: nothing to do lately`;
  }
  return base + (t.only_if ? ", only when there's work" : "");
}

// The numbers from a run, in a few words: {"checked":15,"matched":15} → "checked 15, matched 15".
function summary(raw: string | null) {
  if (!raw) return "";
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (typeof j !== "object" || j === null) return raw.slice(0, 120);
    const parts: string[] = [];
    for (const [k, v] of Object.entries(j)) {
      if (typeof v === "number" && v > 0) parts.push(`${k.replace(/_/g, " ")} ${n(v)}`);
      else if (Array.isArray(v) && v.length) parts.push(`${k.replace(/_/g, " ")} ${v.length}`);
      else if (v && typeof v === "object") {
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
          if (typeof v2 === "number" && v2 > 0) parts.push(`${k2.replace(/_/g, " ")} ${n(v2)}`);
        }
      } else if (typeof v === "string" && v && k !== "ok" && v.length < 60) parts.push(v);
    }
    return parts.slice(0, 5).join(", ");
  } catch {
    return raw.slice(0, 120);
  }
}

export default function NixPage() {
  const { loading } = useAuth();
  const isAdmin = useIsAdmin();
  const isOwner = useIsOwner();
  const [d, setD] = useState<Nix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function load() {
    const { data, error: err } = await supabase.rpc("admin_nix");
    if (err) { setError(err.message); return; }
    setError(null);
    setD(data as Nix);
  }

  useEffect(() => {
    if (!isAdmin) return;
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [isAdmin]);

  async function act(name: string, action: "run" | "pause" | "resume") {
    setBusy(name);
    const { error: err } = await supabase.rpc("admin_nix_set", { p_name: name, p_action: action });
    if (err) setError(err.message);
    await load();
    setBusy(null);
  }

  if (!isAdmin) return <NoAccess loading={loading} who="admin" />;

  const tasks = d?.tasks ?? [];
  // Paused jobs were paused on purpose: listed quietly, not as problems.
  const needsLook = tasks.filter((t) => t.enabled && (failingNow(t) || t.behind));
  const paused = tasks.filter((t) => !t.enabled);
  // "Already running" / "nothing to do" replies are skipped runs, not failures.
  const SKIP = /already running|could not be found|JWT issued at future/i;
  const failures = (d?.failures ?? []).filter((f) => !SKIP.test(f.error));
  const groups = [
    ...JOB_GROUPS,
    { title: "Other", jobs: Object.fromEntries(tasks.filter((t) => !KNOWN_JOBS.has(t.name)).map((t) => [t.name, ""])) },
  ];
  const activity = d ? (showAll ? d.activity : d.activity.slice(0, 15)) : [];

  return (
    <div className="wrap cr-page nix-page">
      <h1 className="ls-title cr-title">NIX<span>//</span></h1>
      <p className="sb-lead">
        The archivist. NIX runs every automatic job on one clock, slows a job down when it has nothing to do and
        speeds it back up when there&apos;s work. Refreshes every minute.
        {d && <> Updated {ago(d.generated_at)}.</>}
      </p>
      {error && <div className="comments-panel" style={{ margin: "12px 0" }}>Couldn&apos;t load: {error}</div>}
      {!d && !error && <div className="empty-state">loading…</div>}

      {d && (
        <>
          <div className="health-tiles nix-tiles">
            <div className="health-tile"><div className="health-tile-value">{n(tasks.length)}</div><div className="health-tile-label">jobs</div></div>
            <div className="health-tile"><div className="health-tile-value">{n(d.totals.runs)}</div><div className="health-tile-label">runs in 24 h</div></div>
            <div className="health-tile"><div className="health-tile-value">{n(d.totals.worked)}</div><div className="health-tile-label">found something to do</div></div>
            <div className="health-tile" data-alert={d.totals.failed > 0 ? "true" : undefined}><div className="health-tile-value">{n(d.totals.failed)}</div><div className="health-tile-label">failed runs in 24 h</div></div>
          </div>

          <NixPanel />
          <LocalAi />
          <Learning />

          <div className="cr-grid">
            <section className="cr-box">
              <div className="section-label">Needs a look</div>
              {needsLook.length === 0 ? (
                <div className="comment-meta">Nothing. Every job is running and its latest run worked.</div>
              ) : needsLook.map((t) => (
                <div key={t.name} className="review-row nix-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="review-row-title">{t.name}</div>
                    <div className="review-row-meta">
                      {t.behind && <span className="feature-tag disputed-tag">behind: was due {ago(t.next_at)}</span>}
                      {failingNow(t) && <span className="feature-tag disputed-tag nix-wrap">failing: {t.last_result?.slice(0, 160)}</span>}
                    </div>
                  </div>
                  {isOwner && (
                    <button className="st-btn" disabled={busy === t.name} onClick={() => act(t.name, "run")}>Try now</button>
                  )}
                </div>
              ))}
              {paused.length > 0 && (
                <p className="comment-meta" style={{ marginTop: 10 }}>
                  Paused on purpose: {paused.map((t, i) => (
                    <span key={t.name}>
                      {i > 0 && ", "}{t.name}
                      {isOwner && <> (<button className="inline-link-btn" disabled={busy === t.name} onClick={() => act(t.name, "resume")}>resume</button>)</>}
                    </span>
                  ))}.
                </p>
              )}
              {failures.length > 0 && (
                <>
                  <div className="cr-sub">Failed runs (24 h)</div>
                  {failures.slice(0, 8).map((f, i) => (
                    <div key={i} className="review-row nix-row">
                      <div style={{ minWidth: 0 }}>
                        <div className="review-row-title">{f.name} <span className="comment-meta">· {ago(f.at)}</span></div>
                        <div className="review-row-meta nix-wrap"><span>{f.error.slice(0, 200)}</span></div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </section>

            <section className="cr-box">
              <div className="section-label">What NIX fixed</div>
              <div className="comment-meta" style={{ marginBottom: 6 }}>
                Automatic changes in the last 7 days. Every one can be undone on <Link href="/admin/batches" className="text-link">Undo</Link>.
              </div>
              {d.fixes.length === 0 && <div className="comment-meta">No automatic changes this week.</div>}
              {d.fixes.map((f, i) => (
                <div key={i} className="review-row nix-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="review-row-title">{f.label}</div>
                    <div className="review-row-meta">
                      <span>{ago(f.at)}</span>
                      <span>{n(f.changes)} change{f.changes === 1 ? "" : "s"}</span>
                      {f.undone && <span className="feature-tag">undone</span>}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          </div>

          <section className="cr-box">
            <div className="section-label">What NIX did</div>
            <div className="comment-meta" style={{ marginBottom: 6 }}>Latest runs that found something to do.</div>
            {activity.map((a, i) => (
              <div key={i} className="review-row nix-row">
                <div style={{ minWidth: 0 }}>
                  <div className="review-row-title">{a.name} <span className="comment-meta">· {ago(a.at)}</span></div>
                  <div className="review-row-meta nix-wrap"><span>{summary(a.result) || "done"}</span></div>
                </div>
              </div>
            ))}
            {d.activity.length > 15 && (
              <button className="inline-link-btn" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${d.activity.length}`}</button>
            )}
          </section>

          <section className="cr-box">
            <div className="section-label">Jobs</div>
            {groups.map((g) => {
              const rows = tasks.filter((t) => t.name in g.jobs);
              if (!rows.length) return null;
              return (
                <div key={g.title} className="nix-group">
                  <div className="cr-sub">{g.title}</div>
                  {rows.map((t) => (
                    <div key={t.name} className={`review-row nix-row${t.enabled ? "" : " nix-off"}`}>
                      <div style={{ minWidth: 0 }}>
                        <div className="review-row-title">
                          {t.name}
                          <span className="comment-meta">
                            {" · "}{t.running ? "running now" : t.last_run_at ? `ran ${ago(t.last_run_at)}` : "not run yet"}
                            {t.enabled && !t.running && ` · next ${until(t.next_at)}`}
                          </span>
                        </div>
                        <div className="review-row-meta">
                          <span>{g.jobs[t.name] || "No description yet."}</span>
                        </div>
                        <div className="review-row-meta">
                          <span>{pace(t)}</span>
                          <span>
                            24 h: {t.max_every_min > t.every_min || t.kind === "api"
                              ? `${n(t.worked_24h)} of ${n(t.runs_24h)} runs did something`
                              : `${n(t.runs_24h)} runs`}
                            {t.skipped_today ? `, ${n(t.skipped_today)} skipped today (no work)` : ""}
                          </span>
                          {t.last_ms != null && <span>last took {t.last_ms < 1000 ? `${t.last_ms} ms` : `${(t.last_ms / 1000).toFixed(1)} s`}</span>}
                          {!t.enabled && <span className="feature-tag">paused</span>}
                          {failingNow(t) && <span className="feature-tag disputed-tag">failing</span>}
                          {!failingNow(t) && t.failed_24h > 0 && <span className="feature-tag">{t.failed_24h} failed in 24 h, fine now</span>}
                        </div>
                      </div>
                      {isOwner && (
                        <div className="nix-actions">
                          <button className="st-btn" disabled={busy === t.name || t.running} onClick={() => act(t.name, "run")}>Run now</button>
                          <button className="st-btn" disabled={busy === t.name} onClick={() => act(t.name, t.enabled ? "pause" : "resume")}>
                            {t.enabled ? "Pause" : "Resume"}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </section>

          <section className="cr-box">
            <div className="section-label">Calendar timers</div>
            <div className="comment-meta" style={{ marginBottom: 6 }}>NIX&apos;s two clocks, and the weekly and monthly jobs that run on set days.</div>
            {d.calendar.map((c) => (
              <div key={c.name} className="review-row nix-row">
                <div style={{ minWidth: 0 }}>
                  <div className="review-row-title">
                    {c.name} <span className="comment-meta">· {c.last_run ? `ran ${ago(c.last_run)}` : "not run yet"}</span>
                  </div>
                  <div className="review-row-meta">
                    <span>{CALENDAR[c.name] ?? c.schedule}</span>
                    {!c.active && <span className="feature-tag">off</span>}
                    {c.last_status && c.last_status !== "succeeded" && c.last_status !== "running" && (
                      <span className="feature-tag disputed-tag">last run {c.last_status}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
