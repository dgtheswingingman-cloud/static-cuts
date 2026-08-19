"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";

function SubmitForm() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledArtistId = searchParams.get("artist_id") ?? "";
  const prefilledArtistName = searchParams.get("artist_name") ?? "";
  const prefillNewArtistName = searchParams.get("prefill_name") ?? "";

  const [type, setType] = useState<"new_artist" | "new_track">(
    prefilledArtistId ? "new_track" : "new_artist"
  );
  const [artistName, setArtistName] = useState(prefillNewArtistName);
  const [trackTitle, setTrackTitle] = useState("");
  const [trackType, setTrackType] = useState("studio");
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
      } else {
        if (!prefilledArtistId) throw new Error("Missing artist — go to an artist's page and use \"suggest a track\" there.");
        if (!trackTitle.trim()) throw new Error("Enter a track title.");
        const { error: err } = await supabase.from("submissions").insert({
          type: "new_track",
          artist_id: prefilledArtistId,
          submitted_by: user.id,
          payload: {
            title: trackTitle.trim(),
            track_type: trackType,
            is_featured: isFeatured,
            is_official: isOfficial,
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
      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>Suggest an addition</h1>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        Reviewed before it goes live — nothing you submit appears in the archive automatically.
      </div>

      {!prefilledArtistId && (
        <div className="tabs" style={{ marginBottom: 20 }}>
          <button className={`tab ${type === "new_artist" ? "active" : ""}`} onClick={() => setType("new_artist")}>
            new artist
          </button>
        </div>
      )}

      <div style={{ maxWidth: 480 }}>
        {type === "new_artist" && (
          <>
            <input
              className="search-input"
              placeholder="Artist name"
              value={artistName}
              onChange={(e) => setArtistName(e.target.value)}
              style={{ marginBottom: 12 }}
            />
          </>
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
            <select
              className="sort-select"
              value={trackType}
              onChange={(e) => setTrackType(e.target.value)}
              style={{ marginBottom: 12, width: "100%" }}
            >
              <option value="studio">Studio</option>
              <option value="demo">Demo</option>
              <option value="snippet">Snippet</option>
              <option value="live">Live</option>
              <option value="alternate_version">Alternate version</option>
              <option value="rumoured">Rumoured (no audio exists)</option>
            </select>
            <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
              <label style={{ fontFamily: "var(--font-inter)", fontSize: "0.85rem", color: "var(--smoke)" }}>
                <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} /> featured (guest artist)
              </label>
              <label style={{ fontFamily: "var(--font-inter)", fontSize: "0.85rem", color: "var(--smoke)" }}>
                <input type="checkbox" checked={isOfficial} onChange={(e) => setIsOfficial(e.target.checked)} /> official release
              </label>
            </div>
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
