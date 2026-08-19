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
  submitted_by: string;
  status: string;
  created_at: string;
};

export default function ReviewPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [artistNames, setArtistNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function load() {
    if (!user) return;
    const { data, error: err } = await supabase
      .from("submissions")
      .select("id, type, artist_id, payload, submitted_by, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (err) {
      // RLS will block non-admins entirely -- this is the expected way
      // someone finds out they're not the reviewer.
      setError("You don't have access to the review queue.");
      return;
    }
    setSubmissions(data ?? []);

    const userIds = Array.from(new Set((data ?? []).map((s) => s.submitted_by)));
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("id, display_name").in("id", userIds);
      const map: Record<string, string> = {};
      (profiles ?? []).forEach((p: any) => { map[p.id] = p.display_name || "anonymous"; });
      setNames(map);
    }

    const artistIds = Array.from(new Set((data ?? []).map((s) => s.artist_id).filter(Boolean)));
    if (artistIds.length > 0) {
      const { data: artists } = await supabase.from("artists").select("id, name").in("id", artistIds as string[]);
      const map: Record<string, string> = {};
      (artists ?? []).forEach((a: any) => { map[a.id] = a.name; });
      setArtistNames(map);
    }
  }

  async function approve(id: string) {
    setBusyId(id);
    const { error: err } = await supabase.rpc("approve_submission", { submission_id: id });
    setBusyId(null);
    if (err) { alert(err.message); return; }
    load();
  }

  async function reject(id: string) {
    const note = window.prompt("Reason for rejecting (optional):") ?? "";
    setBusyId(id);
    const { error: err } = await supabase.rpc("reject_submission", { submission_id: id, note });
    setBusyId(null);
    if (err) { alert(err.message); return; }
    load();
  }

  function describe(s: Submission) {
    if (s.type === "new_artist") return `New artist: "${s.payload.name}"`;
    if (s.type === "new_track") {
      const flags = [s.payload.is_featured && "featured", s.payload.is_official && "official"].filter(Boolean).join(", ");
      return `New track for ${artistNames[s.artist_id ?? ""] ?? s.artist_id}: "${s.payload.title}" (${s.payload.track_type}${flags ? ", " + flags : ""})`;
    }
    if (s.type === "new_version") return `New sub-entry for ${artistNames[s.artist_id ?? ""] ?? s.artist_id}: "${s.payload.title}"`;
    if (s.type === "correction") return `Correction to track ${s.payload.track_id}`;
    return s.type;
  }

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← back to archive</button>
      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>Review queue</h1>

      {error && <div className="empty-state" style={{ borderColor: "#a33", marginTop: 16 }}>{error}</div>}

      {!error && submissions === null && <div className="empty-state">loading…</div>}

      {!error && submissions && submissions.length === 0 && (
        <div className="empty-state">Nothing pending.</div>
      )}

      {!error && submissions && submissions.map((s) => (
        <div key={s.id} className="track-row" style={{ cursor: "default", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="track-title">{describe(s)}</div>
            <div className="comment-meta">
              by {names[s.submitted_by] ?? "…"} · {new Date(s.created_at).toLocaleString()}
            </div>
          </div>
          <button className="listen-link" disabled={busyId === s.id} onClick={() => approve(s.id)}>
            approve
          </button>
          <button className="listen-link" disabled={busyId === s.id} onClick={() => reject(s.id)}>
            reject
          </button>
        </div>
      ))}
    </div>
  );
}
