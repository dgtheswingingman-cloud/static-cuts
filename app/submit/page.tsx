"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";

type SubmitType = "new_artist" | "new_track" | "new_version" | "correction";

function SubmitForm() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const typeParam = searchParams.get("type") as SubmitType | null;
  const prefilledArtistId = searchParams.get("artist_id") ?? "";
  const prefilledArtistName = searchParams.get("artist_name") ?? "";
  const prefillNewArtistName = searchParams.get("prefill_name") ?? "";
  const prefilledParentTrackId = searchParams.get("parent_track_id") ?? "";
  const prefilledParentTitle = searchParams.get("parent_title") ?? "";
  const prefilledTrackId = searchParams.get("track_id") ?? "";
  const prefilledTrackTitle = searchParams.get("track_title") ?? "";
  const currentUrl = searchParams.get("current_url") ?? "";
  const currentFeatured = searchParams.get("current_featured") === "true";
  const currentOfficial = searchParams.get("current_official") === "true";
  const currentParentId = searchParams.get("current_parent_id") ?? "";
  const currentParentTitle = searchParams.get("current_parent_title") ?? "";

  const [parentSearch, setParentSearch] = useState(currentParentTitle);
  const [parentResults, setParentResults] = useState<{ id: string; title: string }[]>([]);
  const [parentSuggestionsOpen, setParentSuggestionsOpen] = useState(false);

  const initialType: SubmitType = typeParam
    ? typeParam
    : prefilledParentTrackId
    ? "new_version"
    : prefilledArtistId
    ? "new_track"
    : "new_artist";

  const [type] = useState<SubmitType>(initialType);
  const [artistName, setArtistName] = useState(prefillNewArtistName);
  const [trackTitle, setTrackTitle] = useState("");
  const [trackUrl, setTrackUrl] = useState("");
  const [versionTitle, setVersionTitle] = useState("");
  const [versionUrl, setVersionUrl] = useState("");
  const [isFeatured, setIsFeatured] = useState(false);
  const [isOfficial, setIsOfficial] = useState(false);

  // Correction-mode fields, prefilled from the track's current values
  const [editTitle, setEditTitle] = useState(prefilledTrackTitle);
  const [editUrl, setEditUrl] = useState(currentUrl);
  const [editFeatured, setEditFeatured] = useState(currentFeatured);
  const [editOfficial, setEditOfficial] = useState(currentOfficial);
  const [editParentId, setEditParentId] = useState(currentParentId);

  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (type !== "correction" || !prefilledArtistId) return;
    const q = parentSearch.trim();
    if (q.length < 2) { setParentResults([]); return; }
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from("tracks")
        .select("id, title")
        .eq("artist_id", prefilledArtistId)
        .is("parent_track_id", null)
        .neq("id", prefilledTrackId)
        .ilike("title", `%${q}%`)
        .limit(8);
      setParentResults(data ?? []);
    }, 300);
    return () => clearTimeout(handle);
  }, [parentSearch, type, prefilledArtistId, prefilledTrackId]);

  // Checks for an existing track with a matching title (under the same
  // parent scope) or the same listen link, and asks for confirmation
  // before submitting a likely duplicate. Returns true if it's OK to
  // proceed.
  async function checkForDuplicates(opts: {
    artistId: string;
    title: string;
    url: string;
    parentTrackId?: string | null;
    excludeTrackId?: string;
  }): Promise<boolean> {
    const { artistId, title, url, parentTrackId, excludeTrackId } = opts;

    let titleQuery = supabase
      .from("tracks")
      .select("id, title")
      .eq("artist_id", artistId)
      .ilike("title", title.trim());
    if (parentTrackId) titleQuery = titleQuery.eq("parent_track_id", parentTrackId);
    else titleQuery = titleQuery.is("parent_track_id", null);
    const { data: titleMatches } = await titleQuery;
    const realTitleMatches = (titleMatches ?? []).filter((t) => t.id !== excludeTrackId);
    if (realTitleMatches.length > 0) {
      if (!window.confirm(`A track named "${title.trim()}" already exists here. Submit anyway?`)) {
        return false;
      }
    }

    if (url.trim()) {
      const { data: linkMatches } = await supabase
        .from("tracks")
        .select("id, title")
        .eq("spotify_url", url.trim());
      const realLinkMatches = (linkMatches ?? []).filter((t) => t.id !== excludeTrackId);
      if (realLinkMatches.length > 0) {
        if (!window.confirm(`That link is already attached to "${realLinkMatches[0].title}". Submit anyway?`)) {
          return false;
        }
      }
    }

    return true;
  }

  async function submit() {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      if (type === "new_artist") {
        if (!artistName.trim()) throw new Error("Enter an artist name.");
        const { data: existingArtists } = await supabase
          .from("artists")
          .select("id, name")
          .ilike("name", artistName.trim());
        if ((existingArtists ?? []).length > 0) {
          const ok = window.confirm(`"${existingArtists![0].name}" already exists in the archive. Submit anyway?`);
          if (!ok) { setBusy(false); return; }
        }
        const { error: err } = await supabase.from("submissions").insert({
          type: "new_artist",
          submitted_by: user.id,
          payload: { name: artistName.trim() },
        });
        if (err) throw err;
      } else if (type === "new_track") {
        if (!prefilledArtistId) throw new Error("Missing artist — go to an artist's page and use \"suggest a track\" there.");
        if (!trackTitle.trim()) throw new Error("Enter a track title.");
        const ok = await checkForDuplicates({ artistId: prefilledArtistId, title: trackTitle, url: trackUrl });
        if (!ok) { setBusy(false); return; }
        const { error: err } = await supabase.from("submissions").insert({
          type: "new_track",
          artist_id: prefilledArtistId,
          submitted_by: user.id,
          payload: {
            title: trackTitle.trim(),
            spotify_url: trackUrl.trim() || undefined,
            track_type: "studio",
            is_featured: isFeatured,
            is_official: isOfficial,
            has_audio: true,
          },
        });
        if (err) throw err;
      } else if (type === "new_version") {
        if (!prefilledParentTrackId || !prefilledArtistId) throw new Error("Missing the original track — go back and use \"suggest an alternate version\" from that track.");
        if (!versionTitle.trim()) throw new Error("Enter a title for this version.");
        const ok = await checkForDuplicates({
          artistId: prefilledArtistId,
          title: versionTitle,
          url: versionUrl,
          parentTrackId: prefilledParentTrackId,
        });
        if (!ok) { setBusy(false); return; }
        const { error: err } = await supabase.from("submissions").insert({
          type: "new_version",
          artist_id: prefilledArtistId,
          submitted_by: user.id,
          payload: {
            title: versionTitle.trim(),
            spotify_url: versionUrl.trim() || undefined,
            parent_track_id: prefilledParentTrackId,
            track_type: "alternate_version",
            is_featured: false,
            is_official: false,
            has_audio: true,
          },
        });
        if (err) throw err;
      } else {
        // correction -- suggest a link or metadata fix on an existing track
        if (!prefilledTrackId || !prefilledArtistId) throw new Error("Missing the track — go back and use \"suggest edit\" from that track.");
        if (!editTitle.trim()) throw new Error("Title can't be empty.");
        const ok = await checkForDuplicates({
          artistId: prefilledArtistId,
          title: editTitle,
          url: editUrl,
          excludeTrackId: prefilledTrackId,
        });
        if (!ok) { setBusy(false); return; }
        const { error: err } = await supabase.from("submissions").insert({
          type: "correction",
          artist_id: prefilledArtistId,
          submitted_by: user.id,
          payload: {
            track_id: prefilledTrackId,
            title: editTitle.trim(),
            spotify_url: editUrl.trim(),
            is_featured: editFeatured,
            is_official: editOfficial,
            parent_track_id: editParentId,
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

  const titles: Record<SubmitType, string> = {
    new_artist: "Suggest a new artist",
    new_track: "Suggest a track",
    new_version: "Suggest an alternate version",
    correction: "Suggest an edit",
  };

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← back to archive</button>
      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>{titles[type]}</h1>
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
            <input
              className="search-input"
              placeholder="Listen link, if you have one (optional)"
              value={trackUrl}
              onChange={(e) => setTrackUrl(e.target.value)}
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
            <input
              className="search-input"
              placeholder="Listen link, if you have one (optional)"
              value={versionUrl}
              onChange={(e) => setVersionUrl(e.target.value)}
              style={{ marginBottom: 12 }}
            />
          </>
        )}

        {type === "correction" && (
          <>
            <div className="detail-meta" style={{ marginBottom: 10 }}>
              Editing an existing track. Change whatever needs fixing — leave the rest as-is.
            </div>
            <input
              className="search-input"
              placeholder="Title"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <input
              className="search-input"
              placeholder="Listen link (e.g. Spotify URL) — leave blank to remove"
              value={editUrl}
              onChange={(e) => setEditUrl(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
              <label style={{ fontFamily: "var(--font-inter)", fontSize: "0.85rem", color: "var(--smoke)" }}>
                <input type="checkbox" checked={editFeatured} onChange={(e) => setEditFeatured(e.target.checked)} /> featured (guest artist)
              </label>
              <label style={{ fontFamily: "var(--font-inter)", fontSize: "0.85rem", color: "var(--smoke)" }}>
                <input type="checkbox" checked={editOfficial} onChange={(e) => setEditOfficial(e.target.checked)} /> official release
              </label>
            </div>
            <div className="detail-meta" style={{ marginBottom: 6 }}>
              Should this be a sub-version of another track (e.g. a demo/alt-mix that got added
              as its own main track by mistake)?
            </div>
            <div style={{ position: "relative", marginBottom: 12 }}>
              <input
                className="search-input"
                style={{ width: "100%" }}
                placeholder="Type to search main tracks…"
                value={parentSearch}
                onChange={(e) => { setParentSearch(e.target.value); setParentSuggestionsOpen(true); if (!e.target.value) setEditParentId(""); }}
                onFocus={() => setParentSuggestionsOpen(true)}
              />
              {parentSuggestionsOpen && parentSearch.trim().length >= 2 && (
                <div className="comments-panel" style={{ position: "absolute", zIndex: 5, width: "100%", maxHeight: 220, overflowY: "auto", padding: "6px 4px" }}>
                  {parentResults.map((mt) => (
                    <div
                      key={mt.id}
                      className="comment-item"
                      style={{ cursor: "pointer", padding: "8px 6px" }}
                      onClick={() => {
                        setEditParentId(mt.id);
                        setParentSearch(mt.title);
                        setParentSuggestionsOpen(false);
                      }}
                    >
                      <span className="comment-body" style={{ fontSize: "0.82rem" }}>{mt.title}</span>
                    </div>
                  ))}
                  {parentResults.length === 0 && <div className="comments-count">No matches.</div>}
                </div>
              )}
            </div>
            <div className="detail-meta" style={{ marginBottom: 12 }}>
              {editParentId ? "Will become a sub-version." : "Clear the box to keep it a main track."}
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
