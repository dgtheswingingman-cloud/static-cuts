"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useIsRealAdmin } from "../../useIsAdmin";
import { useAuth } from "../../AuthProvider";

const MATCH_URL = "https://pcuyzaamcsegblrauxsa.functions.supabase.co/match-spotify";
const VERIFY_URL = "https://pcuyzaamcsegblrauxsa.functions.supabase.co/verify-spotify-links";

function useRunner(functionUrl: string, limit: number) {
  const [running, setRunning] = useState(false);
  const [totalChecked, setTotalChecked] = useState(0);
  const [totalSecondary, setTotalSecondary] = useState(0); // "matched" or "deadFound" depending on which system
  const [log, setLog] = useState<string[]>([]);
  const stopRequested = useRef(false);

  function addLog(line: string) {
    setLog((prev) => [line, ...prev].slice(0, 200));
  }

  async function run(secondaryKey: "matched" | "deadFound") {
    setRunning(true);
    stopRequested.current = false;
    setTotalChecked(0);
    setTotalSecondary(0);
    setLog([]);

    let consecutiveRateLimits = 0;

    while (!stopRequested.current) {
      let response: any;
      try {
        const res = await fetch(`${functionUrl}?limit=${limit}`);
        response = await res.json();
      } catch (e: any) {
        addLog(`Request failed: ${e?.message ?? e}. Waiting 30s and retrying...`);
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }

      addLog(JSON.stringify(response));

      setTotalChecked((prev) => prev + (response.checked ?? 0));
      setTotalSecondary((prev) => prev + (response[secondaryKey] ?? 0));

      if (response.done) {
        addLog(">>> All tracks checked. Done.");
        break;
      }

      if (response.rateLimited) {
        consecutiveRateLimits++;
        const baseWait = response.retryAfterSeconds || 30;
        if (baseWait > 600) {
          const hours = Math.round((baseWait / 3600) * 10) / 10;
          addLog(`>>> Extended rate-limit block (~${hours} hours). Stopping rather than retrying during the block window.`);
          break;
        }
        const wait = Math.min(baseWait * consecutiveRateLimits, 300);
        addLog(`>>> Rate limited (x${consecutiveRateLimits} in a row), waiting ${wait}s...`);
        await new Promise((r) => setTimeout(r, wait * 1000));
      } else {
        consecutiveRateLimits = 0;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    if (stopRequested.current) addLog(">>> Stopped by user.");
    setRunning(false);
  }

  function stop() {
    stopRequested.current = true;
  }

  return { running, totalChecked, totalSecondary, log, run, stop };
}

function RunnerPanel({
  title,
  description,
  secondaryLabel,
  functionUrl,
  limit,
  secondaryKey,
}: {
  title: string;
  description: string;
  secondaryLabel: string;
  functionUrl: string;
  limit: number;
  secondaryKey: "matched" | "deadFound";
}) {
  const { running, totalChecked, totalSecondary, log, run, stop } = useRunner(functionUrl, limit);

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="section-label">{title}</div>
      <div className="detail-meta" style={{ marginBottom: 12 }}>{description}</div>

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        {!running ? (
          <button className="comment-post-btn" onClick={() => run(secondaryKey)}>▶ run</button>
        ) : (
          <button className="comment-post-btn" onClick={stop}>■ stop</button>
        )}
      </div>

      <div className="detail-meta" style={{ marginBottom: 12 }}>
        {running ? "Running… " : "Idle. "}
        checked: <b style={{ color: "var(--bone)" }}>{totalChecked}</b> · {secondaryLabel}:{" "}
        <b style={{ color: "var(--bone)" }}>{totalSecondary}</b>
      </div>

      <div className="comments-panel" style={{ maxHeight: 260, overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: "0.7rem" }}>
        {log.length === 0 && <div className="comments-count">No activity yet.</div>}
        {log.map((line, i) => (
          <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid var(--hair)", color: "var(--smoke)" }}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SpotifyMatcherPage() {
  const { user, loading: authLoading } = useAuth();
  const isRealAdmin = useIsRealAdmin();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && (!user || !isRealAdmin)) router.push("/");
  }, [authLoading, user, isRealAdmin, router]);

  if (!isRealAdmin) return null;

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← back to archive</button>
      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>Spotify Tools</h1>
      <div className="detail-meta" style={{ marginBottom: 24 }}>
        Two separate systems. Keep this tab open while either runs — closing it stops the process,
        same as closing a terminal window would.
      </div>

      <RunnerPanel
        title="Find New Links"
        description="Searches tracks with no confirmed link yet. Each one gets marked as checked whether or not a match is found, so re-running never wastes quota re-checking the same ones."
        secondaryLabel="matched"
        functionUrl={MATCH_URL}
        limit={20}
        secondaryKey="matched"
      />

      <RunnerPanel
        title="Verify Existing Links"
        description="Re-checks tracks that already have a confirmed link, to catch ones Spotify has since removed. Dead links get cleared automatically, making that track eligible for Find New Links again."
        secondaryLabel="dead found"
        functionUrl={VERIFY_URL}
        limit={30}
        secondaryKey="deadFound"
      />
    </div>
  );
}
