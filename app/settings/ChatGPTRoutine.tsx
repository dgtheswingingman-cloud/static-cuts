"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ROUTINE_PROMPT } from "@/lib/mcp/routinePrompt";

type Run = { started_at: string; artists_checked: number | null; submitted: number | null; summary: string | null };

export default function ChatGPTRoutine({ userId }: { userId: string }) {
  const [origin, setOrigin] = useState("");
  const [lastRun, setLastRun] = useState<Run | null | undefined>(undefined);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    supabase
      .from("routine_runs")
      .select("started_at, artists_checked, submitted, summary")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(1)
      .then(({ data, error }) => setLastRun(error ? null : (data?.[0] as Run) ?? null));
  }, [userId]);

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy this:", text);
    }
  }

  const connectorUrl = `${origin}/api/mcp`;

  return (
    <>
      <div className="section-label">Help keep my artists updated with ChatGPT</div>
      <div className="detail-meta" style={{ marginBottom: 12, maxWidth: 520 }}>
        Connect ChatGPT and schedule a task that checks the artists you follow for new songs, leaks,
        snippets and status changes. What it finds goes to the review queue, and nothing goes live
        until it&apos;s approved. Needs a paid ChatGPT plan.
      </div>
      <ol className="detail-meta" style={{ maxWidth: 520, paddingLeft: 18, lineHeight: 1.7, marginBottom: 12 }}>
        <li>
          In ChatGPT, add a custom connector with this address, then sign in with your Static Cuts account:
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
            <code style={{ wordBreak: "break-all" }}>{connectorUrl}</code>
            <button className="tab" onClick={() => copy("url", connectorUrl)}>{copied === "url" ? "copied" : "copy"}</button>
          </div>
        </li>
        <li>
          Ask ChatGPT to run <code>test_connection</code> once to check it works.
        </li>
        <li>
          Create a scheduled task (daily is plenty) with these instructions:
          <div style={{ marginTop: 4 }}>
            <button className="tab" onClick={() => copy("prompt", ROUTINE_PROMPT)}>
              {copied === "prompt" ? "copied" : "copy instructions"}
            </button>
          </div>
        </li>
      </ol>
      <div className="detail-meta" style={{ marginBottom: 20, maxWidth: 520 }}>
        {lastRun === undefined
          ? ""
          : lastRun
          ? `Last run: ${new Date(lastRun.started_at).toLocaleString()} · checked ${lastRun.artists_checked ?? 0} artist(s), reported ${lastRun.submitted ?? 0}.`
          : "Not connected yet: no runs recorded."}
      </div>
    </>
  );
}
