"use client";

// Reported comments (moderators). Hidden ones (3+ reports) come first.
// Keep clears the reports and shows it again; delete removes it (and can be
// undone from the undo history).

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";
import { ModPage, ModRow, ModButton, ModTag, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

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
    setBusy(c.comment_id);
    const { error: err } = await supabase.rpc("admin_handle_comment", { p_comment: c.comment_id, p_action: action });
    setBusy(null);
    if (err) { setError(err.message); return; }
    setItems((prev) => (prev ?? []).filter((x) => x.comment_id !== c.comment_id));
  }

  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;
  return (
    <ModPage
      title="Reported comments"
      intro="Three reports hide a comment until someone here decides. Keep clears the reports; delete removes it (undo from the undo history)."
    >
      {error && <ModNotice kind="error" onClose={() => setError(null)}>{error}</ModNotice>}
      {!items && <ModLoading />}
      {items && items.length === 0 && <ModEmpty>Nothing reported. Nice.</ModEmpty>}
      {items?.map((c) => (
        <ModRow
          key={c.comment_id}
          title={<>
            {c.track_title ? <Link href={`/song/${c.track_id}`}>{c.track_title}</Link> : "Comment"}
            {c.hidden_at && <ModTag kind="warn">hidden</ModTag>}
          </>}
          meta={<>
            <span>{c.reports} report{c.reports === 1 ? "" : "s"}: {c.reasons.map((r) => REASON[r] ?? r).join(", ")}</span>
            <span>by <Link href={`/profile/${c.author_id}`}>{c.author}</Link> ({c.author_comments} comment{c.author_comments === 1 ? "" : "s"})</span>
            {c.notes.length > 0 && <span>Notes: {c.notes.join(" · ")}</span>}
          </>}
          actions={<>
            <ModButton kind="approve" busy={busy === c.comment_id} onClick={() => handle(c, "keep")}>keep</ModButton>
            <ModButton kind="danger" busy={busy === c.comment_id} confirm="Delete this comment (and any replies)?" onClick={() => handle(c, "delete")}>delete</ModButton>
          </>}
        >
          <div className="comment-body" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{c.body}</div>
        </ModRow>
      ))}
    </ModPage>
  );
}
