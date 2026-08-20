"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Submission = {
  id: string;
  type: string;
  payload: any;
  status: string;
  created_at: string;
  submitted_by: string;
};
type AdminAction = {
  id: string;
  track_id: string | null;
  action_type: string;
  details: any;
  performed_at: string;
};
type Entry =
  | { kind: "submission"; date: string; data: Submission }
  | { kind: "admin"; date: string; data: AdminAction };

export default function ArtistChangelog({ artistId, limit }: { artistId: string; limit: number }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    async function load() {
      const [subsRes, actionsRes] = await Promise.all([
        supabase
          .from("submissions")
          .select("id, type, payload, status, created_at, submitted_by")
          .eq("artist_id", artistId)
          .neq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(limit),
        supabase
          .from("admin_actions")
          .select("id, track_id, action_type, details, performed_at")
          .eq("artist_id", artistId)
          .order("performed_at", { ascending: false })
          .limit(limit),
      ]);

      const subs = subsRes.data ?? [];
      const actions = actionsRes.data ?? [];

      const merged: Entry[] = [
        ...subs.map((s): Entry => ({ kind: "submission", date: s.created_at, data: s })),
        ...actions.map((a): Entry => ({ kind: "admin", date: a.performed_at, data: a })),
      ]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit);

      setEntries(merged);

      const userIds = Array.from(new Set(subs.map((s) => s.submitted_by)));
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("id, display_name").in("id", userIds);
        const map: Record<string, string> = {};
        (profiles ?? []).forEach((p: any) => { map[p.id] = p.display_name || "anonymous"; });
        setNames(map);
      }
    }
    load();
  }, [artistId, limit]);

  function describeSubmission(s: Submission) {
    if (s.type === "new_track") return `New track suggested: "${s.payload.title}"`;
    if (s.type === "new_version") return `Alt version suggested: "${s.payload.title}"`;
    if (s.type === "correction") return `Edit suggested for "${s.payload.title}"`;
    if (s.type === "flag_link") return `Link flagged as broken/wrong`;
    return s.type;
  }

  function describeAdmin(a: AdminAction) {
    const title = a.details?.title ?? "a track";
    if (a.action_type === "add") return `Track added: "${title}"`;
    if (a.action_type === "edit") return `Track edited: "${title}"`;
    if (a.action_type === "delete") return `Track removed: "${title}"`;
    return a.action_type;
  }

  if (entries === null) return <div className="empty-state">loading changelog…</div>;
  if (entries.length === 0) return <div className="empty-state">No activity yet.</div>;

  return (
    <div>
      {entries.map((e) => (
        <div key={`${e.kind}-${e.data.id}`} className="track-row" style={{ cursor: "default", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="track-title" style={{ fontSize: "0.86rem" }}>
              {e.kind === "submission" ? describeSubmission(e.data as Submission) : describeAdmin(e.data as AdminAction)}
            </div>
            <div className="comment-meta">
              {e.kind === "submission" ? (names[(e.data as Submission).submitted_by] ?? "…") : "admin"} ·{" "}
              {new Date(e.date).toLocaleDateString()}
            </div>
          </div>
          {e.kind === "submission" ? (
            <span className="feature-tag">{(e.data as Submission).status}</span>
          ) : (
            <span
              className="feature-tag"
              style={{ borderColor: "var(--hair-strong)", color: "var(--bone)", background: "var(--surface2)" }}
            >
              ⚡ direct admin {(e.data as AdminAction).action_type}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
