"use client";

// "Fill this page": import songs from Spotify (added straight away), Genius
// and Last.fm (sent to the import review list), or have ChatGPT look for
// unreleased songs (sent to the review queue). Shown open on empty or thin
// pages, behind an "import songs" button otherwise.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const IMPORT_URL = "https://pcuyzaamcsegblrauxsa.functions.supabase.co/import-artist";

type Source = "spotify" | "genius" | "lastfm";
type LastRun = {
  source: Source;
  started_at: string;
  finished_at: string | null;
  added: number;
  updated: number;
  suggested: number;
  skipped: number;
  error: string | null;
};

const SOURCES: { key: Source; label: string; what: string }[] = [
  { key: "spotify", label: "Spotify", what: "official songs, added straight away" },
  { key: "genius", label: "Genius", what: "every song on their Genius page, sent for review" },
  { key: "lastfm", label: "Last.fm", what: "their most-played tracks, leaks included, sent for review" },
];

function chatGptBuildUrl(artistId: string, artistName: string) {
  const prompt =
    `Use the Static Cuts connector to help fill in ${artistName}'s page on Static Cuts (artist_id "${artistId}"). ` +
    `Look for their unreleased songs, leaks, snippets, demos and alternate versions using leak and unreleased trackers, ` +
    `fan wikis and artist subreddits. Check what you find with check_candidates (artist_id "${artistId}", up to 50 ` +
    `titles per call) and call submit_discovery for each one marked new, with the best source URL. Put version info ` +
    `(Demo, V2, Snippet...) in version_hint. Submit at most 50, then summarise what you sent.`;
  return `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
}

function summary(source: Source, r: any) {
  const parts: string[] = [];
  if (source === "spotify") {
    parts.push(`${r.added} song${r.added === 1 ? "" : "s"} added`);
    if (r.updated) parts.push(`${r.updated} already here, links or albums filled in`);
  } else {
    parts.push(`${r.suggested} song${r.suggested === 1 ? "" : "s"} sent for review`);
  }
  if (r.skipped) parts.push(`${r.skipped} already on the page`);
  return parts.join(", ") + ".";
}

export default function ImportPanel({
  artistId,
  artistName,
  trackCount,
  signedIn,
  onImported,
  open,
  onClose,
}: {
  artistId: string;
  artistName: string;
  trackCount: number;
  signedIn: boolean;
  onImported: () => void;
  // Controlled by the artist page's "import songs" button (open by default
  // on empty or thin pages).
  open: boolean;
  onClose: () => void;
}) {
  const thin = trackCount <= 10;
  const [busy, setBusy] = useState<Source | null>(null);
  const [messages, setMessages] = useState<Partial<Record<Source, string>>>({});
  const [lastRuns, setLastRuns] = useState<Partial<Record<Source, LastRun>>>({});


  async function loadRuns() {
    const { data } = await supabase.rpc("rpc_artist_imports", { p_artist_id: artistId });
    const map: Partial<Record<Source, LastRun>> = {};
    ((data as LastRun[]) ?? []).forEach((r) => { map[r.source] = r; });
    setLastRuns(map);
  }

  useEffect(() => {
    if (open) loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, artistId]);

  async function run(source: Source) {
    setBusy(source);
    setMessages((m) => ({ ...m, [source]: "Importing… this can take up to a minute." }));
    try {
      const { data: s } = await supabase.auth.getSession();
      const res = await fetch(IMPORT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` },
        body: JSON.stringify({ artist_id: artistId, source }),
      });
      const r = await res.json();
      if (!res.ok || r.error) {
        setMessages((m) => ({ ...m, [source]: r.error || `Import failed (${res.status}).` }));
      } else {
        setMessages((m) => ({ ...m, [source]: summary(source, r) + (r.profileNote ? ` ${r.profileNote}` : "") }));
        if (source === "spotify" && (r.added || r.updated)) onImported();
      }
    } catch (e: any) {
      setMessages((m) => ({ ...m, [source]: `Import failed: ${e?.message ?? e}` }));
    }
    setBusy(null);
    loadRuns();
  }

  if (!signedIn) return null;

  if (!open) return null;

  return (
    <div className="comments-panel" style={{ maxWidth: 560, marginBottom: 20 }}>
      <div className="section-label" style={{ marginBottom: 4 }}>
        {trackCount === 0 ? "This page is empty. Fill it from:" : thin ? "This page is nearly empty. Fill it from:" : "Import songs from:"}
      </div>
      <div className="comment-meta" style={{ marginBottom: 10 }}>
        Songs already on the page are skipped. Each source can be imported once a day per artist.
      </div>
      {SOURCES.map((s) => {
        const last = lastRuns[s.key];
        return (
          <div key={s.key} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginBottom: 8 }}>
            <button className="tab" disabled={busy !== null} onClick={() => run(s.key)} style={{ minWidth: 92 }}>
              {busy === s.key ? "importing…" : s.label}
            </button>
            <span className="comment-meta" style={{ flex: "1 1 240px", minWidth: 0 }}>
              {messages[s.key] ?? (
                <>
                  {s.what}
                  {last && last.finished_at && !last.error && (
                    <> · last imported {new Date(last.started_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</>
                  )}
                </>
              )}
            </span>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <a
          href={chatGptBuildUrl(artistId, artistName)}
          target="_blank"
          rel="noopener noreferrer"
          className="tab"
          style={{ textDecoration: "none", minWidth: 92, textAlign: "center" }}
        >
          ChatGPT ↗
        </a>
        <span className="comment-meta" style={{ flex: "1 1 240px", minWidth: 0 }}>
          looks for leaks, snippets and unreleased songs, sent for review. Needs the Static Cuts connector (see settings).
        </span>
      </div>
      <button className="rating-chip" style={{ marginTop: 10 }} onClick={onClose}>close</button>
    </div>
  );
}
