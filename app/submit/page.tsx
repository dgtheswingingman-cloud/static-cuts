"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";

type SubmitType = "new_artist" | "new_track" | "new_version";

function SubmitForm() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const prefilledArtistId = searchParams.get("artist_id") ?? "";
  const prefilledArtistName = searchParams.get("artist_name") ?? "";
  const prefillNewArtistName = searchParams.get("prefill_name") ?? "";
  const prefilledParentTrackId = searchParams.get("parent_track_id") ?? "";
  const prefilledParentTitle = searchParams.get("parent_title") ?? "";

  const initialType: SubmitType = prefilledParentTrackId
    ? "new_version"
    : prefilledArtistId
    ? "new_track"
    : "new_artist";

  const [type] = useState<SubmitType>(initialType);
  const [artistName, setArtistName] = useState(prefillNewArtistName);
  const [trackTitle, setTrackTitle] = useState("");
  const [versionTitle, setVersionTitle] = useState("");
  const [isFeatured, setIsFeatured] = useState(false);
  const [isOfficial, setIsOfficial] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  async function submit() {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      if (type === "new_artist") {
        if (!artistName.trim()) throw new Error("Enter an artist name.");
        const { error: err } = await supabase.from("submissions").insert({
          type: "new_artist",
          submitted_by: user.id,
          payload: { name: artistName.trim() },
        });
        if (err) throw err;
      } else if (type === "new_track") {
        if (!prefilledArtistId) throw new Error("Missing artist — go to an artist's page and use \"suggest a track\" there.");
        if (!trackTitle.trim()) throw new Error("Enter a track title.");
        const { error: err } = await supabase.from("submissions").insert({
          type: "new_track",
          artist_id: prefilledArtistId,
          submitted_by: user.id,
          payload: {
            title: trackTitle.trim(),
            track_type: "studio",
            is_featured: isFeatured,
            is_official: isOfficial,
            has_audio: true,
          },
        });
        if (err) throw err;
      } else {
        // new_version -- an alternate take/demo/live version nested under an existing track
        if (!prefilledParentTrackId || !prefilledArtistId) throw new Error("Missing the original track — go back and use \"suggest an alternate version\" from that track.");
        if (!versionTitle.trim()) throw new Error("Enter a title for this version.");
        const { error: err } = await supabase.from("submissions").insert({
          type: "new_version",
          artist_id: prefilledArtistId,
          submitted_by: user.id,
          payload: {
            title: versionTitle.trim(),
            parent_track_id: prefilledParentTrackId,
            track_type: "alternate_version",
            is_featured: false,
            is_official: false,
            has_audio: true,
          },
        });
        if (err) throw err;
      }
      setSubmitted(true);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="wrap">
        <button className="back-btn" onClick={() => router.push("/")}>← back to archive</button>
        <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>Thanks!</h1>
        <div className="empty-state" style={{ marginTop: 16 }}>
          Your submission is in the queue for review. Check{" "}
          <a href="/my-submissions" style={{ color: "var(--bone)" }}>my submissions</a> for status.
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← back to archive</button>
      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>
        {type === "new_version" ? "Suggest an alternate version" : type === "new_track" ? "Suggest a track" : "Suggest a new artist"}
      </h1>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        Reviewed before it goes live — nothing you submit appears in the archive automatically.
      </div>

      <div style={{ maxWidth: 480 }}>
        {type === "new_artist" && (
          <input
            className="search-input"
            placeholder="Artist name"
            value={artistName}
            onChange={(e) => setArtistName(e.target.value)}
            style={{ marginBottom: 12 }}
          />
        )}

        {type === "new_track" && (
          <>
            <div className="detail-meta" style={{ marginBottom: 10 }}>
              Adding a track to <b style={{ color: "var(--bone)" }}>{prefilledArtistName}</b>
            </div>
            <input
              className="search-input"
              placeholder="Track title"
              value={trackTitle}
              onChange={(e) => setTrackTitle(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
              <label style={{ fontFamily: "var(--font-inter)", fontSize: "0.85rem", color: "var(--smoke)" }}>
                <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} /> featured (guest artist)
              </label>
              <label style={{ fontFamily: "var(--font-inter)", fontSize: "0.85rem", color: "var(--smoke)" }}>
                <input type="checkbox" checked={isOfficial} onChange={(e) => setIsOfficial(e.target.checked)} /> official release
              </label>
            </div>
            <div className="detail-meta">
              Got a demo, live version, or alt take of a track that&apos;s already listed? Go to that
              track and use &quot;suggest an alternate version&quot; instead of adding it here as a new
              main track.
            </div>
          </>
        )}

        {type === "new_version" && (
          <>
            <div className="detail-meta" style={{ marginBottom: 10 }}>
              Alternate version of <b style={{ color: "var(--bone)" }}>{prefilledParentTitle}</b> —
              this will show up nested under the original, not as its own separate track.
            </div>
            <input
              className="search-input"
              placeholder='e.g. "Demo", "Live at Radio City", "Alt Mix"'
              value={versionTitle}
              onChange={(e) => setVersionTitle(e.target.value)}
              style={{ marginBottom: 12 }}
            />
          </>
        )}

        {error && (
          <div className="empty-state" style={{ borderColor: "#a33", marginBottom: 12 }}>{error}</div>
        )}

        <button className="comment-post-btn" disabled={busy} onClick={submit}>
          {busy ? "…" : "submit for review"}
        </button>
      </div>
    </div>
  );
}

export default function SubmitPage() {
  return (
    <Suspense fallback={<div className="wrap"><div className="empty-state">loading…</div></div>}>
      <SubmitForm />
    </Suspense>
  );
}
