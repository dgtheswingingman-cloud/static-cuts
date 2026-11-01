"use client";

// Takedown requests from /takedown. "Remove" marks the song removed and
// drops its suggested links (undoable from the undo history); "reject"
// closes the request. Reply to the sender by email either way.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";
import { ModPage, ModToolbar, ModTabs, ModRow, ModButton, ModTag, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

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
    <ModPage
      title="Takedown requests"
      intro={<>
        Requests from the <Link href="/takedown" className="text-link">takedown form</Link>. &quot;Remove song&quot; marks the
        song removed and deletes its suggested links; it can be reversed from the <UndoHistoryLink />. Reply to the sender
        by email either way.
      </>}
    >
      <ModToolbar>
        <ModTabs value={tab} onChange={setTab} tabs={(["open", "removed", "rejected"] as const).map((t) => ({ key: t, label: t }))} />
      </ModToolbar>

      {message && <ModNotice onClose={() => setMessage(null)}>{message}</ModNotice>}
      {error && <ModNotice kind="error">Couldn&apos;t load requests: {error}</ModNotice>}
      {rows === null && <ModLoading />}
      {rows && rows.length === 0 && !error && <ModEmpty>No {tab} requests.</ModEmpty>}

      {rows?.map((r) => (
        <ModRow
          key={r.id}
          title={<>
            {r.track_title ? r.track_title : r.artist_name ? `${r.artist_name} (whole page)` : "Song not identified"}
            {r.artist_name && r.track_title ? ` · ${r.artist_name}` : ""}
            {r.track_status && <ModTag>{r.track_status}</ModTag>}
          </>}
          meta={<>
            <span>{new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
            <span>{r.name} ({RELATIONSHIP[r.relationship] ?? r.relationship})</span>
            <span>{r.email}</span>
            {r.page_url && <a href={r.page_url} target="_blank" rel="noopener noreferrer">their link</a>}
            {r.artist_id && <Link href={`/artist/${r.artist_id}${r.track_id ? `?highlight=${r.track_id}` : ""}`}>open on site</Link>}
            {r.state !== "open" && (
              <span>{r.state} {r.handled_at ? new Date(r.handled_at).toLocaleDateString("en-GB") : ""}{r.handled_note ? ` · ${r.handled_note}` : ""}</span>
            )}
          </>}
          actions={r.state === "open" ? <>
            <ModButton kind="danger" busy={busy === r.id} confirm="Mark this song removed and delete its suggested links?" onClick={() => handle(r, "remove")}>remove song</ModButton>
            <ModButton kind="dismiss" busy={busy === r.id} onClick={() => handle(r, "reject")}>reject</ModButton>
          </> : undefined}
        >
          <div className="comment-body" style={{ whiteSpace: "pre-wrap", margin: "8px 0" }}>{r.reason}</div>
          {r.state === "open" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {!r.track_id && (
                <input className="search-input" placeholder="Song ID to remove (from the song's link: ?highlight=…)"
                  value={trackIds[r.id] ?? ""} onChange={(e) => setTrackIds({ ...trackIds, [r.id]: e.target.value })} />
              )}
              <input className="search-input" placeholder="Note for yourself (optional)"
                value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
            </div>
          )}
        </ModRow>
      ))}
    </ModPage>
  );
}
