"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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

type CurrentTrack = {
  id: string;
  title: string;
  spotify_url: string | null;
  is_featured: boolean;
  is_official: boolean;
  parent_track_id: string | null;
  aliases: string | null;
  track_number: number | null;
  release_date: string | null;
  producers: string | null;
  featured_artists: string | null;
  genre: string | null;
  notes: string | null;
};

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  spotify_url: "Link",
  is_featured: "Featured",
  is_official: "Official",
  aliases: "Aliases",
  track_number: "Track #",
  release_date: "Release Date",
  producers: "Producers",
  featured_artists: "Featured Artists",
  genre: "Genre",
  notes: "Notes",
};

const CATEGORIES: { key: string; label: string; types: string[] }[] = [
  { key: "corrections", label: "Edits & Corrections", types: ["correction"] },
  { key: "new_tracks", label: "New Tracks", types: ["new_track"] },
  { key: "new_versions", label: "New Versions (Alt Takes)", types: ["new_version"] },
  { key: "new_artists", label: "New Artists", types: ["new_artist"] },
  { key: "flags", label: "Flagged Links", types: ["flag_link"] },
];

export default function ReviewPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [artistNames, setArtistNames] = useState<Record<string, string>>({});
  const [currentTracks, setCurrentTracks] = useState<Record<string, CurrentTrack>>({});
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

    // Fetch "before" state for every correction, so we can show a real diff.
    const correctionTrackIds = Array.from(
      new Set((data ?? []).filter((s) => s.type === "correction" && s.payload.track_id).map((s) => s.payload.track_id))
    );
    if (correctionTrackIds.length > 0) {
      const { data: tracks } = await supabase
        .from("tracks")
        .select("id, title, spotify_url, is_featured, is_official, parent_track_id, aliases, track_number, release_date, producers, featured_artists, genre, notes")
        .in("id", correctionTrackIds);
      const map: Record<string, CurrentTrack> = {};
      (tracks ?? []).forEach((t: any) => { map[t.id] = t; });
      setCurrentTracks(map);
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

  function describeSimple(s: Submission) {
    if (s.type === "new_artist") return `New artist: "${s.payload.name}"`;
    if (s.type === "new_track") {
      const flags = [s.payload.is_featured && "featured", s.payload.is_official && "official"].filter(Boolean).join(", ");
      const linkPart = s.payload.spotify_url ? ` — link: ${s.payload.spotify_url}` : "";
      return `New track for ${artistNames[s.artist_id ?? ""] ?? s.artist_id}: "${s.payload.title}"${flags ? " (" + flags + ")" : ""}${linkPart}`;
    }
    if (s.type === "new_version") {
      const linkPart = s.payload.spotify_url ? ` — link: ${s.payload.spotify_url}` : "";
      return `New sub-entry for ${artistNames[s.artist_id ?? ""] ?? s.artist_id}: "${s.payload.title}"${linkPart}`;
    }
    if (s.type === "flag_link") {
      return `Link flagged as broken/wrong${s.payload.reason ? `: "${s.payload.reason}"` : ""}`;
    }
    return s.type;
  }

  // Real before/after diff for corrections -- only shows fields that
  // actually changed, so a small tweak doesn't drown in unchanged fields.
  function diffLines(s: Submission): [string, string, string][] {
    const current = s.payload.track_id ? currentTracks[s.payload.track_id] : undefined;
    if (!current) return [];
    const lines: [string, string, string][] = [];
    Object.keys(FIELD_LABELS).forEach((key) => {
      if (!(key in s.payload)) return;
      const oldRaw = (current as any)[key];
      const newRaw = s.payload[key];
      const oldVal = oldRaw === null || oldRaw === undefined || oldRaw === "" ? "(none)" : String(oldRaw);
      const newVal = newRaw === null || newRaw === undefined || newRaw === "" ? "(none)" : String(newRaw);
      if (oldVal !== newVal) lines.push([FIELD_LABELS[key], oldVal, newVal]);
    });
    if ("parent_track_id" in s.payload) {
      const wasSubVersion = !!current.parent_track_id;
      const willBeSubVersion = !!s.payload.parent_track_id;
      if (wasSubVersion !== willBeSubVersion) {
        lines.push(["Sub-version status", wasSubVersion ? "was a sub-version" : "was a main track", willBeSubVersion ? "becomes a sub-version" : "becomes a main track"]);
      }
    }
    return lines;
  }

  function trackLink(s: Submission): string | null {
    if (!s.artist_id) return null;
    if ((s.type === "correction" || s.type === "flag_link") && s.payload.track_id) {
      return `/artist/${s.artist_id}?highlight=${s.payload.track_id}`;
    }
    if (s.type === "new_version" && s.payload.parent_track_id) {
      return `/artist/${s.artist_id}?highlight=${s.payload.parent_track_id}`;
    }
    return null;
  }

  function renderEntry(s: Submission) {
    const link = trackLink(s);
    const isFlag = s.type === "flag_link";
    const isCorrection = s.type === "correction";
    const diffs = isCorrection ? diffLines(s) : [];

    return (
      <div key={s.id} className="track-row" style={{ cursor: "default", flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          {isCorrection ? (
            <>
              <div className="track-title">Edit for &quot;{s.payload.title}&quot;</div>
              {diffs.length === 0 && <div className="comment-meta">No field changes detected.</div>}
              {diffs.map(([label, oldVal, newVal]) => (
                <div key={label} className="comment-meta" style={{ marginTop: 2 }}>
                  <b style={{ color: "var(--bone)" }}>{label}:</b> {oldVal} → <b style={{ color: "var(--bone)" }}>{newVal}</b>
                </div>
              ))}
            </>
          ) : (
            <div className="track-title">{describeSimple(s)}</div>
          )}
          <div className="comment-meta" style={{ marginTop: 4 }}>
            by {names[s.submitted_by] ?? "…"} · {new Date(s.created_at).toLocaleString()}
          </div>
        </div>
        {link && (
          <Link href={link} className="listen-link" style={{ textDecoration: "none" }}>
            view track
          </Link>
        )}
        <button className="listen-link" disabled={busyId === s.id} onClick={() => approve(s.id)}>
          {isFlag ? "remove link" : "approve"}
        </button>
        <button className="listen-link" disabled={busyId === s.id} onClick={() => reject(s.id)}>
          {isFlag ? "keep link" : "reject"}
        </button>
      </div>
    );
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

      {!error && submissions && submissions.length > 0 && CATEGORIES.map((cat) => {
        const entries = submissions.filter((s) => cat.types.includes(s.type));
        if (entries.length === 0) return null;
        return (
          <div key={cat.key} style={{ marginBottom: 10 }}>
            <div className="section-label">{cat.label} ({entries.length})</div>
            {entries.map((s) => renderEntry(s))}
          </div>
        );
      })}
    </div>
  );
}
