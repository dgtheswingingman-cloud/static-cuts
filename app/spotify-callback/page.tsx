"use client";

// Back from Spotify: finish building the playlist and link to it.

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { finishSpotifyExport } from "@/lib/spotifyExport";

function Inner() {
  const params = useSearchParams();
  const started = useRef(false);
  const [result, setResult] = useState<{ url: string; name: string; count: number; back: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = params.get("code");
    if (params.get("error") || !code) { setError("Spotify sign-in was cancelled."); return; }
    finishSpotifyExport(code, params.get("state")).then(setResult).catch((e) => setError(e.message));
  }, [params]);

  return (
    <div className="wrap" style={{ maxWidth: 560 }}>
      <h1 className="detail-name page-title">Spotify playlist</h1>
      {!result && !error && <div className="empty-state">Making your playlist…</div>}
      {error && <div className="empty-state">{error}</div>}
      {result && (
        <div className="comments-panel">
          <div className="comment-body" style={{ marginBottom: 12 }}>
            Done: <strong>{result.name}</strong> with {result.count} song{result.count === 1 ? "" : "s"} is in your Spotify (private).
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {result.url && <a className="tab active" href={result.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>open in Spotify ↗</a>}
            <Link href={result.back || "/"} className="tab">back</Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SpotifyCallback() {
  return (
    <Suspense fallback={<div className="wrap"><div className="empty-state">loading…</div></div>}>
      <Inner />
    </Suspense>
  );
}
