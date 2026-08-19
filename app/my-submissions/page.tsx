"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";

type Submission = {
  id: string;
  type: string;
  artist_id: string | null;
  payload: any;
  status: string;
  created_at: string;
  reviewer_note: string | null;
};

export default function MySubmissionsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [artistNames, setArtistNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const { data } = await supabase
        .from("submissions")
        .select("id, type, artist_id, payload, status, created_at, reviewer_note")
        .eq("submitted_by", user.id)
        .order("created_at", { ascending: false });
      setSubmissions(data ?? []);

      const artistIds = Array.from(new Set((data ?? []).map((s) => s.artist_id).filter(Boolean)));
      if (artistIds.length > 0) {
        const { data: artists } = await supabase.from("artists").select("id, name").in("id", artistIds as string[]);
        const map: Record<string, string> = {};
        (artists ?? []).forEach((a: any) => { map[a.id] = a.name; });
        setArtistNames(map);
      }
    }
    load();
  }, [user]);

  function describe(s: Submission) {
    if (s.type === "new_artist") return `New artist: "${s.payload.name}"`;
    if (s.type === "new_track") return `New track for ${artistNames[s.artist_id ?? ""] ?? "…"}: "${s.payload.title}"`;
    if (s.type === "new_version") return `New version for ${artistNames[s.artist_id ?? ""] ?? "…"}: "${s.payload.title}"`;
    if (s.type === "correction") return `Correction to a track`;
    return s.type;
  }

  const statusColor = (status: string) =>
    status === "approved" ? "var(--bone)" : status === "rejected" ? "var(--smoke)" : "var(--smoke)";

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← back to archive</button>
      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>My submissions</h1>

      {submissions === null && <div className="empty-state">loading…</div>}
      {submissions && submissions.length === 0 && (
        <div className="empty-state">
          You haven&apos;t submitted anything yet. Find an artist and hit &quot;suggest a track,&quot;
          or suggest a whole new artist from the search bar.
        </div>
      )}

      {submissions && submissions.map((s) => (
        <div key={s.id} className="track-row" style={{ cursor: "default", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="track-title">{describe(s)}</div>
            <div className="comment-meta">{new Date(s.created_at).toLocaleDateString()}</div>
            {s.reviewer_note && (
              <div className="comment-meta" style={{ marginTop: 2 }}>note: {s.reviewer_note}</div>
            )}
          </div>
          <span className="feature-tag" style={{ color: statusColor(s.status) }}>{s.status}</span>
        </div>
      ))}
    </div>
  );
}
