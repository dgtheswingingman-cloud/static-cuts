"use client";

// Takedown requests from /takedown. "Remove" marks the song removed and
// drops its suggested links (undoable from the undo history); "reject"
// closes the request. Reply to the sender by email either way.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";

type Request = {
  id: string;
  created_at: string;
  state: "open" | "removed" | "rejected";
  name: string;
  email: string;
  relationship: string;
  reason: string;
  page_url: string | null;
  track_id: string | null;
  track_title: string | null;
  track_status: string | null;
  artist_id: string | null;
  artist_name: string | null;
  handled_at: string | null;
  handled_note: string | null;
};

const RELATIONSHIP: Record<string, string> = {
  rights_holder: "rights holder",
  representative: "representative",
  artist: "the artist",
  other: "other",
};

export default function TakedownsPage() {
  const { user, loading: authLoading } = useAuth();
  const isRealAdmin = useIsAdmin();
  const router = useRouter();
  const [tab, setTab] = useState<"open" | "removed" | "rejected">("open");
  const [rows, setRows] = useState<Request[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [trackIds, setTrackIds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data, error: err } = await supabase.rpc("admin_takedown_requests", { p_state: tab });
    if (err) { setError(err.message); setRows([]); return; }
    setError(null);
    setRows((data as Request[]) ?? []);
  }

  useEffect(() => {
    if (isRealAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRealAdmin, tab]);

  async function handle(r: Request, action: "remove" | "reject") {
    setBusy(r.id);
    setMessage(null);
    const { data, error: err } = await supabase.rpc("admin_handle_takedown", {
      p_id: r.id,
      p_action: action,
      p_track_id: trackIds[r.id] || null,
      p_note: notes[r.id] || null,
    });
    setBusy(null);
    if (err) { setMessage(err.message); return; }
    const links = (data as { links_removed?: number })?.links_removed ?? 0;
    setMessage(action === "remove"
      ? `Marked removed${links ? ` and ${links} suggested link${links === 1 ? "" : "s"} deleted` : ""}. Remember to reply to ${r.email}.`
      : `Rejected. Remember to reply to ${r.email}.`);
    load();
  }

  if (!isRealAdmin) return <NoAccess loading={authLoading} who="admin" />;

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/control")}>← control room</button>
      <h1 className="detail-name page-title">Takedown Requests</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        Requests from the <Link href="/takedown" className="text-link">takedown form</Link>. &quot;Remove&quot; marks the
        song removed and deletes its suggested links; it can be reversed from the{" "}
        <UndoHistoryLink />. Reply to the sender by email either way.
      </div>

      <div className="review-toolbar"><div className="review-toolbar-row">
        {(["open", "removed", "rejected"] as const).map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div></div>

      {message && <div className="comments-panel" style={{ marginBottom: 12 }}>{message}</div>}
      {error && <div className="comment-meta">Couldn&apos;t load requests: {error}</div>}
      {rows === null && <div className="empty-state">loading…</div>}
      {rows && rows.length === 0 && !error && <div className="empty-state">No {tab} requests.</div>}

      {rows?.map((r) => (
        <div key={r.id} className="comments-panel" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span className="track-title">
              {r.track_title ? r.track_title : r.artist_name ? `${r.artist_name} (whole page)` : "Song not identified"}
              {r.artist_name && r.track_title ? ` · ${r.artist_name}` : ""}
            </span>
            <span className="comment-meta">{new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
          <div className="review-row-meta" style={{ marginBottom: 8 }}>
            <span>{r.name} ({RELATIONSHIP[r.relationship] ?? r.relationship})</span>
            <span>{r.email}</span>
            {r.track_status && <span className="feature-tag">{r.track_status}</span>}
            {r.page_url && <a href={r.page_url} target="_blank" rel="noopener noreferrer" className="text-link">their link</a>}
            {r.artist_id && (
              <Link href={`/artist/${r.artist_id}${r.track_id ? `?highlight=${r.track_id}` : ""}`} className="text-link">open on site</Link>
            )}
          </div>
          <div className="comment-body" style={{ whiteSpace: "pre-wrap", marginBottom: 10 }}>{r.reason}</div>

          {r.state === "open" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {!r.track_id && (
                <input className="search-input" placeholder="Song ID to remove (from the song's link: ?highlight=…)"
                  value={trackIds[r.id] ?? ""} onChange={(e) => setTrackIds({ ...trackIds, [r.id]: e.target.value })} />
              )}
              <input className="search-input" placeholder="Note for yourself (optional)"
                value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="tab danger-tab" disabled={busy === r.id} onClick={() => handle(r, "remove")}>remove song</button>
                <button className="tab" disabled={busy === r.id} onClick={() => handle(r, "reject")}>reject</button>
              </div>
            </div>
          ) : (
            <div className="comment-meta">
              {r.state} {r.handled_at ? new Date(r.handled_at).toLocaleDateString("en-GB") : ""}
              {r.handled_note ? ` · ${r.handled_note}` : ""}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
