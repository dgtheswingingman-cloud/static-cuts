"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ROUTINE_PROMPT } from "@/lib/mcp/routinePrompt";

type Run = { started_at: string; artists_checked: number | null; submitted: number | null; summary: string | null };

export default function ChatGPTRoutine({ userId }: { userId: string }) {
  const [origin, setOrigin] = useState("");
  const [lastRun, setLastRun] = useState<Run | null | undefined>(undefined);
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Whether ChatGPT is still signed in (an OAuth session exists).
  const [linked, setLinked] = useState<boolean | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    supabase
      .from("routine_runs")
      .select("started_at, artists_checked, submitted, summary")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(1)
      .then(({ data, error }) => setLastRun(error ? null : (data?.[0] as Run) ?? null));
    supabase.rpc("rpc_my_connector_status").then(({ data }) => setLinked((data as { connected?: boolean } | null)?.connected ?? null));
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
    <div className="st-conn st-gpt">
      <button className="st-gpt-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="st-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18" /></svg>
        </span>
        <span className="st-conn-text">
          <strong>ChatGPT</strong>
          <span>
            {linked === false && lastRun
              ? "ChatGPT has been signed out. Open the steps to reconnect."
              : "Connect ChatGPT to help keep your followed artists up to date."}
            {linked === false && lastRun ? "" : lastRun ? ` Last run ${new Date(lastRun.started_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}: checked ${lastRun.artists_checked ?? 0}, reported ${lastRun.submitted ?? 0}.` : lastRun === null ? " Not connected yet." : ""}
          </span>
        </span>
        <span className="hf-chev" aria-hidden="true">{open ? "⌄" : "›"}</span>
      </button>
      {open && (
        <div className="st-steps">
          <strong className="st-steps-h">Connect ChatGPT//</strong>
          <ol>
            <li>
              <span>In ChatGPT, add a custom connector with: <code>{connectorUrl}</code></span>
              <button className="st-btn" onClick={() => copy("url", connectorUrl)}>{copied === "url" ? "Copied" : "Copy"}</button>
            </li>
            <li><span>Sign in with your Static-Cuts account and ask it to run <code>test_connection</code>.</span></li>
            <li><span>Already connected before? In ChatGPT open the connector and press <strong>Refresh</strong> so it picks up all 12 tools (finding links, marking songs checked, duplicates).</span></li>
            <li>
              <span>Create a scheduled task (daily is plenty) with these instructions to check your followed artists for new songs, leaks and status changes.</span>
              <button className="st-btn" onClick={() => copy("prompt", ROUTINE_PROMPT)}>{copied === "prompt" ? "Copied" : "Copy"}</button>
            </li>
          </ol>
          <small>
            What it finds goes to the moderators; nothing goes live until it&apos;s approved. Needs a paid ChatGPT plan. How often it
            runs is set in ChatGPT. Logging out of Static-Cuts no longer signs ChatGPT out. Other assistants that support custom connectors (MCP) and scheduled tasks should work too.
          </small>
        </div>
      )}
    </div>
  );
}
