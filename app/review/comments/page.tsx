"use client";

// Reported comments (moderators). Hidden ones (3+ reports) come first.
// Keep clears the reports and shows it again; delete removes it (and can be
// undone from the undo history).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";

type Reported = {
  comment_id: string; body: string; author_id: string; author: string; created_at: string; hidden_at: string | null;
  track_id: string; track_title: string | null; artist_id: string | null; reports: number; reasons: string[];
  notes: string[]; author_comments: number;
};
const REASON: Record<string, string> = {
  spam: "spam", abuse: "abusive", personal_info: "personal info", off_topic: "off topic", other: "other",
};

export default function ReportedCommentsPage() {
  const { user, loading: authLoading } = useAuth();
  const canModerate = useIsModerator();
  const router = useRouter();
  const [items, setItems] = useState<Reported[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data, error: err } = await supabase.rpc("admin_reported_comments");
    if (err) setError(err.message);
    setItems((data as Reported[]) ?? []);
  }
  useEffect(() => {
    if (canModerate) load();
  }, [canModerate]);

  async function handle(c: Reported, action: "keep" | "delete") {
    if (action === "delete" && !confirm("Delete this comment (and any replies)?")) return;
    setBusy(c.comment_id);
    const { error: err } = await supabase.rpc("admin_handle_comment", { p_comment: c.comment_id, p_action: action });
    setBusy(null);
    if (err) { setError(err.message); return; }
    setItems((prev) => (prev ?? []).filter((x) => x.comment_id !== c.comment_id));
  }

  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;
  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/control")}>← control room</button>
      <h1 className="detail-name page-title">Reported comments</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        Three reports hide a comment until someone here decides. Keep clears the reports; delete removes it (undo from the
        undo history).
      </div>
      {error && <div className="comments-panel" style={{ marginBottom: 12 }}>{error}</div>}
      {!items && <div className="empty-state">loading…</div>}
      {items && items.length === 0 && <div className="empty-state">Nothing reported. Nice.</div>}
      {items?.map((c) => (
        <div key={c.comment_id} className="comments-panel" style={{ marginBottom: 12 }}>
          <div className="comment-meta" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {c.hidden_at && <span className="feature-tag disputed-tag">hidden</span>}
            <span>{c.reports} report{c.reports === 1 ? "" : "s"}: {c.reasons.map((r) => REASON[r] ?? r).join(", ")}</span>
            <span>
              by <Link href={`/profile/${c.author_id}`} className="text-link">{c.author}</Link> ({c.author_comments} comment{c.author_comments === 1 ? "" : "s"})
            </span>
            {c.track_title && <span>on <Link href={`/song/${c.track_id}`} className="text-link">{c.track_title}</Link></span>}
          </div>
          <div className="comment-body" style={{ margin: "10px 0", whiteSpace: "pre-wrap" }}>{c.body}</div>
          {c.notes.length > 0 && <div className="comment-meta" style={{ marginBottom: 8 }}>Notes: {c.notes.join(" · ")}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="tab" disabled={busy === c.comment_id} onClick={() => handle(c, "keep")}>keep</button>
            <button className="tab danger-tab" disabled={busy === c.comment_id} onClick={() => handle(c, "delete")}>delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}
