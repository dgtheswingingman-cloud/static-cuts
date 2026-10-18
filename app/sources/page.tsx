"use client";

// Community spreadsheets the archive has imported, credited to their makers,
// and a form to send in another one.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";

type Source = {
  id: string; title: string; tab_name: string | null; credit: string | null; url: string; artist_id: string; artist: string;
  songs: number; created_at: string; last_synced_at: string | null; auto_sync: boolean;
};

export default function SourcesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [url, setUrl] = useState("");
  const [artistName, setArtistName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("rpc_sheet_sources").then(({ data }) => setSources((data as Source[]) ?? []));
  }, []);

  async function send() {
    if (!user) { router.push("/login"); return; }
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.rpc("rpc_request_sheet", { p_url: url.trim(), p_artist_name: artistName, p_note: note });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    const r = data as { result: string; title?: string; same_tab?: boolean };
    if (r.result === "already_imported") {
      setMessage(r.same_tab
        ? `Already imported as “${r.title}”. New songs added to it are picked up every night.`
        : `Another tab of this sheet is already imported (“${r.title}”). A moderator can add this tab too.`);
    } else if (r.result === "already_requested") {
      setMessage("Someone has already sent this sheet in. Your vote's been added, and a moderator will look at it.");
    } else {
      setMessage("Thanks! A moderator will look at it. Imported songs are credited to the sheet and its makers.");
      setUrl(""); setArtistName(""); setNote("");
    }
  }

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← home</button>
      <h1 className="detail-name">Sources</h1>
      <div className="detail-meta">
        A lot of what&apos;s here was first put together by fan communities in their own trackers. These are the sheets
        we&apos;ve imported, with thanks to the people who made them. Every song from a sheet links back to it.
      </div>

      <div className="section-label">Community sheets</div>
      {!sources && <div className="empty-state">loading…</div>}
      {sources && sources.length === 0 && <div className="comment-meta">None yet.</div>}
      {sources?.map((s) => (
        <div key={s.id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">
              <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ↗</a>
            </div>
            <div className="review-row-meta">
              <Link href={`/artist/${s.artist_id}`}>{s.artist}</Link>
              {s.credit && <span>by {s.credit}</span>}
              <span>{s.songs} song{s.songs === 1 ? "" : "s"}</span>
              {s.auto_sync && <span>kept up to date</span>}
            </div>
          </div>
        </div>
      ))}

      <div className="section-label">Send us a sheet</div>
      <div className="comment-meta" style={{ marginBottom: 10 }}>
        Know a good community tracker? Send the link (shared as &ldquo;anyone with the link can view&rdquo;). If it&apos;s
        already been imported we&apos;ll tell you.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 560 }}>
        <input className="search-input" placeholder="https://docs.google.com/spreadsheets/d/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <input className="search-input" placeholder="Which artist? (optional)" value={artistName} onChange={(e) => setArtistName(e.target.value)} />
        <input className="search-input" placeholder="Anything we should know, like who made it? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div>
          <button className="tab active" disabled={busy || !url.trim()} onClick={send}>{busy ? "sending…" : user ? "send" : "sign in to send"}</button>
        </div>
        {message && <div className="comments-panel">{message}</div>}
      </div>
    </div>
  );
}
