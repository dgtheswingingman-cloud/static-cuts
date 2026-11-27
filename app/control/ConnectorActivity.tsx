"use client";
import "../styles/connector-activity.css";

// Site health: what connected apps (ChatGPT through /api/mcp) have been doing.
// Every connector call is logged in mcp_calls (tool, who, app, ok/error, a
// trimmed copy of the arguments); admin_mcp_calls returns the last week's
// totals per tool and the latest calls.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Call = { at: string; tool: string; ok: boolean; error: string | null; args: unknown; ms: number | null; who: string; app: string | null };
type Data = { summary: { tool: string; calls: number; errors: number; last: string }[]; calls: Call[] };

const when = (s: string) => new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function ConnectorActivity() {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    supabase.rpc("admin_mcp_calls", { p_limit: 60 }).then(({ data }) => setData((data as Data | null) ?? null));
  }, []);
  if (!data) return null;
  const total = data.summary.reduce((n, s) => n + s.calls, 0);
  const errors = data.summary.reduce((n, s) => n + s.errors, 0);

  return (
    <section className="cr-box ca-box">
      <div className="section-label">Connector activity <span className="comment-meta">· ChatGPT and other connected apps, last 7 days</span></div>
      {total === 0 ? <div className="comment-meta">No calls yet.</div> : (
        <>
          <div className="ca-sum">
            <b>{total.toLocaleString("en-GB")}</b> calls{errors ? <>, <span className="ca-err">{errors} failed</span></> : null}
            <span className="ca-tools">
              {data.summary.map((s) => (
                <span key={s.tool} className="hw-chip" title={`last ${when(s.last)}`}>{s.tool} {s.calls}{s.errors ? ` (${s.errors} failed)` : ""}</span>
              ))}
            </span>
          </div>
          <ol className="ca-list">
            {data.calls.map((c, n) => (
              <li key={n} className={c.ok ? undefined : "is-err"}>
                <button className="ca-row" onClick={() => setOpen(open === n ? null : n)} aria-expanded={open === n}>
                  <span className="ca-when">{when(c.at)}</span>
                  <span className="ca-tool">{c.tool}</span>
                  <span className="ca-who">{c.who}{c.app ? "" : " (site)"}</span>
                  <span className="ca-ms">{c.ok ? (c.ms != null ? `${c.ms} ms` : "") : "failed"}</span>
                </button>
                {open === n && (
                  <div className="ca-detail">
                    {c.error && <div className="ca-err">{c.error}</div>}
                    <pre>{JSON.stringify(c.args, null, 1)}</pre>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
