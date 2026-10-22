"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsModerator, useIsAdmin } from "../useIsAdmin";
import NoAccess from "../components/NoAccess";
import Discoveries from "../review/Discoveries";

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
  album?: string | null;
  release_status?: string | null;
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
  album: "Album",
  release_status: "Status",
};

const CATEGORIES: { key: string; label: string; types: string[] }[] = [
  { key: "status_changes", label: "Status Changes", types: ["status_change"] },
  { key: "corrections", label: "Edits & Corrections", types: ["correction"] },
  { key: "new_tracks", label: "New Tracks", types: ["new_track"] },
  { key: "new_versions", label: "New Versions (Alt Takes)", types: ["new_version"] },
  { key: "new_artists", label: "New Artists", types: ["new_artist"] },
  { key: "same_artist", label: "Same Artist Reports", types: ["artist_merge"] },
  { key: "flags", label: "Flagged Links", types: ["flag_link"] },
  { key: "deletions", label: "Flagged for Deletion", types: ["flag_deletion"] },
];

type Counts = {
  suggestions: number; finds: number; sub_versions: number; imported_songs: number; guest_artists: number;
  reported_comments: number; sheet_requests: number; tracker_disagreements?: number; takedowns: number | null;
};

const rank = (n: number | null | undefined) => (typeof n === "number" ? (n > 0 ? 0 : 2) : 1);

// One moderation job as a card: what it is, and how many are waiting.
function JobCard({ href, title, blurb, n }: { href: string; title: string; blurb: string; n?: number | null }) {
  const waiting = typeof n === "number" && n > 0;
  return (
    <Link href={href} className={`mod-card ${waiting ? "waiting" : ""} ${n === 0 ? "clear" : ""}`}>
      <span className="mod-card-top">
        <span className="mod-card-title">{title}</span>
        {typeof n === "number" && <span className="mod-card-count">{n === 0 ? "all clear" : n.toLocaleString("en-GB")}</span>}
      </span>
      <span className="mod-card-blurb">{blurb}</span>
    </Link>
  );
}

export default function ReviewHub() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const canModerate = useIsModerator();
  const router = useRouter();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [artistNames, setArtistNames] = useState<Record<string, string>>({});
  const [currentTracks, setCurrentTracks] = useState<Record<string, CurrentTrack>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const [excludedFields, setExcludedFields] = useState<Record<string, Set<string>>>({});

  function toggleFieldExcluded(submissionId: string, key: string) {
    setExcludedFields((prev) => {
      const current = new Set(prev[submissionId] ?? []);
      if (current.has(key)) current.delete(key); else current.add(key);
      return { ...prev, [submissionId]: current };
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, canModerate]);

  async function load() {
    if (!user || !canModerate) return;
    supabase.rpc("rpc_moderation_counts").then(({ data }) => setCounts((data as Counts) ?? null));
    const { data, error: err } = await supabase
      .from("submissions")
      .select("id, type, artist_id, payload, submitted_by, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (err) {
      setError("You don't have access to moderation.");
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

    // Fetch "before" state for every correction and flag -- so we can show
    // a real diff/preview without needing to leave this page.
    const contextTrackIds = Array.from(
      new Set(
        (data ?? [])
          .filter((s) => (s.type === "correction" || s.type === "flag_link" || s.type === "flag_deletion" || s.type === "status_change") && s.payload.track_id)
          .map((s) => s.payload.track_id)
      )
    );
    if (contextTrackIds.length > 0) {
      const { data: tracks } = await supabase
        .from("tracks")
        .select("id, title, spotify_url, is_featured, is_official, parent_track_id, aliases, track_number, release_date, producers, featured_artists, genre, notes, album, release_status")
        .in("id", contextTrackIds);
      const map: Record<string, CurrentTrack> = {};
      (tracks ?? []).forEach((t: any) => { map[t.id] = t; });
      setCurrentTracks(map);
    }
  }

  async function approve(id: string, bulk = false): Promise<string | null> {
    const fail = (m: string) => { if (!bulk) alert(m); return m; };
    const sub = submissions?.find((s) => s.id === id);
    const excluded = Array.from(excludedFields[id] ?? []);

    let note: string | null = "";
    if (excluded.length > 0 && !bulk) {
      const labels = excluded.map((k) => FIELD_LABELS[k] ?? k).join(", ");
      note = window.prompt(
        `Approving everything except: ${labels}. Add a note explaining why for the submitter? (optional, leave blank to skip)`
      );
      if (note === null) return null; // cancelled
    }

    setBusyId(id);
    if (sub?.type === "status_change") {
      // Status changes from ChatGPT routines have their own approve function.
      const { error: err } = await supabase.rpc("approve_status_change", { submission_id: id, p_note: note || null });
      setBusyId(null);
      if (err) return fail(err.message);
      if (!bulk) load();
      return null;
    }
    const { data: resultingId, error: err } = await supabase.rpc("approve_submission", {
      submission_id: id,
      p_excluded_fields: excluded,
      p_note: note || null,
    });
    setBusyId(null);
    if (err) return fail(err.message);

    // A status carried by a correction (e.g. from a link suggestion) isn't
    // applied by approve_submission; set it here so unticking it still works.
    if (sub?.type === "correction" && sub.payload.release_status && sub.payload.track_id && !excluded.includes("release_status")) {
      const { error: statusErr } = await supabase.rpc("admin_set_release_status", {
        p_track_id: sub.payload.track_id,
        p_status: sub.payload.release_status,
      });
      if (statusErr) fail("Approved, but the status couldn't be set: " + statusErr.message);
    }

    // Featured-artist picks are now real artist IDs chosen via the tag
    // picker, not free text -- link them directly. Guard on the key
    // actually being present so older pending submissions from before
    // this change (no featured_artist_ids at all) are left untouched
    // rather than misread as "link nothing". Also skip entirely if that
    // specific field was excluded from this approval.
    if (sub && resultingId && "featured_artist_ids" in sub.payload && !excluded.includes("featured_artist_ids")) {
      const desiredIds: string[] = sub.payload.featured_artist_ids ?? [];

      if (sub.type === "new_track" || sub.type === "new_version") {
        // Nothing existed before this -- just link everything requested.
        await Promise.all(
          desiredIds.map((aid) => supabase.rpc("admin_add_track_appearance", { p_track_id: resultingId, p_artist_id: aid }))
        );
      } else if (sub.type === "correction") {
        // Diff against what's actually linked right now, so approving
        // only applies the real change, not a blind overwrite.
        const { data: current } = await supabase.from("track_appearances").select("artist_id").eq("track_id", resultingId as string);
        const currentIds = (current ?? []).map((a: any) => a.artist_id);
        const toAdd = desiredIds.filter((aid) => !currentIds.includes(aid));
        const toRemove = currentIds.filter((aid) => !desiredIds.includes(aid));
        await Promise.all([
          ...toAdd.map((aid) => supabase.rpc("admin_add_track_appearance", { p_track_id: resultingId, p_artist_id: aid })),
          ...toRemove.map((aid) => supabase.rpc("admin_remove_track_appearance", { p_track_id: resultingId, p_artist_id: aid })),
        ]);
      }
    }

    setExcludedFields((prev) => { const n = { ...prev }; delete n[id]; return n; });
    if (!bulk) load();
    return null;
  }

  // "approve all" for one category: approves each entry in turn (no
  // prompts), then reloads once and lists anything that failed.
  async function approveAll(label: string, entries: Submission[]) {
    if (!window.confirm(`Approve all ${entries.length} in "${label}"?`)) return;
    const failed: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      setBulkProgress(`${label}: ${i + 1} / ${entries.length}`);
      const err = await approve(entries[i].id, true);
      if (err) failed.push(`${describeSimple(entries[i])}: ${err}`);
    }
    setBulkProgress(null);
    load();
    if (failed.length) alert(`${failed.length} couldn't be approved:\n\n${failed.slice(0, 15).join("\n")}${failed.length > 15 ? "\n…" : ""}`);
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
    if (s.type === "new_artist") {
      return s.payload.from_spotify
        ? `New artist: "${s.payload.name}" (${s.payload.library_songs} songs in ${s.payload.library_people} ${s.payload.library_people === 1 ? "person's" : "people's"} Spotify)`
        : `New artist: "${s.payload.name}"`;
    }
    if (s.type === "new_track") {
      const flags = [s.payload.is_featured && "featured", s.payload.is_official && "official"].filter(Boolean).join(", ");
      const linkPart = s.payload.spotify_url ? ` — link: ${s.payload.spotify_url}` : "";
      return `New track for ${artistNames[s.artist_id ?? ""] ?? s.artist_id}: "${s.payload.title}"${flags ? " (" + flags + ")" : ""}${linkPart}`;
    }
    if (s.type === "new_version") {
      const linkPart = s.payload.spotify_url ? ` — link: ${s.payload.spotify_url}` : "";
      return `New sub-entry for ${artistNames[s.artist_id ?? ""] ?? s.artist_id}: "${s.payload.title}"${linkPart}`;
    }
    if (s.type === "artist_merge") {
      return `"${s.payload.from_name}" and "${s.payload.into_name}" are the same artist${s.payload.note ? ` — "${s.payload.note}"` : ""}`;
    }
    if (s.type === "flag_link") {
      const replacement = s.payload.suggested_replacement_url;
      return `Link flagged as broken/wrong${s.payload.reason ? `: "${s.payload.reason}"` : ""}${replacement ? ` — suggested replacement: ${replacement}` : ""}`;
    }
    return s.type;
  }

  // Real before/after diff for corrections -- only shows fields that
  // actually changed, so a small tweak doesn't drown in unchanged fields.
  function diffLines(s: Submission): [string, string, string, string][] {
    const current = s.payload.track_id ? currentTracks[s.payload.track_id] : undefined;
    if (!current) return [];
    const lines: [string, string, string, string][] = [];
    Object.keys(FIELD_LABELS).forEach((key) => {
      if (!(key in s.payload)) return;
      const oldRaw = (current as any)[key];
      const newRaw = s.payload[key];
      const oldVal = oldRaw === null || oldRaw === undefined || oldRaw === "" ? "(none)" : String(oldRaw);
      const newVal = newRaw === null || newRaw === undefined || newRaw === "" ? "(none)" : String(newRaw);
      if (oldVal !== newVal) lines.push([key, FIELD_LABELS[key], oldVal, newVal]);
    });
    if ("parent_track_id" in s.payload) {
      const wasSubVersion = !!current.parent_track_id;
      const willBeSubVersion = !!s.payload.parent_track_id;
      if (wasSubVersion !== willBeSubVersion) {
        lines.push(["parent_track_id", "Sub-version status", wasSubVersion ? "was a sub-version" : "was a main track", willBeSubVersion ? "becomes a sub-version" : "becomes a main track"]);
      }
    }
    if ("featured_artist_ids" in s.payload) {
      const count = (s.payload.featured_artist_ids ?? []).length;
      lines.push(["featured_artist_ids", "Featured Artists", "(see approval)", `${count} artist${count === 1 ? "" : "s"} selected — applied automatically on approval`]);
    }
    return lines;
  }

  // Applies a correction's payload on top of the track's current state, so
  // we can show exactly what it'll look like post-approval -- not just a
  // list of changed fields, but the whole resulting card.
  function buildAfterState(current: CurrentTrack, payload: any): CurrentTrack {
    const after = { ...current };
    Object.keys(FIELD_LABELS).forEach((key) => {
      if (key in payload) (after as any)[key] = payload[key];
    });
    if ("parent_track_id" in payload) after.parent_track_id = payload.parent_track_id || null;
    return after;
  }

  // Compact, reusable card for showing a track's state -- same visual
  // language as the real track rows, so it's instantly recognizable.
  function trackPreviewCard(t: CurrentTrack | null, label: string) {
    if (!t) return null;
    return (
      <div style={{ border: "1px solid var(--hair)", borderRadius: 4, padding: "8px 10px", background: "var(--surface2)", flex: 1, minWidth: 180 }}>
        <div className="comment-meta" style={{ marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.62rem" }}>{label}</div>
        <div className="track-title" style={{ fontSize: "0.86rem", marginBottom: 4 }}>{t.title}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {t.is_featured && <span className="feature-tag">featured</span>}
          <span className="feature-tag">{(t as any).release_status ?? (t.is_official ? "released" : "unreleased")}</span>
          <span className="feature-tag">{t.spotify_url ? "has link" : "no link"}</span>
          {t.parent_track_id && <span className="feature-tag">sub-version</span>}
        </div>
      </div>
    );
  }

  function trackLink(s: Submission): string | null {
    if (!s.artist_id) return null;
    if ((s.type === "correction" || s.type === "flag_link" || s.type === "status_change") && s.payload.track_id) {
      return `/artist/${s.artist_id}?highlight=${s.payload.track_id}`;
    }
    if (s.type === "new_version" && s.payload.parent_track_id) {
      return `/artist/${s.artist_id}?highlight=${s.payload.parent_track_id}`;
    }
    return null;
  }

  async function mergeReport(s: Submission, keep: string, keepName: string, otherName: string) {
    if (!window.confirm(`Merge "${otherName}" into "${keepName}"? Its songs, followers and links move over, "${otherName}" becomes a nickname, and its page is removed.`)) return;
    setBusyId(s.id);
    const { error: err } = await supabase.rpc("admin_approve_artist_merge", { p_submission: s.id, p_keep: keep });
    setBusyId(null);
    if (err) { alert(err.message); return; }
    load();
  }

  function renderEntry(s: Submission) {
    const link = trackLink(s);
    const isFlag = s.type === "flag_link";
    const isDeletion = s.type === "flag_deletion";
    const isCorrection = s.type === "correction";
    const isNewTrackLike = s.type === "new_track" || s.type === "new_version";
    const isStatusChange = s.type === "status_change";
    const fromRoutine = !!s.payload.discovery_id;
    const diffs = isCorrection ? diffLines(s) : [];
    const currentTrack = s.payload.track_id ? currentTracks[s.payload.track_id] : undefined;
    const afterTrack = isCorrection && currentTrack ? buildAfterState(currentTrack, s.payload) : null;

    const hasReplacement = isFlag && !!s.payload.suggested_replacement_url;

    return (
      <div key={s.id} className="track-row" style={{ cursor: "default", flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          {isStatusChange ? (
            <>
              <div className="track-title" style={{ marginBottom: 6 }}>
                Status change for &quot;{currentTrack?.title ?? s.payload.track_id}&quot;
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                <span className="feature-tag">{s.payload.from_status ?? "?"}</span>
                <span className="comment-meta">→</span>
                <span className="feature-tag">{s.payload.to_status}</span>
                {s.payload.release_date && <span className="feature-tag">release {s.payload.release_date}</span>}
              </div>
            </>
          ) : isCorrection ? (
            <>
              <div className="track-title" style={{ marginBottom: 6 }}>Edit for &quot;{s.payload.title}&quot;</div>
              {currentTrack && afterTrack && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                  {trackPreviewCard(currentTrack, "Currently")}
                  {trackPreviewCard(afterTrack, "After approval")}
                </div>
              )}
              {diffs.length === 0 && <div className="comment-meta">No field changes detected.</div>}
              {diffs.length > 0 && (
                <div className="comment-meta" style={{ marginTop: 4, marginBottom: 2, fontStyle: "italic" }}>
                  Uncheck anything you don't want applied — approving still goes through, just without those fields.
                </div>
              )}
              {diffs.map(([key, label, oldVal, newVal]) => {
                const isExcluded = (excludedFields[s.id] ?? new Set()).has(key);
                return (
                  <label
                    key={key}
                    className="comment-meta"
                    style={{ marginTop: 2, display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer", opacity: isExcluded ? 0.5 : 1 }}
                  >
                    <input
                      type="checkbox"
                      checked={!isExcluded}
                      onChange={() => toggleFieldExcluded(s.id, key)}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <b style={{ color: "var(--bone)" }}>{label}:</b> {oldVal} → <b style={{ color: "var(--bone)" }}>{newVal}</b>
                      {isExcluded && " (won't be applied)"}
                    </span>
                  </label>
                );
              })}
            </>
          ) : isDeletion ? (
            <>
              <div className="track-title" style={{ marginBottom: 6, color: "#e88" }}>Flagged for deletion</div>
              {currentTrack && (
                <div style={{ marginBottom: 8, maxWidth: 260 }}>{trackPreviewCard(currentTrack, "Track")}</div>
              )}
              {s.payload.reason && <div className="comment-meta">Reason: {s.payload.reason}</div>}
            </>
          ) : isFlag ? (
            <>
              <div className="track-title" style={{ marginBottom: 6 }}>Link flagged</div>
              {currentTrack && (
                <div style={{ marginBottom: 8, maxWidth: 260 }}>{trackPreviewCard(currentTrack, "Track")}</div>
              )}
              {s.payload.reason && <div className="comment-meta">Reason: {s.payload.reason}</div>}
              {hasReplacement && (
                <div className="comment-meta" style={{ marginTop: 2, wordBreak: "break-all" }}>
                  Suggested replacement: <b style={{ color: "var(--bone)" }}>{s.payload.suggested_replacement_url}</b>
                </div>
              )}
            </>
          ) : isNewTrackLike ? (
            <>
              <div className="track-title" style={{ marginBottom: 6 }}>
                {s.type === "new_track" ? "New track" : "New alternate version"} for {artistNames[s.artist_id ?? ""] ?? s.artist_id}
              </div>
              <div style={{ maxWidth: 260, marginBottom: 4 }}>
                {trackPreviewCard(
                  {
                    id: "",
                    title: s.payload.title,
                    spotify_url: s.payload.spotify_url || null,
                    is_featured: !!s.payload.is_featured,
                    is_official: !!s.payload.is_official,
                    parent_track_id: s.payload.parent_track_id || null,
                    aliases: null, track_number: null, release_date: null, producers: null, featured_artists: null, genre: null, notes: null,
                    ...(s.payload.release_status ? { release_status: s.payload.release_status } : {}),
                  } as CurrentTrack,
                  "Will be added as"
                )}
              </div>
            </>
          ) : (
            <div className="track-title">{describeSimple(s)}</div>
          )}
          {fromRoutine && s.payload.notes && (
            <div className="comment-meta" style={{ marginTop: 4, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {s.payload.notes}
            </div>
          )}
          <div className="comment-meta" style={{ marginTop: 4 }}>
            by {names[s.submitted_by] ?? "…"}{fromRoutine ? " (via ChatGPT routine)" : ""} · {new Date(s.created_at).toLocaleString()}
          </div>
        </div>
        {s.type === "artist_merge" ? (
          <>
            <Link href={`/artist/${s.artist_id}`} className="listen-link">view {s.payload.from_name}</Link>
            <Link href={`/artist/${s.payload.into}`} className="listen-link">view {s.payload.into_name}</Link>
            <button className="listen-link" disabled={busyId === s.id}
              onClick={() => mergeReport(s, s.payload.into, s.payload.into_name, s.payload.from_name)}>
              keep {s.payload.into_name}
            </button>
            <button className="listen-link" disabled={busyId === s.id}
              onClick={() => mergeReport(s, s.artist_id ?? "", s.payload.from_name, s.payload.into_name)}>
              keep {s.payload.from_name}
            </button>
            <button className="listen-link" disabled={busyId === s.id} onClick={() => reject(s.id)}>not the same</button>
          </>
        ) : (<>
        {link && (
          <Link href={link} className="listen-link">
            view live page
          </Link>
        )}
        <button className="listen-link" disabled={busyId === s.id} onClick={() => approve(s.id)}>
          {isDeletion
            ? "delete track"
            : isFlag
            ? (hasReplacement ? "apply replacement" : "remove link")
            : isCorrection && (excludedFields[s.id]?.size ?? 0) > 0
            ? "approve (partial)"
            : "approve"}
        </button>
        <button className="listen-link" disabled={busyId === s.id} onClick={() => reject(s.id)}>
          {isDeletion ? "keep track" : isFlag ? "keep link" : "reject"}
        </button>
        </>)}
      </div>
    );
  }

  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;

  return (
    <div>
      <div className="section-label" style={{ marginTop: 0 }}>Lists to work through</div>
      <div className="mod-grid">
        {[
          { href: "/review/imports", title: "Imported songs", n: counts?.imported_songs, blurb: "Songs found by Genius, Last.fm and sheets, waiting for a yes or no." },
          { href: "/review/tracker", title: "Tracker disagrees", n: counts?.tracker_disagreements, blurb: "A community tracker gives a different status from ours: pick one." },
          { href: "/review/versions", title: "Sub-versions", n: counts?.sub_versions, blurb: "Songs that look like a version of another song." },
          { href: "/review/guests", title: "Guest artists", n: counts?.guest_artists, blurb: "Featured artists Spotify couldn't confirm: add, match or skip." },
          { href: "/review/comments", title: "Reported comments", n: counts?.reported_comments, blurb: "Comments people have reported: keep or remove." },
          ...(isAdmin ? [{ href: "/review/takedowns", title: "Takedowns", n: counts?.takedowns ?? undefined, blurb: "Requests from rights holders to remove a song." }] : []),
          { href: "/review/duplicates", title: "Duplicates", n: undefined, blurb: "The same song entered twice: pick one to keep and merge." },
        ]
          // Lists with something waiting first, then ones without a count, then the clear ones.
          .sort((a, b) => rank(a.n) - rank(b.n))
          .map((c) => <JobCard key={c.href} {...c} />)}
      </div>

      <div className="section-label">Tools</div>
      <div className="mod-grid">
        <JobCard href="/admin/sheets" title="Spreadsheets" n={counts?.sheet_requests ? counts.sheet_requests : undefined}
          blurb="Import a community tracker, re-check one, or handle ones people have sent in." />
        {isAdmin && <JobCard href="/admin/tracklist" title="Paste a tracklist" blurb="Add a whole album's songs at once." />}
        {isAdmin && <JobCard href="/admin/queue" title="Artist queue" blurb="Which artists get checked for new music next." />}
        <JobCard href="/review/trusted" title="Trusted contributors"
          blurb="People whose suggestions go live straight away." />
        {isAdmin && <JobCard href="/admin/batches" title="Undo history" blurb="Every bulk change, and undo for each." />}
      </div>

      {error && <div className="empty-state error" style={{ marginTop: 16 }}>{error}</div>}
      {!error && user && <Discoveries onPromoted={load} />}
      {!error && submissions === null && <div className="empty-state">loading…</div>}
      {!error && submissions && submissions.length === 0 && (
        <>
          <div className="section-label">Suggestions waiting</div>
          <div className="empty-state">
            Nothing from users right now. These are what people send with &ldquo;suggest track&rdquo;, &ldquo;suggest
            edit&rdquo;, &ldquo;wrong link&rdquo; and the like.
          </div>
        </>
      )}

      {!error && submissions && submissions.length > 0 && (
        <div className="section-label">Suggestions waiting ({submissions.length})</div>
      )}
      {!error && submissions && submissions.length > 0 && CATEGORIES.map((cat) => {
        const entries = submissions.filter((s) => cat.types.includes(s.type));
        if (entries.length === 0) return null;
        return (
          <div key={cat.key} style={{ marginBottom: 10 }}>
            <div className="section-label" style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span>{cat.label} ({entries.length})</span>
              {cat.key !== "deletions" && cat.key !== "same_artist" && (
                <button className="listen-link" disabled={!!bulkProgress} onClick={() => approveAll(cat.label, entries)}>
                  {bulkProgress?.startsWith(cat.label + ":") ? bulkProgress.slice(cat.label.length + 2) : "approve all"}
                </button>
              )}
            </div>
            {entries.map((s) => renderEntry(s))}
          </div>
        );
      })}
    </div>
  );
}
