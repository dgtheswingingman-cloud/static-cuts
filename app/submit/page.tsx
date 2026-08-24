"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import DateDropdownPicker from "../components/DateDropdownPicker";
import AlbumAutocomplete from "../components/AlbumAutocomplete";

type SubmitType = "new_artist" | "new_track" | "new_version" | "correction" | "flag_link" | "flag_deletion";

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
  const currentAliases = searchParams.get("current_aliases") ?? "";
  const currentTrackNumber = searchParams.get("current_track_number") ?? "";
  const currentReleaseDate = searchParams.get("current_release_date") ?? "";
  const currentProducers = searchParams.get("current_producers") ?? "";
  const currentFeaturedArtistTags: { id: string; name: string }[] = (() => {
    const raw = searchParams.get("current_featured_artist_tags");
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  })();
  const currentGenre = searchParams.get("current_genre") ?? "";
  const currentNotes = searchParams.get("current_notes") ?? "";
  const currentAlbum = searchParams.get("current_album") ?? "";

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
  const [mainArtistSearch, setMainArtistSearch] = useState("");
  const [mainArtistResults, setMainArtistResults] = useState<{ id: string; name: string }[]>([]);
  const [mainArtistId, setMainArtistId] = useState("");
  const [newAliases, setNewAliases] = useState("");
  const [newAlbum, setNewAlbum] = useState("");
  const [newTrackNumber, setNewTrackNumber] = useState("");
  const [newReleaseDate, setNewReleaseDate] = useState("");
  const [newProducers, setNewProducers] = useState("");
  const [newGenre, setNewGenre] = useState("");
  const [newNotes, setNewNotes] = useState("");

  // Correction-mode fields, prefilled from the track's current values
  const [editTitle, setEditTitle] = useState(prefilledTrackTitle);
  const [editUrl, setEditUrl] = useState(currentUrl);
  const [editFeatured, setEditFeatured] = useState(currentFeatured);
  const [editOfficial, setEditOfficial] = useState(currentOfficial);
  const [editParentId, setEditParentId] = useState(currentParentId);
  const [editAliases, setEditAliases] = useState(currentAliases);
  const [editTrackNumber, setEditTrackNumber] = useState(currentTrackNumber);
  const [editReleaseDate, setEditReleaseDate] = useState(currentReleaseDate);
  const [editProducers, setEditProducers] = useState(currentProducers);
  const [newFeaturedTags, setNewFeaturedTags] = useState<{ id: string; name: string }[]>([]);
  const [newFeaturedSearch, setNewFeaturedSearch] = useState("");
  const [newFeaturedResults, setNewFeaturedResults] = useState<{ id: string; name: string }[]>([]);
  const [editFeaturedTags, setEditFeaturedTags] = useState<{ id: string; name: string }[]>(currentFeaturedArtistTags);
  const [editFeaturedSearch, setEditFeaturedSearch] = useState("");
  const [editFeaturedResults, setEditFeaturedResults] = useState<{ id: string; name: string }[]>([]);
  const [editGenre, setEditGenre] = useState(currentGenre);
  const [editNotes, setEditNotes] = useState(currentNotes);
  const [editAlbum, setEditAlbum] = useState(currentAlbum);
  const [flagReason, setFlagReason] = useState("");
  const [flagReplacement, setFlagReplacement] = useState("");
  const [deletionReason, setDeletionReason] = useState("");

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

  useEffect(() => {
    const q = mainArtistSearch.trim();
    if (q.length < 2) { setMainArtistResults([]); return; }
    const handle = setTimeout(async () => {
      const { data } = await supabase.from("artists").select("id, name").ilike("name", `%${q}%`).limit(8);
      setMainArtistResults(data ?? []);
    }, 300);
    return () => clearTimeout(handle);
  }, [mainArtistSearch]);

  useEffect(() => {
    const q = newFeaturedSearch.trim();
    if (q.length < 2) { setNewFeaturedResults([]); return; }
    const handle = setTimeout(async () => {
      const { data } = await supabase.from("artists").select("id, name").ilike("name", `%${q}%`).neq("id", prefilledArtistId ?? "").limit(8);
      setNewFeaturedResults((data ?? []).filter((a) => !newFeaturedTags.some((t) => t.id === a.id)));
    }, 300);
    return () => clearTimeout(handle);
  }, [newFeaturedSearch, prefilledArtistId, newFeaturedTags]);

  useEffect(() => {
    const q = editFeaturedSearch.trim();
    if (q.length < 2) { setEditFeaturedResults([]); return; }
    const handle = setTimeout(async () => {
      const { data } = await supabase.from("artists").select("id, name").ilike("name", `%${q}%`).limit(8);
      setEditFeaturedResults((data ?? []).filter((a) => !editFeaturedTags.some((t) => t.id === a.id)));
    }, 300);
    return () => clearTimeout(handle);
  }, [editFeaturedSearch, editFeaturedTags]);

  // Shared render for both tag pickers -- no "create on the fly" here,
  // since regular users can't create artists directly; if someone's
  // missing, they use the separate "suggest a new artist" flow instead.
  function featuredTagPicker(
    tags: { id: string; name: string }[],
    setTags: (t: { id: string; name: string }[]) => void,
    search: string,
    setSearch: (s: string) => void,
    results: { id: string; name: string }[]
  ) {
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {tags.map((a) => (
            <span key={a.id} className="feature-tag" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {a.name}
              <span style={{ cursor: "pointer", opacity: 0.7 }} onClick={() => setTags(tags.filter((t) => t.id !== a.id))}>✕</span>
            </span>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <input
            className="search-input"
            style={{ width: "100%" }}
            placeholder="Search artists to add…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search.trim().length >= 2 && (
            <div className="autosuggest-dropdown" style={{ position: "absolute", zIndex: 5, width: "100%", maxHeight: 180, overflowY: "auto", padding: "6px 4px" }}>
              {results.map((a) => (
                <div
                  key={a.id}
                  className="comment-item"
                  style={{ cursor: "pointer", padding: "8px 6px" }}
                  onClick={() => { setTags([...tags, a]); setSearch(""); }}
                >
                  <span className="comment-body" style={{ fontSize: "0.82rem" }}>{a.name}</span>
                </div>
              ))}
              {results.length === 0 && (
                <div className="comments-count" style={{ padding: "8px 6px" }}>
                  Not found — if they&apos;re not in the archive yet, suggest them as a new artist separately.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
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
        if (isFeatured && !mainArtistId) throw new Error("Since this is marked featured, select who the actual main artist is first.");
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
            main_artist_id: isFeatured ? mainArtistId : undefined,
            aliases: newAliases.trim(),
            album: newAlbum.trim(),
            track_number: newTrackNumber.trim(),
            release_date: newReleaseDate.trim(),
            producers: newProducers.trim(),
            featured_artist_ids: isFeatured ? [] : newFeaturedTags.map((a) => a.id),
            genre: newGenre.trim(),
            notes: newNotes.trim(),
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
            aliases: newAliases.trim(),
            album: newAlbum.trim(),
            track_number: newTrackNumber.trim(),
            release_date: newReleaseDate.trim(),
            producers: newProducers.trim(),
            featured_artist_ids: newFeaturedTags.map((a) => a.id),
            genre: newGenre.trim(),
            notes: newNotes.trim(),
          },
        });
        if (err) throw err;
      } else if (type === "correction") {
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
            aliases: editAliases.trim(),
            track_number: editTrackNumber.trim(),
            release_date: editReleaseDate.trim(),
            producers: editProducers.trim(),
            featured_artist_ids: editFeaturedTags.map((a) => a.id),
            genre: editGenre.trim(),
            notes: editNotes.trim(),
            album: editAlbum.trim(),
          },
        });
        if (err) throw err;
      } else if (type === "flag_link") {
        // flag_link -- report a dead/wrong link, optionally with a known replacement
        if (!prefilledTrackId || !prefilledArtistId) throw new Error("Missing the track — go back and use \"flag link\" from that track.");
        const { error: err } = await supabase.from("submissions").insert({
          type: "flag_link",
          artist_id: prefilledArtistId,
          submitted_by: user.id,
          payload: {
            track_id: prefilledTrackId,
            reason: flagReason.trim(),
            suggested_replacement_url: flagReplacement.trim() || undefined,
          },
        });
        if (err) throw err;
      } else if (type === "flag_deletion") {
        // flag_deletion -- report a track that shouldn't exist (duplicate, wrong artist, etc)
        if (!prefilledTrackId || !prefilledArtistId) throw new Error("Missing the track — go back and use \"flag for deletion\" from that track.");
        if (!deletionReason.trim()) throw new Error("Say why it should be removed — this one's permanent, so admin needs the reason.");
        const { error: err } = await supabase.from("submissions").insert({
          type: "flag_deletion",
          artist_id: prefilledArtistId,
          submitted_by: user.id,
          payload: { track_id: prefilledTrackId, reason: deletionReason.trim() },
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
    flag_link: "Flag a broken link",
    flag_deletion: "Flag a track for deletion",
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
                <input type="checkbox" checked={isFeatured} onChange={(e) => { setIsFeatured(e.target.checked); setMainArtistId(""); setMainArtistSearch(""); }} /> featured (guest artist)
              </label>
              <label style={{ fontFamily: "var(--font-inter)", fontSize: "0.85rem", color: "var(--smoke)" }}>
                <input type="checkbox" checked={isOfficial} onChange={(e) => setIsOfficial(e.target.checked)} /> official release
              </label>
            </div>

            {isFeatured ? (
              <div style={{ marginBottom: 12 }}>
                <div className="detail-meta" style={{ marginBottom: 6 }}>
                  Since {prefilledArtistName} is just featured here, who&apos;s the actual main artist?
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    className="search-input"
                    style={{ width: "100%" }}
                    placeholder="Search artists…"
                    value={mainArtistSearch}
                    onChange={(e) => { setMainArtistSearch(e.target.value); setMainArtistId(""); }}
                  />
                  {mainArtistSearch.trim().length >= 2 && !mainArtistId && (
                    <div className="autosuggest-dropdown" style={{ position: "absolute", zIndex: 5, width: "100%", maxHeight: 180, overflowY: "auto", padding: "6px 4px" }}>
                      {mainArtistResults.map((a) => (
                        <div key={a.id} className="comment-item" style={{ cursor: "pointer", padding: "8px 6px" }}
                          onClick={() => { setMainArtistId(a.id); setMainArtistSearch(a.name); }}>
                          <span className="comment-body" style={{ fontSize: "0.82rem" }}>{a.name}</span>
                        </div>
                      ))}
                      {mainArtistResults.length === 0 && <div className="comments-count">No matches — try the exact name, or ask an admin to add them first.</div>}
                    </div>
                  )}
                </div>
                {mainArtistId && (
                  <div className="detail-meta" style={{ marginTop: 4 }}>
                    Will be added under {mainArtistSearch}, and linked here as a feature.
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginBottom: 4 }}>
                <div className="detail-meta" style={{ marginBottom: 6 }}>Featured artists, if any (optional)</div>
                {featuredTagPicker(newFeaturedTags, setNewFeaturedTags, newFeaturedSearch, setNewFeaturedSearch, newFeaturedResults)}
              </div>
            )}

            <div className="detail-meta" style={{ marginBottom: 6 }}>Verbose info (optional)</div>
            <input className="search-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Aliases (comma separated)"
              value={newAliases} onChange={(e) => setNewAliases(e.target.value)} />
            <div style={{ marginBottom: 8 }}>
              <AlbumAutocomplete
                idPrefix="new-track"
                artistId={isFeatured ? (mainArtistId || null) : prefilledArtistId}
                value={newAlbum}
                onChange={setNewAlbum}
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input className="search-input" style={{ flex: 1 }} type="number" id="new-version-track-number" name="track-number" aria-label="Track number" placeholder="Track #"
                value={newTrackNumber} onChange={(e) => setNewTrackNumber(e.target.value)} />
              <DateDropdownPicker idPrefix="new-version-release-date" value={newReleaseDate} onChange={setNewReleaseDate} />
            </div>
            <input className="search-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Producers"
              value={newProducers} onChange={(e) => setNewProducers(e.target.value)} />
            <input className="search-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Genre"
              value={newGenre} onChange={(e) => setNewGenre(e.target.value)} />
            <textarea className="comment-textarea" style={{ marginBottom: 12 }} placeholder="Notes"
              value={newNotes} onChange={(e) => setNewNotes(e.target.value)} />

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

            <div className="detail-meta" style={{ marginBottom: 6 }}>Verbose info (optional)</div>
            <input className="search-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Aliases (comma separated)"
              value={newAliases} onChange={(e) => setNewAliases(e.target.value)} />
            <div style={{ marginBottom: 8 }}>
              <AlbumAutocomplete idPrefix="new-version" artistId={prefilledArtistId} value={newAlbum} onChange={setNewAlbum} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input className="search-input" style={{ flex: 1 }} type="number" id="new-track-track-number" name="track-number" aria-label="Track number" placeholder="Track #"
                value={newTrackNumber} onChange={(e) => setNewTrackNumber(e.target.value)} />
              <DateDropdownPicker idPrefix="new-track-release-date" value={newReleaseDate} onChange={setNewReleaseDate} />
            </div>
            <input className="search-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Producers"
              value={newProducers} onChange={(e) => setNewProducers(e.target.value)} />
            <div className="detail-meta" style={{ marginBottom: 6 }}>Featured artists, if any (optional)</div>
            {featuredTagPicker(newFeaturedTags, setNewFeaturedTags, newFeaturedSearch, setNewFeaturedSearch, newFeaturedResults)}
            <input className="search-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Genre"
              value={newGenre} onChange={(e) => setNewGenre(e.target.value)} />
            <textarea className="comment-textarea" style={{ marginBottom: 12 }} placeholder="Notes"
              value={newNotes} onChange={(e) => setNewNotes(e.target.value)} />
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
                <div className="autosuggest-dropdown" style={{ position: "absolute", zIndex: 5, width: "100%", maxHeight: 220, overflowY: "auto", padding: "6px 4px" }}>
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

            <div className="detail-meta" style={{ marginBottom: 6 }}>Verbose info (optional)</div>
            <input className="search-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Aliases (comma separated)"
              value={editAliases} onChange={(e) => setEditAliases(e.target.value)} />
            <div style={{ marginBottom: 8 }}>
              <AlbumAutocomplete idPrefix="correction" artistId={prefilledArtistId} value={editAlbum} onChange={setEditAlbum} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input className="search-input" style={{ flex: 1 }} type="number" id="correction-track-number" name="track-number" aria-label="Track number" placeholder="Track #"
                value={editTrackNumber} onChange={(e) => setEditTrackNumber(e.target.value)} />
              <DateDropdownPicker idPrefix="correction-release-date" value={editReleaseDate} onChange={setEditReleaseDate} />
            </div>
            <input className="search-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Producers"
              value={editProducers} onChange={(e) => setEditProducers(e.target.value)} />
            <div className="detail-meta" style={{ marginBottom: 6 }}>Featured artists</div>
            {featuredTagPicker(editFeaturedTags, setEditFeaturedTags, editFeaturedSearch, setEditFeaturedSearch, editFeaturedResults)}
            <input className="search-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Genre"
              value={editGenre} onChange={(e) => setEditGenre(e.target.value)} />
            <textarea className="comment-textarea" style={{ marginBottom: 12 }} placeholder="Notes"
              value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
          </>
        )}

        {type === "flag_link" && (
          <>
            <div className="detail-meta" style={{ marginBottom: 10 }}>
              Flagging the link on <b style={{ color: "var(--bone)" }}>{prefilledTrackTitle}</b>.
              Current link: <span style={{ wordBreak: "break-all" }}>{currentUrl}</span>
            </div>
            <textarea
              className="comment-textarea"
              placeholder="What's wrong with it? (optional)"
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <div className="detail-meta" style={{ marginBottom: 6 }}>
              Know the correct link? Paste it below — feel free to switch tabs to go find it first,
              this page will still be here when you get back.
            </div>
            <input
              className="search-input"
              placeholder="Correct link (optional)"
              value={flagReplacement}
              onChange={(e) => setFlagReplacement(e.target.value)}
              style={{ marginBottom: 12 }}
            />
          </>
        )}

        {type === "flag_deletion" && (
          <>
            <div className="detail-meta" style={{ marginBottom: 10 }}>
              Flagging <b style={{ color: "var(--bone)" }}>{prefilledTrackTitle}</b> for removal.
              If approved, this deletes it entirely — permanent, so be specific about why.
            </div>
            <textarea
              className="comment-textarea"
              placeholder="Why should this be removed? e.g. duplicate of another entry, doesn't belong to this artist, doesn't exist"
              value={deletionReason}
              onChange={(e) => setDeletionReason(e.target.value)}
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
