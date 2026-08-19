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
  resulting_id: string | null;
};

export default function MySubmissionsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [artistNames, setArtistNames] = useState<Record<string, string>>({});
  const [trackTitles, setTrackTitles] = useState<Record<string, string>>({});
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
    const { data } = await supabase
      .from("submissions")
      .select("id, type, artist_id, payload, status, created_at, reviewer_note, resulting_id")
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

    // Referenced track ids -- for corrections/flags/new_versions, so we can
    // show which track it's actually about instead of a bare id.
    const trackIds = Array.from(
      new Set(
        (data ?? [])
          .map((s) => referencedTrackId(s))
          .filter((x): x is string => !!x)
      )
    );
    if (trackIds.length > 0) {
      const { data: tracks } = await supabase.from("tracks").select("id, title").in("id", trackIds);
      const map: Record<string, string> = {};
      (tracks ?? []).forEach((t: any) => { map[t.id] = t.title; });
      setTrackTitles(map);
    }
  }

  function referencedTrackId(s: Submission): string | null {
    if (s.type === "correction" || s.type === "flag_link") return s.payload.track_id ?? null;
    if (s.type === "new_version") return s.payload.parent_track_id ?? null;
    if (s.type === "new_track" && s.resulting_id) return s.resulting_id;
    return null;
  }

  function describe(s: Submission) {
    if (s.type === "new_artist") return `New artist: "${s.payload.name}"`;
    if (s.type === "new_track") return `New track for ${artistNames[s.artist_id ?? ""] ?? "…"}: "${s.payload.title}"`;
    if (s.type === "new_version") {
      const parentTitle = s.payload.parent_track_id ? trackTitles[s.payload.parent_track_id] : null;
      return `Alt version of "${parentTitle ?? "an existing track"}": "${s.payload.title}"`;
    }
    if (s.type === "correction") {
      const title = s.payload.track_id ? trackTitles[s.payload.track_id] : null;
      return `Edit to "${title ?? "an existing track"}"`;
    }
    if (s.type === "flag_link") {
      const title = s.payload.track_id ? trackTitles[s.payload.track_id] : null;
      return `Flagged link on "${title ?? "an existing track"}"`;
    }
    return s.type;
  }

  async function viewEntry(s: Submission) {
    if (s.type === "new_artist") {
      if (s.status !== "approved" || !s.resulting_id) return;
      const { data } = await supabase.from("artists").select("id").eq("id", s.resulting_id).maybeSingle();
      if (data) {
        router.push(`/artist/${s.resulting_id}`);
      } else {
        if (window.confirm("This artist has since been removed. Remove this entry from your history?")) {
          await removeEntry(s.id, false);
        }
      }
      return;
    }

    const trackId = referencedTrackId(s);
    if (!trackId || !s.artist_id) return;
    const { data } = await supabase.from("tracks").select("id").eq("id", trackId).maybeSingle();
    if (data) {
      router.push(`/artist/${s.artist_id}?highlight=${trackId}`);
    } else {
      if (window.confirm("This track has since been removed. Remove this entry from your history?")) {
        await removeEntry(s.id, false);
      }
    }
  }

  async function removeEntry(id: string, confirmFirst = true) {
    if (confirmFirst && !window.confirm("Remove this entry from your submission history?")) return;
    setBusyId(id);
    await supabase.from("submissions").delete().eq("id", id);
    setBusyId(null);
    setSubmissions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
  }

  async function clearAll() {
    if (!user) return;
    if (!window.confirm("Remove ALL entries from your submission history? This can't be undone.")) return;
    await supabase.from("submissions").delete().eq("submitted_by", user.id);
    setSubmissions([]);
  }

  const canView = (s: Submission) => {
    if (s.type === "new_artist" || s.type === "new_track" || s.type === "new_version") {
      return s.status === "approved";
    }
    return true; // correction/flag_link point at a track that already exists regardless of status
  };

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← back to archive</button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>My submissions</h1>
        {submissions && submissions.length > 0 && (
          <button className="tab" onClick={clearAll}>clear all</button>
        )}
      </div>

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
          <span className="feature-tag">{s.status}</span>
          {canView(s) && (
            <button className="listen-link" onClick={() => viewEntry(s)}>view</button>
          )}
          <button className="listen-link" disabled={busyId === s.id} onClick={() => removeEntry(s.id)}>
            remove
          </button>
        </div>
      ))}
    </div>
  );
}
