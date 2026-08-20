"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Submission = {
  id: string;
  type: string;
  payload: any;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  submitted_by: string;
};

export default function ArtistChangelog({ artistId, limit }: { artistId: string; limit: number }) {
  const [entries, setEntries] = useState<Submission[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from("submissions")
        .select("id, type, payload, status, created_at, reviewed_at, submitted_by")
        .eq("artist_id", artistId)
        .neq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) { console.error(error); return; }
      setEntries(data ?? []);

      const userIds = Array.from(new Set((data ?? []).map((s) => s.submitted_by)));
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("id, display_name").in("id", userIds);
        const map: Record<string, string> = {};
        (profiles ?? []).forEach((p: any) => { map[p.id] = p.display_name || "anonymous"; });
        setNames(map);
      }
    }
    load();
  }, [artistId, limit]);

  function describe(s: Submission) {
    if (s.type === "new_track") return `New track suggested: "${s.payload.title}"`;
    if (s.type === "new_version") return `Alt version suggested: "${s.payload.title}"`;
    if (s.type === "correction") return `Edit suggested for "${s.payload.title}"`;
    if (s.type === "flag_link") return `Link flagged as broken/wrong`;
    return s.type;
  }

  if (entries === null) return <div className="empty-state">loading changelog…</div>;
  if (entries.length === 0) return <div className="empty-state">No activity yet.</div>;

  return (
    <div>
      {entries.map((e) => (
        <div key={e.id} className="track-row" style={{ cursor: "default", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="track-title" style={{ fontSize: "0.86rem" }}>{describe(e)}</div>
            <div className="comment-meta">
              {names[e.submitted_by] ?? "…"} · {new Date(e.created_at).toLocaleDateString()}
            </div>
          </div>
          <span className="feature-tag">{e.status}</span>
        </div>
      ))}
    </div>
  );
}
