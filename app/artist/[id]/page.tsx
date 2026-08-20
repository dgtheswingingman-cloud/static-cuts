"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin } from "../../useIsAdmin";
import TrackComments from "./TrackComments";
import ArtistChangelog from "./ArtistChangelog";

type Track = {
  id: string;
  title: string;
  spotify_url: string | null;
  parent_track_id: string | null;
  is_featured: boolean;
  is_official: boolean;
  aliases: string | null;
  // Heavy fields -- undefined until this track's letter group (or search
  // result) has actually been loaded on demand.
  track_type?: string;
  has_audio?: boolean;
  track_number?: number | null;
  release_date?: string | null;
  producers?: string | null;
  featured_artists?: string | null;
  genre?: string | null;
  notes?: string | null;
  // Client-only, not from DB: set when this track is shown here via a
  // cross-artist appearance rather than being native to this artist.
  isCrossAppearance?: boolean;
  homeArtistId?: string;
  homeArtistName?: string;
};
type Artist = { id: string; name: string; status: string | null };
type RoleFilter = "all" | "main" | "featured";
type ReleaseFilter = "all" | "official" | "unreleased";
type CollectedFilter = "all" | "collected" | "uncollected";

function trackPasses(
  t: Track,
  owned: Set<string>,
  role: RoleFilter,
  release: ReleaseFilter,
  collected: CollectedFilter
) {
  if (role === "main" && t.is_featured) return false;
  if (role === "featured" && !t.is_featured) return false;
  if (release === "official" && !t.is_official) return false;
  if (release === "unreleased" && t.is_official) return false;
  if (collected === "collected" && !owned.has(t.id)) return false;
  if (collected === "uncollected" && owned.has(t.id)) return false;
  return true;
}

function letterOf(title: string) {
  return /[A-Za-z]/.test(title[0]) ? title[0].toUpperCase() : "#";
}

export default function ArtistPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { user, loading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();

  const [artist, setArtist] = useState<Artist | null>(null);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [releaseFilter, setReleaseFilter] = useState<ReleaseFilter>("all");
  const [collectedFilter, setCollectedFilter] = useState<CollectedFilter>("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [myRatings, setMyRatings] = useState<Record<string, number>>({});
  const [avgRatings, setAvgRatings] = useState<Record<string, { avg: number; count: number }>>({});
  const [openRatingId, setOpenRatingId] = useState<string | null>(null);
  const [openCommentsId, setOpenCommentsId] = useState<string | null>(null);
  const [openInfoId, setOpenInfoId] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [openLetters, setOpenLetters] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    title: string; spotify_url: string; is_featured: boolean; is_official: boolean; has_audio: boolean; parent_track_id: string;
    aliases: string; track_number: string; release_date: string; producers: string; featured_artists: string; genre: string; notes: string;
  } | null>(null);
  const [parentSearch, setParentSearch] = useState("");
  const [parentSuggestionsOpen, setParentSuggestionsOpen] = useState(false);
  const [addingTrack, setAddingTrack] = useState(false);
  const [addingFeature, setAddingFeature] = useState(false);
  const [featureSearch, setFeatureSearch] = useState("");
  const [featureResults, setFeatureResults] = useState<{ id: string; title: string; artist_id: string; artist_name: string }[]>([]);
  const [newTrack, setNewTrack] = useState({ title: "", spotify_url: "", is_featured: false, is_official: false, has_audio: true, parent_track_id: "" });
  const [newTrackParentSearch, setNewTrackParentSearch] = useState("");
  const [newTrackParentOpen, setNewTrackParentOpen] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [candidatesByTrack, setCandidatesByTrack] = useState<Record<string, { id: string; url: string; title: string | null; source_domain: string | null }[]>>({});
  const [openCandidatesId, setOpenCandidatesId] = useState<string | null>(null);
  const [trackSearchQuery, setTrackSearchQuery] = useState("");
  const [suggestedIds, setSuggestedIds] = useState<Set<string>>(new Set());
  const [candidateScores, setCandidateScores] = useState<Record<string, number>>({});
  const [myCandidateVotes, setMyCandidateVotes] = useState<Record<string, 1 | -1>>({});
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [loadedDetailIds, setLoadedDetailIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function load() {
    try {
      const { data: artistRow, error: artistErr } = await supabase
        .from("artists")
        .select("id, name, status")
        .eq("id", id)
        .single();
      if (artistErr) throw artistErr;
      setArtist(artistRow);

      const PAGE_SIZE = 1000;
      let all: Track[] = [];
      let from = 0;
      while (true) {
        const { data: page, error: trackErr } = await supabase
          .from("tracks")
          .select("id, title, spotify_url, parent_track_id, is_featured, is_official, aliases")
          .eq("artist_id", id)
          .range(from, from + PAGE_SIZE - 1);
        if (trackErr) throw trackErr;
        all = all.concat(page ?? []);
        if (!page || page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      // Cross-artist appearances: tracks whose "home" is a different
      // artist, but that have been linked to also show up here as a
      // feature. Same canonical track -- just tagged distinctly and
      // pointed back at its real home.
      const { data: appearances } = await supabase
        .from("track_appearances")
        .select("track_id")
        .eq("artist_id", id);
      const appearanceTrackIds = (appearances ?? []).map((a) => a.track_id);
      if (appearanceTrackIds.length > 0) {
        const { data: crossTracks } = await supabase
          .from("tracks")
          .select("id, title, spotify_url, parent_track_id, is_featured, is_official, aliases, artist_id")
          .in("id", appearanceTrackIds);
        const homeArtistIds = Array.from(new Set((crossTracks ?? []).map((t: any) => t.artist_id)));
        const { data: homeArtists } = await supabase.from("artists").select("id, name").in("id", homeArtistIds);
        const homeNameMap: Record<string, string> = {};
        (homeArtists ?? []).forEach((a: any) => { homeNameMap[a.id] = a.name; });

        (crossTracks ?? []).forEach((t: any) => {
          all.push({
            ...t,
            is_featured: true, // always shows as featured on a page that isn't its home
            isCrossAppearance: true,
            homeArtistId: t.artist_id,
            homeArtistName: homeNameMap[t.artist_id] ?? "unknown artist",
          });
        });
      }

      all.sort((a, b) => a.title.localeCompare(b.title));
      setTracks(all);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  useEffect(() => {
    async function loadOwned() {
      if (!user || !tracks) { setOwned(new Set()); return; }
      const trackIds = tracks.map((t) => t.id);
      if (trackIds.length === 0) return;
      const { data, error: ownedErr } = await supabase
        .from("track_ownership")
        .select("track_id")
        .eq("user_id", user.id)
        .in("track_id", trackIds);
      if (ownedErr) { console.error(ownedErr); return; }
      setOwned(new Set((data ?? []).map((r) => r.track_id)));
    }
    loadOwned();
  }, [user, tracks]);

  useEffect(() => {
    async function loadAvgRatings() {
      const { data, error: avgErr } = await supabase
        .from("track_rating_stats")
        .select("track_id, avg_rating, rating_count")
        .eq("artist_id", id);
      if (avgErr) { console.error(avgErr); return; }
      const map: Record<string, { avg: number; count: number }> = {};
      (data ?? []).forEach((r: any) => { map[r.track_id] = { avg: Number(r.avg_rating), count: r.rating_count }; });
      setAvgRatings(map);
    }
    loadAvgRatings();
  }, [id]);

  useEffect(() => {
    async function loadMyRatings() {
      if (!user || !tracks) { setMyRatings({}); return; }
      const trackIds = tracks.map((t) => t.id);
      if (trackIds.length === 0) return;
      const { data, error: ratingErr } = await supabase
        .from("ratings")
        .select("track_id, value")
        .eq("user_id", user.id)
        .in("track_id", trackIds);
      if (ratingErr) { console.error(ratingErr); return; }
      const map: Record<string, number> = {};
      (data ?? []).forEach((r) => { map[r.track_id] = r.value; });
      setMyRatings(map);
    }
    loadMyRatings();
  }, [user, tracks]);

  async function setRating(trackId: string, value: number) {
    if (!user) { router.push("/login"); return; }
    const { error: rateErr } = await supabase
      .from("ratings")
      .upsert({ user_id: user.id, track_id: trackId, value, updated_at: new Date().toISOString() });
    if (rateErr) { console.error(rateErr); return; }
    setMyRatings((prev) => ({ ...prev, [trackId]: value }));
    const { data } = await supabase
      .from("track_rating_stats")
      .select("avg_rating, rating_count")
      .eq("track_id", trackId)
      .maybeSingle();
    if (data) {
      setAvgRatings((prev) => ({ ...prev, [trackId]: { avg: Number(data.avg_rating), count: data.rating_count } }));
    }
    setOpenRatingId(null);
  }

  async function clearRating(trackId: string) {
    if (!user) return;
    const { error: delErr } = await supabase.from("ratings").delete().eq("user_id", user.id).eq("track_id", trackId);
    if (delErr) { console.error(delErr); return; }
    setMyRatings((prev) => { const n = { ...prev }; delete n[trackId]; return n; });
    setOpenRatingId(null);
  }

  useEffect(() => {
    async function loadFollow() {
      if (!user) { setIsFollowing(false); return; }
      const { data } = await supabase
        .from("follows")
        .select("artist_id")
        .eq("user_id", user.id)
        .eq("artist_id", id)
        .maybeSingle();
      setIsFollowing(!!data);
    }
    loadFollow();
  }, [user, id]);

  function pickRandomDeepCut() {
    const pool = mainTracks.filter((t) => !user || !owned.has(t.id));
    if (pool.length === 0) {
      alert(user ? "You've collected every track from this artist — nothing left to surprise you." : "No tracks found.");
      return;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const letter = letterOf(pick.title);
    setOpenLetters((prev) => new Set(prev).add(letter));
    ensureLetterLoaded(letter);
    setHighlightedId(pick.id);
    setTimeout(() => {
      document.getElementById(`track-${pick.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    setTimeout(() => setHighlightedId(null), 3500);
  }

  async function toggleFollow() {
    if (!user) { router.push("/login"); return; }
    setFollowBusy(true);
    if (isFollowing) {
      await supabase.from("follows").delete().eq("user_id", user.id).eq("artist_id", id);
      setIsFollowing(false);
    } else {
      await supabase.from("follows").insert({ user_id: user.id, artist_id: id });
      setIsFollowing(true);
    }
    setFollowBusy(false);
  }

  async function toggleOwned(trackId: string) {
    if (!user) { router.push("/login"); return; }
    setTogglingId(trackId);
    const isOwned = owned.has(trackId);
    try {
      if (isOwned) {
        const { error: delErr } = await supabase.from("track_ownership").delete().eq("user_id", user.id).eq("track_id", trackId);
        if (delErr) throw delErr;
        setOwned((prev) => { const n = new Set(prev); n.delete(trackId); return n; });
      } else {
        const { error: insErr } = await supabase.from("track_ownership").insert({ user_id: user.id, track_id: trackId });
        if (insErr) throw insErr;
        setOwned((prev) => new Set(prev).add(trackId));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setTogglingId(null);
    }
  }

  // Fetches the heavy per-track data (verbose info fields + possible-match
  // candidates) for a given set of track IDs, but only for ones we haven't
  // already loaded -- called when a letter group expands, a search result
  // includes new tracks, or Random Deep Cut jumps to one. This is what
  // keeps a 3,796-track artist page fast: the initial load only fetches
  // lightweight fields for everything, and this fills in the rest just for
  // what's actually being looked at.
  async function ensureTracksLoaded(trackIds: string[]) {
    const idsToLoad = trackIds.filter((tid) => !loadedDetailIds.has(tid));
    if (idsToLoad.length === 0) return;

    const [detailsRes, candidatesRes] = await Promise.all([
      supabase
        .from("tracks")
        .select("id, track_type, has_audio, track_number, release_date, producers, featured_artists, genre, notes")
        .in("id", idsToLoad),
      supabase
        .from("track_link_candidates")
        .select("id, track_id, url, title, source_domain")
        .in("track_id", idsToLoad),
    ]);

    if (detailsRes.data) {
      const detailMap: Record<string, any> = {};
      detailsRes.data.forEach((d: any) => { detailMap[d.id] = d; });
      setTracks((prev) =>
        prev
          ? prev.map((t) => (detailMap[t.id] ? { ...t, ...detailMap[t.id] } : t))
          : prev
      );
    }

    if (candidatesRes.data && candidatesRes.data.length > 0) {
      const map: Record<string, { id: string; url: string; title: string | null; source_domain: string | null }[]> = {};
      candidatesRes.data.forEach((c: any) => {
        (map[c.track_id] = map[c.track_id] || []).push(c);
      });
      setCandidatesByTrack((prev) => ({ ...prev, ...map }));

      const candidateIds = candidatesRes.data.map((c: any) => c.id);
      const { data: votes } = await supabase
        .from("track_link_candidate_votes")
        .select("candidate_id, user_id, vote")
        .in("candidate_id", candidateIds);
      const scores: Record<string, number> = {};
      const mine: Record<string, 1 | -1> = {};
      (votes ?? []).forEach((v: any) => {
        scores[v.candidate_id] = (scores[v.candidate_id] ?? 0) + v.vote;
        if (user && v.user_id === user.id) mine[v.candidate_id] = v.vote;
      });
      setCandidateScores((prev) => ({ ...prev, ...scores }));
      setMyCandidateVotes((prev) => ({ ...prev, ...mine }));
    }

    setLoadedDetailIds((prev) => {
      const next = new Set(prev);
      idsToLoad.forEach((tid) => next.add(tid));
      return next;
    });
  }

  // Convenience wrapper: load everything (main track + its sub-entries)
  // belonging to one letter group.
  function ensureLetterLoaded(letter: string) {
    const group = letterGroups[letter] ?? [];
    const ids = group.flatMap((t) => [t.id, ...(subsByParent[t.id] ?? []).map((s) => s.id)]);
    ensureTracksLoaded(ids);
  }

  async function voteOnCandidate(candidateId: string, value: 1 | -1) {
    if (!user) { router.push("/login"); return; }
    const current = myCandidateVotes[candidateId];
    if (current === value) {
      // Clicking the same direction again removes the vote.
      await supabase.from("track_link_candidate_votes").delete().eq("candidate_id", candidateId).eq("user_id", user.id);
      setMyCandidateVotes((prev) => { const n = { ...prev }; delete n[candidateId]; return n; });
      setCandidateScores((prev) => ({ ...prev, [candidateId]: (prev[candidateId] ?? 0) - value }));
    } else {
      await supabase.from("track_link_candidate_votes").upsert({ candidate_id: candidateId, user_id: user.id, vote: value });
      const delta = value - (current ?? 0);
      setMyCandidateVotes((prev) => ({ ...prev, [candidateId]: value }));
      setCandidateScores((prev) => ({ ...prev, [candidateId]: (prev[candidateId] ?? 0) + delta }));
    }
  }

  async function suggestCandidate(track: Track, candidateUrl: string) {
    if (!user) { router.push("/login"); return; }
    const { error: err } = await supabase.from("submissions").insert({
      type: "correction",
      artist_id: id,
      submitted_by: user.id,
      payload: { track_id: track.id, new_spotify_url: candidateUrl },
    });
    if (err) { alert(err.message); return; }
    setSuggestedIds((prev) => new Set(prev).add(track.id + candidateUrl));
  }

  // Global track search (across every artist, not just this one) -- used
  // to find an existing track and link it here as a cross-artist feature.
  useEffect(() => {
    const q = featureSearch.trim();
    if (q.length < 2) { setFeatureResults([]); return; }
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from("tracks")
        .select("id, title, artist_id, artists(name)")
        .ilike("title", `%${q}%`)
        .neq("artist_id", id)
        .limit(8);
      setFeatureResults(
        (data ?? []).map((t: any) => ({ id: t.id, title: t.title, artist_id: t.artist_id, artist_name: t.artists?.name ?? "unknown artist" }))
      );
    }, 300);
    return () => clearTimeout(handle);
  }, [featureSearch, id]);

  async function linkFeature(trackId: string) {
    setAdminBusy(true);
    const { error: err } = await supabase.rpc("admin_add_track_appearance", { p_track_id: trackId, p_artist_id: id });
    setAdminBusy(false);
    if (err) { alert(err.message); return; }
    setAddingFeature(false);
    setFeatureSearch("");
    setFeatureResults([]);
    load();
  }

  async function unlinkFeature(trackId: string) {
    if (!window.confirm("Remove this track from this artist's page? (The track itself won't be deleted, just this cross-reference.)")) return;
    setAdminBusy(true);
    const { error: err } = await supabase.rpc("admin_remove_track_appearance", { p_track_id: trackId, p_artist_id: id });
    setAdminBusy(false);
    if (err) { alert(err.message); return; }
    load();
  }

  async function addTrack() {
    if (!newTrack.title.trim()) { alert("Enter a title."); return; }
    setAdminBusy(true);
    const { error: err } = await supabase.rpc("admin_add_track", {
      p_artist_id: id,
      p_title: newTrack.title.trim(),
      p_spotify_url: newTrack.spotify_url,
      p_is_featured: newTrack.is_featured,
      p_is_official: newTrack.is_official,
      p_has_audio: newTrack.has_audio,
      p_parent_track_id: newTrack.parent_track_id,
    });
    setAdminBusy(false);
    if (err) { alert(err.message); return; }
    setAddingTrack(false);
    setNewTrack({ title: "", spotify_url: "", is_featured: false, is_official: false, has_audio: true, parent_track_id: "" });
    setNewTrackParentSearch("");
    load();
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
  }

  function buildInfoLines(t: Track): [string, string][] {
    const lines: [string, string][] = [["Track Name", t.title]];
    if (t.aliases) lines.push(["Aliases", t.aliases]);
    if (artist) lines.push(["Artist", artist.name]);
    if (t.track_number) lines.push(["Track Number", String(t.track_number)]);
    if (t.release_date) lines.push(["Release Date", t.release_date]);
    if (t.producers) lines.push(["Producers", t.producers]);
    if (t.featured_artists) lines.push(["Featured Artists", t.featured_artists]);
    if (t.genre) lines.push(["Genre", t.genre]);
    if (t.notes) lines.push(["Notes", t.notes]);
    return lines;
  }

  function copyAllInfo(t: Track) {
    const text = buildInfoLines(t).map(([label, value]) => `${label}: ${value}`).join("\n");
    copyText(text);
  }

  async function flagLink(track: Track) {
    if (!user) { router.push("/login"); return; }
    const reason = window.prompt("What's wrong with this link? (optional)") ?? "";
    const { error: err } = await supabase.from("submissions").insert({
      type: "flag_link",
      artist_id: id,
      submitted_by: user.id,
      payload: { track_id: track.id, reason },
    });
    if (err) { alert(err.message); return; }
    alert("Thanks — flagged for review.");
  }

  function startEdit(t: Track) {
    setEditingId(t.id);
    setEditDraft({
      title: t.title,
      spotify_url: t.spotify_url ?? "",
      is_featured: t.is_featured,
      is_official: t.is_official,
      has_audio: t.has_audio ?? true,
      parent_track_id: t.parent_track_id ?? "",
      aliases: t.aliases ?? "",
      track_number: t.track_number?.toString() ?? "",
      release_date: t.release_date ?? "",
      producers: t.producers ?? "",
      featured_artists: t.featured_artists ?? "",
      genre: t.genre ?? "",
      notes: t.notes ?? "",
    });
    const currentParent = t.parent_track_id ? mainTracks.find((mt) => mt.id === t.parent_track_id) : null;
    setParentSearch(currentParent?.title ?? "");
    setParentSuggestionsOpen(false);
  }

  async function saveEdit(trackId: string) {
    if (!editDraft) return;
    setAdminBusy(true);
    const { error: err } = await supabase.rpc("admin_update_track", {
      p_track_id: trackId,
      p_title: editDraft.title,
      p_spotify_url: editDraft.spotify_url,
      p_is_featured: editDraft.is_featured,
      p_is_official: editDraft.is_official,
      p_has_audio: editDraft.has_audio,
      p_parent_track_id: editDraft.parent_track_id,
      p_aliases: editDraft.aliases,
      p_track_number: editDraft.track_number ? parseInt(editDraft.track_number, 10) : null,
      p_release_date: editDraft.release_date || null,
      p_producers: editDraft.producers,
      p_featured_artists: editDraft.featured_artists,
      p_genre: editDraft.genre,
      p_notes: editDraft.notes,
    });
    setAdminBusy(false);
    if (err) { alert(err.message); return; }
    setEditingId(null);
    setEditDraft(null);
    load();
  }

  async function deleteTrack(t: Track, hasSubs: boolean) {
    const warning = hasSubs
      ? `Delete "${t.title}"? Its alternate versions will be deleted too.`
      : `Delete "${t.title}"?`;
    if (!window.confirm(warning)) return;
    setAdminBusy(true);
    const { error: err } = await supabase.rpc("admin_delete_track", { p_track_id: t.id });
    setAdminBusy(false);
    if (err) { alert(err.message); return; }
    load();
  }

  const mainTracks = tracks?.filter((t) => !t.parent_track_id) ?? [];
  const subsByParent: Record<string, Track[]> = {};
  (tracks ?? []).forEach((t) => {
    if (t.parent_track_id) (subsByParent[t.parent_track_id] = subsByParent[t.parent_track_id] || []).push(t);
  });

  const filteredMain = (() => {
    const list = mainTracks.filter((t) => trackPasses(t, owned, roleFilter, releaseFilter, collectedFilter));
    return [...list].sort((a, b) => a.title.localeCompare(b.title));
  })();

  const letterGroups: Record<string, Track[]> = {};
  filteredMain.forEach((t) => {
    const letter = letterOf(t.title);
    (letterGroups[letter] = letterGroups[letter] || []).push(t);
  });
  const sortedLetters = Object.keys(letterGroups).sort();

  // When actively searching within this artist, show a flat, alphabetized
  // list across main tracks AND sub-entries (matching title or aliases)
  // instead of the letter-grouped view.
  const trackSearchResults = (() => {
    const q = trackSearchQuery.trim().toLowerCase();
    if (!q || !tracks) return null;
    return tracks
      .filter((t) => trackPasses(t, owned, roleFilter, releaseFilter, collectedFilter))
      .filter((t) => t.title.toLowerCase().includes(q) || (t.aliases ?? "").toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title));
  })();

  const confirmedCount = tracks?.filter((t) => t.spotify_url).length ?? 0;
  const collectedCount = tracks?.filter((t) => owned.has(t.id)).length ?? 0;
  const collectedPct = tracks && tracks.length > 0 ? Math.round((collectedCount / tracks.length) * 100) : 0;

  // Search results can span multiple (unexpanded) letter groups at once --
  // load their details directly rather than requiring the group to open.
  useEffect(() => {
    if (!trackSearchResults || trackSearchResults.length === 0) return;
    ensureTracksLoaded(trackSearchResults.map((t) => t.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackSearchQuery, tracks]);

  // Jump-to-track support: /artist/[id]?highlight=trackId auto-expands
  // that track's letter group and scrolls it into view -- used by the
  // review queue's "view track" links.
  useEffect(() => {
    if (!tracks) return;
    const params = new URLSearchParams(window.location.search);
    const highlight = params.get("highlight");
    if (!highlight) return;

    const target = tracks.find((t) => t.id === highlight);
    if (!target) return;

    const anchorTitle = target.parent_track_id
      ? tracks.find((t) => t.id === target.parent_track_id)?.title ?? target.title
      : target.title;
    const letter = letterOf(anchorTitle);

    setOpenLetters((prev) => new Set(prev).add(letter));
    ensureLetterLoaded(letter);
    setHighlightedId(highlight);

    setTimeout(() => {
      document.getElementById(`track-${highlight}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    setTimeout(() => setHighlightedId(null), 3500);
  }, [tracks]);

  function toggleLetter(letter: string) {
    setOpenLetters((prev) => {
      const n = new Set(prev);
      if (n.has(letter)) {
        n.delete(letter);
      } else {
        n.add(letter);
        ensureLetterLoaded(letter);
      }
      return n;
    });
  }

  function trackRow(t: Track, isSub: boolean) {
    const isOwned = owned.has(t.id);
    const isToggling = togglingId === t.id;
    const myRating = myRatings[t.id];
    const hasRated = myRating !== undefined;
    const avg = avgRatings[t.id];
    const chipLabel = hasRated ? `your rating: ${myRating}/10` : "rate";
    const isRatingOpen = openRatingId === t.id;
    const isEditing = editingId === t.id;
    const subs = subsByParent[t.id] ?? [];

    if (isEditing && editDraft) {
      return (
        <div key={t.id} id={`track-${t.id}`} style={{ marginLeft: isSub ? 30 : 0 }} className="comments-panel">
          <input className="search-input" style={{ marginBottom: 8 }} value={editDraft.title}
            onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })} placeholder="title" />
          <input className="search-input" style={{ marginBottom: 8 }} value={editDraft.spotify_url}
            onChange={(e) => setEditDraft({ ...editDraft, spotify_url: e.target.value })} placeholder="spotify url (optional)" />
          <div style={{ display: "flex", gap: 14, marginBottom: 10 }}>
            <label style={{ fontSize: "0.8rem", color: "var(--smoke)" }}>
              <input type="checkbox" checked={editDraft.is_featured} onChange={(e) => setEditDraft({ ...editDraft, is_featured: e.target.checked })} /> featured
            </label>
            <label style={{ fontSize: "0.8rem", color: "var(--smoke)" }}>
              <input type="checkbox" checked={editDraft.is_official} onChange={(e) => setEditDraft({ ...editDraft, is_official: e.target.checked })} /> official
            </label>
          </div>
          <div className="comments-count" style={{ marginBottom: 6 }}>Make this a sub-version of:</div>
          <div style={{ position: "relative" }}>
            <input
              className="search-input"
              style={{ width: "100%", marginBottom: 4 }}
              placeholder="Type to search main tracks…"
              value={parentSearch}
              onChange={(e) => { setParentSearch(e.target.value); setParentSuggestionsOpen(true); if (!e.target.value) setEditDraft({ ...editDraft, parent_track_id: "" }); }}
              onFocus={() => setParentSuggestionsOpen(true)}
            />
            {parentSuggestionsOpen && parentSearch.trim().length > 0 && (
              <div className="comments-panel" style={{ position: "absolute", zIndex: 5, width: "100%", maxHeight: 220, overflowY: "auto", padding: "6px 4px" }}>
                {mainTracks
                  .filter((mt) => mt.id !== t.id && mt.title.toLowerCase().includes(parentSearch.trim().toLowerCase()))
                  .slice(0, 8)
                  .map((mt) => (
                    <div
                      key={mt.id}
                      className="comment-item"
                      style={{ cursor: "pointer", padding: "8px 6px" }}
                      onClick={() => {
                        setEditDraft({ ...editDraft, parent_track_id: mt.id });
                        setParentSearch(mt.title);
                        setParentSuggestionsOpen(false);
                      }}
                    >
                      <span className="comment-body" style={{ fontSize: "0.82rem" }}>{mt.title}</span>
                    </div>
                  ))}
                {mainTracks.filter((mt) => mt.id !== t.id && mt.title.toLowerCase().includes(parentSearch.trim().toLowerCase())).length === 0 && (
                  <div className="comments-count">No matches.</div>
                )}
              </div>
            )}
          </div>
          <div className="comments-count" style={{ marginBottom: 10, marginTop: 4 }}>
            {editDraft.parent_track_id ? "Will become a sub-version." : "Clear the box to keep it a main track."}
          </div>

          <div className="comments-count" style={{ marginBottom: 6, marginTop: 8 }}>Verbose info (optional)</div>
          <input className="search-input" style={{ width: "100%", marginBottom: 6 }} placeholder="Aliases (comma separated)"
            value={editDraft.aliases} onChange={(e) => setEditDraft({ ...editDraft, aliases: e.target.value })} />
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <input className="search-input" style={{ flex: 1 }} type="number" placeholder="Track #"
              value={editDraft.track_number} onChange={(e) => setEditDraft({ ...editDraft, track_number: e.target.value })} />
            <input className="search-input" style={{ flex: 2 }} type="date" placeholder="Release date"
              value={editDraft.release_date} onChange={(e) => setEditDraft({ ...editDraft, release_date: e.target.value })} />
          </div>
          <input className="search-input" style={{ width: "100%", marginBottom: 6 }} placeholder="Producers"
            value={editDraft.producers} onChange={(e) => setEditDraft({ ...editDraft, producers: e.target.value })} />
          <input className="search-input" style={{ width: "100%", marginBottom: 6 }} placeholder="Featured artists"
            value={editDraft.featured_artists} onChange={(e) => setEditDraft({ ...editDraft, featured_artists: e.target.value })} />
          <input className="search-input" style={{ width: "100%", marginBottom: 6 }} placeholder="Genre"
            value={editDraft.genre} onChange={(e) => setEditDraft({ ...editDraft, genre: e.target.value })} />
          <textarea className="comment-textarea" style={{ marginBottom: 10 }} placeholder="Notes"
            value={editDraft.notes} onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })} />

          <button className="comment-post-btn" disabled={adminBusy} onClick={() => saveEdit(t.id)}>save</button>{" "}
          <button className="rating-clear" onClick={() => { setEditingId(null); setEditDraft(null); }}>cancel</button>
        </div>
      );
    }

    return (
      <div
        key={t.id}
        id={`track-${t.id}`}
        style={{
          marginLeft: isSub ? 30 : 0,
          background: highlightedId === t.id ? "rgba(255,255,255,0.08)" : "transparent",
          transition: "background 1.2s ease",
        }}
      >
        <div className="track-row" onClick={() => toggleOwned(t.id)} style={{ opacity: isToggling ? 0.5 : 1 }}>
          <div className={`sigil ${isOwned ? "owned" : ""}`}>{isOwned ? "✓" : ""}</div>
          <span className={`track-title ${isOwned ? "owned" : ""}`}>{t.title}</span>
          {t.is_featured && <span className="feature-tag">featured</span>}
          {t.is_official ? <span className="feature-tag">official</span> : <span className="feature-tag">unreleased</span>}
          <button className={`rating-chip ${hasRated ? "rated" : ""}`} onClick={(e) => { e.stopPropagation(); setOpenRatingId(isRatingOpen ? null : t.id); }}>
            {chipLabel}
          </button>
          <button className="rating-chip" onClick={(e) => { e.stopPropagation(); setOpenCommentsId(openCommentsId === t.id ? null : t.id); }}>
            comments
          </button>
          <button className="rating-chip" onClick={(e) => { e.stopPropagation(); setOpenInfoId(openInfoId === t.id ? null : t.id); }}>
            info
          </button>
          {!isSub && (
            <a
              href={`/submit?type=new_version&artist_id=${id}&parent_track_id=${t.id}&parent_title=${encodeURIComponent(t.title)}`}
              className="listen-link"
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: "0.68rem" }}
            >
              + alt version
            </a>
          )}
          {user && !isAdmin && (
            <a
              href={`/submit?type=correction&artist_id=${id}&track_id=${t.id}&track_title=${encodeURIComponent(t.title)}&current_url=${encodeURIComponent(t.spotify_url ?? "")}&current_featured=${t.is_featured}&current_official=${t.is_official}&current_parent_id=${t.parent_track_id ?? ""}&current_parent_title=${encodeURIComponent(t.parent_track_id ? (mainTracks.find((mt) => mt.id === t.parent_track_id)?.title ?? "") : "")}&current_aliases=${encodeURIComponent(t.aliases ?? "")}&current_track_number=${t.track_number ?? ""}&current_release_date=${t.release_date ?? ""}&current_producers=${encodeURIComponent(t.producers ?? "")}&current_featured_artists=${encodeURIComponent(t.featured_artists ?? "")}&current_genre=${encodeURIComponent(t.genre ?? "")}&current_notes=${encodeURIComponent(t.notes ?? "")}`}
              className="listen-link"
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: "0.68rem" }}
            >
              suggest edit
            </a>
          )}
          {!t.spotify_url && (candidatesByTrack[t.id]?.length ?? 0) > 0 && (
            <button
              className="rating-chip"
              onClick={(e) => { e.stopPropagation(); setOpenCandidatesId(openCandidatesId === t.id ? null : t.id); }}
            >
              possible matches ({candidatesByTrack[t.id].length})
            </button>
          )}
          {isAdmin && !t.isCrossAppearance && (
            <>
              <button className="listen-link" onClick={(e) => { e.stopPropagation(); startEdit(t); }}>edit</button>
              <button className="listen-link" onClick={(e) => { e.stopPropagation(); deleteTrack(t, subs.length > 0); }}>delete</button>
            </>
          )}
          {t.isCrossAppearance && (
            <>
              <Link
                href={`/artist/${t.homeArtistId}`}
                className="feature-tag"
                style={{ textDecoration: "none" }}
                onClick={(e) => e.stopPropagation()}
              >
                featured via {t.homeArtistName}
              </Link>
              {isAdmin && (
                <button className="listen-link" onClick={(e) => { e.stopPropagation(); unlinkFeature(t.id); }}>
                  remove from this page
                </button>
              )}
            </>
          )}
          {t.spotify_url && (
            <>
              <a className="listen-link" href={t.spotify_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>listen</a>
              {user && (
                <button className="listen-link" onClick={(e) => { e.stopPropagation(); flagLink(t); }}>
                  flag link
                </button>
              )}
            </>
          )}
        </div>
        {isRatingOpen && (
          <div className="rating-popover" onClick={(e) => e.stopPropagation()}>
            <div className="rp-label">
              {hasRated ? (avg ? `community avg: ${avg.avg}/10 (${avg.count} rating${avg.count === 1 ? "" : "s"})` : "no other ratings yet") : "rate to see the community average"}
            </div>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} className={`rating-num ${myRating === n ? "selected" : ""}`} onClick={() => setRating(t.id, n)}>{n}</button>
            ))}
            {hasRated && <button className="rating-clear" onClick={() => clearRating(t.id)}>clear rating</button>}
          </div>
        )}
        {openCommentsId === t.id && (
          <div onClick={(e) => e.stopPropagation()}><TrackComments trackId={t.id} /></div>
        )}
        {openInfoId === t.id && (
          <div className="comments-panel" onClick={(e) => e.stopPropagation()}>
            <div className="comments-header">
              <div className="comments-count">Track info</div>
              <button className="comment-action-btn" onClick={() => copyAllInfo(t)}>copy all</button>
            </div>
            {buildInfoLines(t).map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--hair)" }}>
                <div style={{ flex: 1 }}>
                  <div className="comment-meta" style={{ marginBottom: 2 }}>{label}</div>
                  <div className="comment-body" style={{ fontSize: "0.82rem" }}>{value}</div>
                </div>
                <button className="comment-action-btn" onClick={() => copyText(value)}>copy</button>
              </div>
            ))}
          </div>
        )}
        {openCandidatesId === t.id && (
          <div className="comments-panel" onClick={(e) => e.stopPropagation()}>
            <div className="comments-count" style={{ marginBottom: 8 }}>
              Unverified web search results — not confirmed links. Check one out, and if it&apos;s
              genuinely this track, suggest it below (goes through the normal review process).
            </div>
            {[...(candidatesByTrack[t.id] ?? [])]
              .sort((a, b) => (candidateScores[b.id] ?? 0) - (candidateScores[a.id] ?? 0))
              .map((c) => {
                const suggested = suggestedIds.has(t.id + c.url);
                const score = candidateScores[c.id] ?? 0;
                const myVote = myCandidateVotes[c.id];
                return (
                  <div key={c.id} className="comment-item">
                    <div className="comment-body" style={{ fontSize: "0.8rem" }}>{c.title ?? c.url}</div>
                    <div className="comment-meta">{c.source_domain}</div>
                    <div className="comment-actions">
                      <button
                        className={`comment-action-btn ${myVote === 1 ? "voted" : ""}`}
                        onClick={() => voteOnCandidate(c.id, 1)}
                      >
                        ▲
                      </button>
                      <span className="comment-meta" style={{ margin: 0 }}>{score}</span>
                      <button
                        className={`comment-action-btn ${myVote === -1 ? "voted" : ""}`}
                        onClick={() => voteOnCandidate(c.id, -1)}
                      >
                        ▼
                      </button>
                      <a className="comment-action-btn" href={c.url} target="_blank" rel="noopener noreferrer">view</a>
                      {suggested ? (
                        <span className="comment-action-btn voted">suggested ✓</span>
                      ) : (
                        <button className="comment-action-btn" onClick={() => suggestCandidate(t, c.url)}>
                          suggest as link
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="wrap">
      <Link href="/" style={{ textDecoration: "none", fontFamily: "var(--font-anton)", fontSize: "1.1rem", letterSpacing: "0.01em", color: "var(--bone)", display: "block", marginBottom: 14 }}>
        STATIC CUTS<span style={{ color: "var(--smoke)" }}>//</span>
      </Link>
      <button className="back-btn" onClick={() => router.push("/")}>← back to archive</button>

      {error && (
        <div className="empty-state" style={{ borderColor: "#a33", marginTop: 18 }}>
          Couldn&apos;t load this artist: <b>{error}</b>
        </div>
      )}

      {!error && artist && (
        <>
          <h1 className="detail-name">{artist.name}</h1>
          <button className={`tab ${isFollowing ? "active" : ""}`} style={{ marginBottom: 14 }} disabled={followBusy} onClick={toggleFollow}>
            {isFollowing ? "✓ following" : "+ follow"}
          </button>
          {!isAdmin && (
            <a href={`/submit?artist_id=${id}&artist_name=${encodeURIComponent(artist.name)}`} className="tab" style={{ marginBottom: 14, marginLeft: 8, textDecoration: "none", display: "inline-block" }}>
              + suggest a track
            </a>
          )}
          {isAdmin && (
            <button className="tab" style={{ marginBottom: 14, marginLeft: 8 }} onClick={() => setAddingTrack(!addingTrack)}>
              {addingTrack ? "cancel add track" : "+ add track"}
            </button>
          )}
          {isAdmin && (
            <button className="tab" style={{ marginBottom: 14, marginLeft: 8 }} onClick={() => setAddingFeature(!addingFeature)}>
              {addingFeature ? "cancel link feature" : "+ link featured track"}
            </button>
          )}
          {addingFeature && isAdmin && (
            <div className="comments-panel" style={{ maxWidth: 480, marginBottom: 20 }}>
              <div className="detail-meta" style={{ marginBottom: 8 }}>
                Search for a track that already exists under another artist, to link it here as a
                feature. Same track everywhere — same link, ratings, and comments.
              </div>
              <input
                className="search-input"
                style={{ width: "100%" }}
                placeholder="Search any track by title…"
                value={featureSearch}
                onChange={(e) => setFeatureSearch(e.target.value)}
              />
              {featureSearch.trim().length >= 2 && (
                <div style={{ marginTop: 8 }}>
                  {featureResults.map((r) => (
                    <div key={r.id} className="comment-item" style={{ cursor: "pointer", padding: "8px 6px" }} onClick={() => linkFeature(r.id)}>
                      <span className="comment-body" style={{ fontSize: "0.82rem" }}>{r.title}</span>
                      <div className="comment-meta">from {r.artist_name}</div>
                    </div>
                  ))}
                  {featureResults.length === 0 && <div className="comments-count">No matches.</div>}
                </div>
              )}
            </div>
          )}
          {addingTrack && isAdmin && (
            <div className="comments-panel" style={{ maxWidth: 480, marginBottom: 20 }}>
              <input className="search-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Title"
                value={newTrack.title} onChange={(e) => setNewTrack({ ...newTrack, title: e.target.value })} />
              <input className="search-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Listen link (optional)"
                value={newTrack.spotify_url} onChange={(e) => setNewTrack({ ...newTrack, spotify_url: e.target.value })} />
              <div style={{ display: "flex", gap: 14, marginBottom: 10 }}>
                <label style={{ fontSize: "0.8rem", color: "var(--smoke)" }}>
                  <input type="checkbox" checked={newTrack.is_featured} onChange={(e) => setNewTrack({ ...newTrack, is_featured: e.target.checked })} /> featured
                </label>
                <label style={{ fontSize: "0.8rem", color: "var(--smoke)" }}>
                  <input type="checkbox" checked={newTrack.is_official} onChange={(e) => setNewTrack({ ...newTrack, is_official: e.target.checked })} /> official
                </label>
              </div>
              <div className="comments-count" style={{ marginBottom: 6 }}>Sub-version of (optional):</div>
              <div style={{ position: "relative" }}>
                <input
                  className="search-input"
                  style={{ width: "100%" }}
                  placeholder="Type to search main tracks…"
                  value={newTrackParentSearch}
                  onChange={(e) => { setNewTrackParentSearch(e.target.value); setNewTrackParentOpen(true); if (!e.target.value) setNewTrack({ ...newTrack, parent_track_id: "" }); }}
                  onFocus={() => setNewTrackParentOpen(true)}
                />
                {newTrackParentOpen && newTrackParentSearch.trim().length > 0 && (
                  <div className="comments-panel" style={{ position: "absolute", zIndex: 5, width: "100%", maxHeight: 200, overflowY: "auto", padding: "6px 4px" }}>
                    {mainTracks
                      .filter((mt) => mt.title.toLowerCase().includes(newTrackParentSearch.trim().toLowerCase()))
                      .slice(0, 8)
                      .map((mt) => (
                        <div key={mt.id} className="comment-item" style={{ cursor: "pointer", padding: "8px 6px" }}
                          onClick={() => { setNewTrack({ ...newTrack, parent_track_id: mt.id }); setNewTrackParentSearch(mt.title); setNewTrackParentOpen(false); }}>
                          <span className="comment-body" style={{ fontSize: "0.82rem" }}>{mt.title}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
              <button className="comment-post-btn" disabled={adminBusy} onClick={addTrack} style={{ marginTop: 10 }}>
                {adminBusy ? "…" : "add track"}
              </button>
            </div>
          )}
          <div className="detail-meta">
            {tracks?.length ?? 0} tracks logged · {confirmedCount} confirmed on Spotify
            {user && ` · ${collectedCount} collected (${collectedPct}%)`}
          </div>
          {user && (
            <div className="bar-track" style={{ height: 4, marginBottom: 22 }}>
              <div className="bar-fill" style={{ width: `${collectedPct}%` }} />
            </div>
          )}

          {!authLoading && !user && (
            <div className="empty-state" style={{ marginBottom: 20 }}>
              <a href="/login" style={{ color: "var(--bone)" }}>Log in</a> to start tracking which of these you&apos;ve found.
            </div>
          )}

          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 20,
              background: "var(--void)",
              paddingTop: 10,
              paddingBottom: 4,
              marginLeft: -20,
              marginRight: -20,
              paddingLeft: 20,
              paddingRight: 20,
              borderBottom: "1px solid var(--hair)",
            }}
          >
            <input
              className="search-input"
              style={{ width: "100%", marginBottom: 10 }}
              placeholder="Search tracks on this page…"
              value={trackSearchQuery}
              onChange={(e) => setTrackSearchQuery(e.target.value)}
            />
            <div className="tabs">
              {(["all", "main", "featured"] as RoleFilter[]).map((f) => (
                <button key={f} className={`tab ${roleFilter === f ? "active" : ""}`} onClick={() => setRoleFilter(f)}>{f}</button>
              ))}
              <span style={{ width: 4 }} />
              {(["all", "official", "unreleased"] as ReleaseFilter[]).map((f) => (
                <button key={f} className={`tab ${releaseFilter === f ? "active" : ""}`} onClick={() => setReleaseFilter(f)}>{f}</button>
              ))}
              {user && (
                <>
                  <span style={{ width: 4 }} />
                  {(["all", "collected", "uncollected"] as CollectedFilter[]).map((f) => (
                    <button key={f} className={`tab ${collectedFilter === f ? "active" : ""}`} onClick={() => setCollectedFilter(f)}>{f}</button>
                  ))}
                </>
              )}
            </div>

            <div className="sort-row" style={{ marginBottom: 8 }}>
              <button className="sort-select" onClick={() => setOpenLetters(new Set(sortedLetters))}>expand all</button>
              <button className="sort-select" style={{ marginLeft: 6 }} onClick={() => setOpenLetters(new Set())}>collapse all</button>
            </div>
          </div>

          {!tracks && <div className="empty-state">loading tracklist…</div>}

          {tracks && trackSearchResults !== null && (
            <div>
              {trackSearchResults.map((t) => trackRow(t, !!t.parent_track_id))}
              {trackSearchResults.length === 0 && (
                <div className="empty-state">No tracks match &quot;{trackSearchQuery}&quot;.</div>
              )}
            </div>
          )}

          {tracks && trackSearchResults === null && (
            <div>
              {sortedLetters.map((letter) => {
                const isOpen = openLetters.has(letter);
                return (
                  <div key={letter}>
                    <div
                      className="section-label"
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                      onClick={() => toggleLetter(letter)}
                    >
                      <span>{letter} ({letterGroups[letter].length})</span>
                      <button className="tab" style={{ padding: "3px 10px", fontSize: "0.62rem" }}>{isOpen ? "hide" : "show"}</button>
                    </div>
                    {isOpen && letterGroups[letter].map((t) => (
                      <div key={t.id}>
                        {trackRow(t, false)}
                        {(subsByParent[t.id] ?? [])
                          .filter((s) => trackPasses(s, owned, roleFilter, releaseFilter, collectedFilter))
                          .map((s) => trackRow(s, true))}
                      </div>
                    ))}
                  </div>
                );
              })}
              {filteredMain.length === 0 && <div className="empty-state">Nothing here yet.</div>}
            </div>
          )}

          <div className="section-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Changelog</span>
            <Link href={`/artist/${id}/changelog`} className="tab" style={{ padding: "3px 10px", fontSize: "0.62rem", textDecoration: "none" }}>
              view all
            </Link>
          </div>
          <ArtistChangelog artistId={id} limit={10} />

          <div className="note">
            <b>Your collection now syncs</b> — click any track to mark it collected; it saves
            straight to your account and follows you across devices. Tracks are grouped
            alphabetically — click a letter to expand it. Alternate versions (demos, live takes,
            alt mixes) nest under their original track instead of appearing as separate entries.
          </div>

          <button
            onClick={pickRandomDeepCut}
            style={{
              position: "fixed",
              bottom: 24,
              right: 24,
              zIndex: 40,
              background: "var(--bone)",
              color: "var(--void)",
              border: "none",
              borderRadius: 999,
              padding: "14px 20px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.78rem",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
            }}
          >
            🎲 random deep cut
          </button>
        </>
      )}
    </div>
  );
}
