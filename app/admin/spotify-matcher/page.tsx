"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useIsRealAdmin } from "../../useIsAdmin";
import { useAuth } from "../../AuthProvider";

const FUNCTION_URL = "https://pcuyzaamcsegblrauxsa.functions.supabase.co/match-spotify";

export default function SpotifyMatcherPage() {
  const { user, loading: authLoading } = useAuth();
  const isRealAdmin = useIsRealAdmin();
  const router = useRouter();

  const [running, setRunning] = useState(false);
  const [totalChecked, setTotalChecked] = useState(0);
  const [totalMatched, setTotalMatched] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const stopRequested = useRef(false);

  useEffect(() => {
    if (!authLoading && (!user || !isRealAdmin)) router.push("/");
  }, [authLoading, user, isRealAdmin, router]);

  function addLog(line: string) {
    setLog((prev) => [line, ...prev].slice(0, 200));
  }

  async function runMatcher() {
    setRunning(true);
    stopRequested.current = false;
    setTotalChecked(0);
    setTotalMatched(0);
    setLog([]);

    let consecutiveRateLimits = 0;

    while (!stopRequested.current) {
      let response: any;
      try {
        const res = await fetch(`${FUNCTION_URL}?limit=20`);
        response = await res.json();
      } catch (e: any) {
        addLog(`Request failed: ${e?.message ?? e}. Waiting 30s and retrying...`);
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }

      addLog(JSON.stringify(response));

      const checked = response.checked ?? 0;
      const matched = response.matched ?? 0;
      setTotalChecked((prev) => prev + checked);
      setTotalMatched((prev) => prev + matched);

      if (response.done) {
        addLog(">>> All tracks checked. Done.");
        break;
      }

      if (response.rateLimited) {
        consecutiveRateLimits++;
        const baseWait = response.retryAfterSeconds || 30;

        if (baseWait > 600) {
          const hours = Math.round((baseWait / 3600) * 10) / 10;
          addLog(`>>> Spotify has issued an extended rate-limit block (~${hours} hours). Stopping rather than retrying during the block window.`);
          break;
        }

        const wait = Math.min(baseWait * consecutiveRateLimits, 300);
        addLog(`>>> Rate limited (x${consecutiveRateLimits} in a row), waiting ${wait}s...`);
        await new Promise((r) => setTimeout(r, wait * 1000));
      } else {
        consecutiveRateLimits = 0;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    if (stopRequested.current) addLog(">>> Stopped by user.");
    setRunning(false);
  }

  function stopMatcher() {
    stopRequested.current = true;
  }

  if (!isRealAdmin) return null;

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← back to archive</button>
      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>Spotify Matcher</h1>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        Searches Spotify for tracks with no confirmed link. Keep this tab open while it runs —
        closing it stops the process, same as closing a terminal window would.
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {!running ? (
          <button className="comment-post-btn" onClick={runMatcher}>▶ run matcher</button>
        ) : (
          <button className="comment-post-btn" onClick={stopMatcher}>■ stop</button>
        )}
      </div>

      <div className="detail-meta" style={{ marginBottom: 16 }}>
        {running ? "Running… " : "Idle. "}
        checked: <b style={{ color: "var(--bone)" }}>{totalChecked}</b> · matched:{" "}
        <b style={{ color: "var(--bone)" }}>{totalMatched}</b>
      </div>

      <div className="comments-panel" style={{ maxHeight: 400, overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>
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
