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
  album?: string | null;
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
    aliases: string; track_number: string; release_date: string; producers: string; featured_artists: string; genre: string; notes: string; album: string;
  } | null>(null);
  const [parentSearch, setParentSearch] = useState("");
  const [parentSuggestionsOpen, setParentSuggestionsOpen] = useState(false);
  const [addingTrack, setAddingTrack] = useState(false);
  const [newTrack, setNewTrack] = useState({
    title: "", spotify_url: "", is_featured: false, is_official: false, has_audio: true, parent_track_id: "", featured_artists_text: "",
    aliases: "", album: "", track_number: "", release_date: "", producers: "", genre: "", notes: "",
  });
  const [newTrackParentSearch, setNewTrackParentSearch] = useState("");
  const [newTrackParentOpen, setNewTrackParentOpen] = useState(false);
  const [newTrackMainArtistSearch, setNewTrackMainArtistSearch] = useState("");
  const [newTrackMainArtistResults, setNewTrackMainArtistResults] = useState<{ id: string; name: string }[]>([]);
  const [newTrackMainArtistId, setNewTrackMainArtistId] = useState("");
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

      // load() replaces the whole tracks array with light-only data (no
      // verbose fields) -- if any tracks already had their heavy details
      // loaded (an expanded letter, an edited track, etc), that data would
      // otherwise silently vanish until a full page reload. Re-fetch it
      // for exactly those tracks right after setting the fresh light data.
      // Forced, since loadedDetailIds can't be relied on here -- clearing
      // it and immediately reading it back in the same tick would still
      // see the old value, React state updates aren't synchronous.
      const previouslyLoaded = Array.from(loadedDetailIds);
      setTracks(all);
      if (previouslyLoaded.length > 0) {
        await ensureTracksLoaded(previouslyLoaded, true);
      }
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

  async function deleteArtist() {
    if (!artist) return;
    const typed = window.prompt(
      `This permanently deletes ${artist.name} and their entire catalog — every track, rating, comment, and cross-link. This cannot be undone.\n\nType the artist's name exactly to confirm:`
    );
    if (typed !== artist.name) {
      if (typed !== null) alert("Name didn't match — nothing was deleted.");
      return;
    }
    setAdminBusy(true);
    const { error: err } = await supabase.rpc("admin_delete_artist", { p_artist_id: id });
    setAdminBusy(false);
    if (err) { alert(err.message); return; }
    router.push("/");
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
  async function ensureTracksLoaded(trackIds: string[], force = false) {
    const idsToLoad = force ? trackIds : trackIds.filter((tid) => !loadedDetailIds.has(tid));
    if (idsToLoad.length === 0) return;

    const [detailsRes, candidatesRes] = await Promise.all([
      supabase
        .from("tracks")
        .select("id, track_type, has_audio, track_number, release_date, producers, featured_artists, genre, notes, album")
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

  // Per-track linking: search for the ARTIST to link this specific track
  // to (not another track -- the track is already chosen by which row you
  // clicked from). Before linking, checks whether the target artist
  // already has a same-titled track sitting there as an independent
  // duplicate (common given the original per-artist Notion import) and
  // offers to merge instead of creating a visible double-up.
  const [linkingTrackId, setLinkingTrackId] = useState<string | null>(null);
  const [linkTargetArtist, setLinkTargetArtist] = useState<{ id: string; name: string } | null>(null);
  const [artistSearch, setArtistSearch] = useState("");
  const [artistResults, setArtistResults] = useState<{ id: string; name: string }[]>([]);
  const [targetTrackSearch, setTargetTrackSearch] = useState("");
  const [targetTrackResults, setTargetTrackResults] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    const q = artistSearch.trim();
    if (q.length < 2) { setArtistResults([]); return; }
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from("artists")
        .select("id, name")
        .ilike("name", `%${q}%`)
        .neq("id", id)
        .limit(8);
      setArtistResults(data ?? []);
    }, 300);
    return () => clearTimeout(handle);
  }, [artistSearch, id]);

  // Step 2: once an artist is chosen, browse THEIR tracks -- not an exact
  // title match required, so a differently-worded duplicate (e.g. "Deaf
  // Note" vs "Deaf Note (feat. Playboi Carti)") can still be found.
  useEffect(() => {
    if (!linkTargetArtist) { setTargetTrackResults([]); return; }
    const q = targetTrackSearch.trim();
    if (q.length < 2) { setTargetTrackResults([]); return; }
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from("tracks")
        .select("id, title")
        .eq("artist_id", linkTargetArtist.id)
        .or(`title.ilike.%${q}%,aliases.ilike.%${q}%`)
        .limit(8);
      setTargetTrackResults(data ?? []);
    }, 300);
    return () => clearTimeout(handle);
  }, [targetTrackSearch, linkTargetArtist]);

  function resetLinkPanel() {
    setLinkingTrackId(null);
    setLinkTargetArtist(null);
    setArtistSearch("");
    setArtistResults([]);
    setTargetTrackSearch("");
    setTargetTrackResults([]);
  }

  function chooseLinkArtist(artist: { id: string; name: string }) {
    setLinkTargetArtist(artist);
    setTargetTrackSearch("");
    setTargetTrackResults([]);
  }

  async function createArtistOnTheFly(name: string): Promise<{ id: string; name: string } | null> {
    setAdminBusy(true);
    const { data: newId, error: err } = await supabase.rpc("admin_create_artist", { p_name: name });
    setAdminBusy(false);
    if (err || !newId) { alert(err?.message ?? "Couldn't create artist."); return null; }
    return { id: newId as string, name };
  }

  // Admin found a matching existing entry -- merge (delete the duplicate,
  // link this canonical track in its place).
  async function mergeIntoExisting(track: Track, duplicateTrackId: string) {
    if (!linkTargetArtist) return;
    const proceed = window.confirm(
      `Delete the duplicate entry and link "${track.title}" here instead? ` +
      `Any ratings or comments on that duplicate will be lost — only the version you're linking keeps its own.`
    );
    if (!proceed) return;
    setAdminBusy(true);
    await supabase.rpc("admin_delete_track", { p_track_id: duplicateTrackId });
    const { error: err } = await supabase.rpc("admin_add_track_appearance", { p_track_id: track.id, p_artist_id: linkTargetArtist.id });
    setAdminBusy(false);
    if (err) { alert(err.message); return; }
    resetLinkPanel();
    load();
  }

  // No matching duplicate found (or admin confirmed there isn't one) --
  // just create a fresh cross-artist link.
  async function linkAsNewFeature(track: Track) {
    if (!linkTargetArtist) return;
    setAdminBusy(true);
    const { error: err } = await supabase.rpc("admin_add_track_appearance", { p_track_id: track.id, p_artist_id: linkTargetArtist.id });
    setAdminBusy(false);
    if (err) { alert(err.message); return; }
    resetLinkPanel();
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

  useEffect(() => {
    const q = newTrackMainArtistSearch.trim();
    if (q.length < 2) { setNewTrackMainArtistResults([]); return; }
    const handle = setTimeout(async () => {
      const { data } = await supabase.from("artists").select("id, name").ilike("name", `%${q}%`).limit(8);
      setNewTrackMainArtistResults(data ?? []);
    }, 300);
    return () => clearTimeout(handle);
  }, [newTrackMainArtistSearch]);

  // Parses free-text featured-artist names (comma/and/& separated) and
  // links each one -- creating the artist on the fly if they're not
  // already in the archive, since this runs unattended after track
  // creation rather than as an interactive search.
  async function autoLinkFeaturedArtists(trackId: string, text: string) {
    const names = text.split(/,|&| and /i).map((s) => s.trim()).filter(Boolean);
    for (const name of names) {
      const { data: matches } = await supabase.from("artists").select("id").ilike("name", name).limit(1);
      let targetArtistId = matches && matches.length > 0 ? matches[0].id : null;
      if (!targetArtistId) {
        const { data: createdId } = await supabase.rpc("admin_create_artist", { p_name: name });
        targetArtistId = createdId as string | null;
      }
      if (targetArtistId) {
        await supabase.rpc("admin_add_track_appearance", { p_track_id: trackId, p_artist_id: targetArtistId });
      }
    }
  }

  async function addTrack() {
    if (!newTrack.title.trim()) { alert("Enter a title."); return; }
    if (newTrack.is_featured && !newTrackMainArtistId) {
      alert("Since this track is marked as featured, select who the actual main artist is first.");
      return;
    }
    setAdminBusy(true);

    // The track's real "home" is always the primary artist -- if this
    // page's artist is just a guest, the home is whoever was selected as
    // the main artist, not the page we happen to be adding from.
    const homeArtistId = newTrack.is_featured ? newTrackMainArtistId : id;

    const { data: newTrackId, error: err } = await supabase.rpc("admin_add_track", {
      p_artist_id: homeArtistId,
      p_title: newTrack.title.trim(),
      p_spotify_url: newTrack.spotify_url,
      p_is_featured: false, // a track is always non-featured on its own home page, by definition
      p_is_official: newTrack.is_official,
      p_has_audio: newTrack.has_audio,
      p_parent_track_id: newTrack.parent_track_id,
      p_aliases: newTrack.aliases,
      p_album: newTrack.album,
      p_track_number: newTrack.track_number ? parseInt(newTrack.track_number, 10) : null,
      p_release_date: newTrack.release_date || null,
      p_producers: newTrack.producers,
      p_featured_artists: newTrack.featured_artists_text,
      p_genre: newTrack.genre,
      p_notes: newTrack.notes,
    });

    if (err) { setAdminBusy(false); alert(err.message); return; }

    if (newTrackId) {
      if (newTrack.is_featured) {
        // Link back to the (actually featured) artist whose page we added this from.
        await supabase.rpc("admin_add_track_appearance", { p_track_id: newTrackId as string, p_artist_id: id });
        // Plus any OTHER featured artists on a multi-way collab.
        if (newTrack.featured_artists_text.trim()) {
          await autoLinkFeaturedArtists(newTrackId as string, newTrack.featured_artists_text);
        }
      } else if (newTrack.featured_artists_text.trim()) {
        // Main track with named guests -- auto-link any that match a real artist.
        await autoLinkFeaturedArtists(newTrackId as string, newTrack.featured_artists_text);
      }
    }

    setAdminBusy(false);
    setAddingTrack(false);
    setNewTrack({
      title: "", spotify_url: "", is_featured: false, is_official: false, has_audio: true, parent_track_id: "", featured_artists_text: "",
      aliases: "", album: "", track_number: "", release_date: "", producers: "", genre: "", notes: "",
    });
    setNewTrackParentSearch("");
    setNewTrackMainArtistId("");
    setNewTrackMainArtistSearch("");
    load();
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
  }

  function buildInfoLines(t: Track): [string, string][] {
    const lines: [string, string][] = [["Track Name", t.title]];
    if (t.aliases) lines.push(["Aliases", t.aliases]);
    if (artist) lines.push(["Artist", artist.name]);
    if (t.album) lines.push(["Album", t.album]);
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

  // Flagging a link now happens on its own page (see /submit?type=flag_link)
  // rather than blocking native prompts -- those get dismissed if you tab
  // away to go copy the correct link, which defeats the whole point.

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
      album: t.album ?? "",
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
      p_album: editDraft.album,
    });
    setAdminBusy(false);
    if (err) { alert(err.message); return; }
    if (editDraft.featured_artists.trim()) {
      await autoLinkFeaturedArtists(trackId, editDraft.featured_artists);
    }
    setEditingId(null);
    setEditDraft(null);
    load();
  }

  async function deleteTrack(t: Track, hasSubs: boolean) {
    const { data: appearances } = await supabase
      .from("track_appearances")
      .select("artist_id, artists!artist_id(name)")
      .eq("track_id", t.id);
    const appearanceCount = appearances?.length ?? 0;
    const appearanceNames = (appearances ?? []).map((a: any) => a.artists?.name).filter(Boolean).join(", ");

    let warning = `Delete "${t.title}"?`;
    if (hasSubs) warning += " Its alternate versions will be deleted too.";
    if (appearanceCount > 0) {
      warning += ` It's also linked as a feature on ${appearanceCount} other artist page${appearanceCount === 1 ? "" : "s"} (${appearanceNames}) — deleting it removes it from those too, not just here.`;
    }
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
          <input className="search-input" style={{ width: "100%", marginBottom: 6 }} placeholder="Album"
            value={editDraft.album} onChange={(e) => setEditDraft({ ...editDraft, album: e.target.value })} />
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
              href={`/submit?type=correction&artist_id=${id}&track_id=${t.id}&track_title=${encodeURIComponent(t.title)}&current_url=${encodeURIComponent(t.spotify_url ?? "")}&current_featured=${t.is_featured}&current_official=${t.is_official}&current_parent_id=${t.parent_track_id ?? ""}&current_parent_title=${encodeURIComponent(t.parent_track_id ? (mainTracks.find((mt) => mt.id === t.parent_track_id)?.title ?? "") : "")}&current_aliases=${encodeURIComponent(t.aliases ?? "")}&current_track_number=${t.track_number ?? ""}&current_release_date=${t.release_date ?? ""}&current_producers=${encodeURIComponent(t.producers ?? "")}&current_featured_artists=${encodeURIComponent(t.featured_artists ?? "")}&current_genre=${encodeURIComponent(t.genre ?? "")}&current_notes=${encodeURIComponent(t.notes ?? "")}&current_album=${encodeURIComponent(t.album ?? "")}`}
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
              <button
                className="listen-link"
                onClick={(e) => { e.stopPropagation(); if (linkingTrackId === t.id) { resetLinkPanel(); } else { resetLinkPanel(); setLinkingTrackId(t.id); } }}
              >
                link track
              </button>
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
                <a
                  href={`/submit?type=flag_link&artist_id=${id}&track_id=${t.id}&track_title=${encodeURIComponent(t.title)}&current_url=${encodeURIComponent(t.spotify_url)}`}
                  className="listen-link"
                  onClick={(e) => e.stopPropagation()}
                >
                  flag link
                </a>
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
        {linkingTrackId === t.id && !linkTargetArtist && (
          <div className="comments-panel" onClick={(e) => e.stopPropagation()}>
            <div className="comments-count" style={{ marginBottom: 8 }}>
              Step 1: which artist should &quot;{t.title}&quot; also appear under?
            </div>
            <input
              className="search-input"
              style={{ width: "100%" }}
              placeholder="Search artists…"
              value={artistSearch}
              onChange={(e) => setArtistSearch(e.target.value)}
              autoFocus
            />
            {artistSearch.trim().length >= 2 && (
              <div style={{ marginTop: 8 }}>
                {artistResults.map((a) => (
                  <div
                    key={a.id}
                    className="comment-item"
                    style={{ cursor: "pointer", padding: "8px 6px" }}
                    onClick={() => chooseLinkArtist(a)}
                  >
                    <span className="comment-body" style={{ fontSize: "0.82rem" }}>{a.name}</span>
                  </div>
                ))}
                {artistResults.length === 0 && (
                  <div className="comment-item" style={{ cursor: "pointer", padding: "8px 6px" }} onClick={async () => {
                    const created = await createArtistOnTheFly(artistSearch.trim());
                    if (created) chooseLinkArtist(created);
                  }}>
                    <span className="comment-body" style={{ fontSize: "0.82rem" }}>+ create artist &quot;{artistSearch.trim()}&quot;</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {linkingTrackId === t.id && linkTargetArtist && (
          <div className="comments-panel" onClick={(e) => e.stopPropagation()}>
            <div className="comments-count" style={{ marginBottom: 8 }}>
              Step 2: does {linkTargetArtist.name} already have a separate entry for this track?
              Search their tracks to find and merge it — or confirm there&apos;s no match.
            </div>
            <input
              className="search-input"
              style={{ width: "100%" }}
              placeholder={`Search ${linkTargetArtist.name}'s tracks…`}
              value={targetTrackSearch}
              onChange={(e) => setTargetTrackSearch(e.target.value)}
              autoFocus
            />
            {targetTrackSearch.trim().length >= 2 && (
              <div style={{ marginTop: 8 }}>
                {targetTrackResults.map((r) => (
                  <div
                    key={r.id}
                    className="comment-item"
                    style={{ cursor: "pointer", padding: "8px 6px" }}
                    onClick={() => mergeIntoExisting(t, r.id)}
                  >
                    <span className="comment-body" style={{ fontSize: "0.82rem" }}>{r.title}</span>
                    <div className="comment-meta">click to merge into this one</div>
                  </div>
                ))}
                {targetTrackResults.length === 0 && <div className="comments-count">No matches found.</div>}
              </div>
            )}
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button className="comment-post-btn" disabled={adminBusy} onClick={() => linkAsNewFeature(t)}>
                no match — link as new feature
              </button>
              <button className="rating-clear" onClick={() => setLinkTargetArtist(null)}>back</button>
            </div>
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
            <button
              className="tab"
              style={{ marginBottom: 14, marginLeft: 8, borderColor: "#a33", color: "#e88" }}
              disabled={adminBusy}
              onClick={deleteArtist}
            >
              delete artist
            </button>
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
              {newTrack.is_featured ? (
                <div style={{ marginBottom: 10 }}>
                  <div className="comments-count" style={{ marginBottom: 6 }}>
                    Since {artist?.name} is just featured here, who&apos;s the actual main artist?
                  </div>
                  <div style={{ position: "relative" }}>
                    <input
                      className="search-input"
                      style={{ width: "100%" }}
                      placeholder="Search artists…"
                      value={newTrackMainArtistSearch}
                      onChange={(e) => { setNewTrackMainArtistSearch(e.target.value); setNewTrackMainArtistId(""); }}
                    />
                    {newTrackMainArtistSearch.trim().length >= 2 && !newTrackMainArtistId && (
                      <div className="comments-panel" style={{ position: "absolute", zIndex: 5, width: "100%", maxHeight: 180, overflowY: "auto", padding: "6px 4px" }}>
                        {newTrackMainArtistResults.map((a) => (
                          <div key={a.id} className="comment-item" style={{ cursor: "pointer", padding: "8px 6px" }}
                            onClick={() => { setNewTrackMainArtistId(a.id); setNewTrackMainArtistSearch(a.name); }}>
                            <span className="comment-body" style={{ fontSize: "0.82rem" }}>{a.name}</span>
                          </div>
                        ))}
                        {newTrackMainArtistResults.length === 0 && (
                          <div className="comment-item" style={{ cursor: "pointer", padding: "8px 6px" }} onClick={async () => {
                            const created = await createArtistOnTheFly(newTrackMainArtistSearch.trim());
                            if (created) { setNewTrackMainArtistId(created.id); setNewTrackMainArtistSearch(created.name); }
                          }}>
                            <span className="comment-body" style={{ fontSize: "0.82rem" }}>+ create artist &quot;{newTrackMainArtistSearch.trim()}&quot;</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {newTrackMainArtistId && (
                    <div className="comments-count" style={{ marginTop: 4, marginBottom: 8 }}>
                      Will be added under {newTrackMainArtistSearch}, and linked here as a feature.
                    </div>
                  )}
                  <input
                    className="search-input"
                    style={{ width: "100%" }}
                    placeholder="Any other featured artists on this one? (comma separated, optional)"
                    value={newTrack.featured_artists_text}
                    onChange={(e) => setNewTrack({ ...newTrack, featured_artists_text: e.target.value })}
                  />
                </div>
              ) : (
                <input
                  className="search-input"
                  style={{ width: "100%", marginBottom: 10 }}
                  placeholder="Featured artists, if any (comma separated) — auto-links if they're in the archive"
                  value={newTrack.featured_artists_text}
                  onChange={(e) => setNewTrack({ ...newTrack, featured_artists_text: e.target.value })}
                />
              )}
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

              <div className="comments-count" style={{ marginBottom: 6, marginTop: 10 }}>Verbose info (optional)</div>
              <input className="search-input" style={{ width: "100%", marginBottom: 6 }} placeholder="Aliases (comma separated)"
                value={newTrack.aliases} onChange={(e) => setNewTrack({ ...newTrack, aliases: e.target.value })} />
              <input className="search-input" style={{ width: "100%", marginBottom: 6 }} placeholder="Album"
                value={newTrack.album} onChange={(e) => setNewTrack({ ...newTrack, album: e.target.value })} />
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <input className="search-input" style={{ flex: 1 }} type="number" placeholder="Track #"
                  value={newTrack.track_number} onChange={(e) => setNewTrack({ ...newTrack, track_number: e.target.value })} />
                <input className="search-input" style={{ flex: 2 }} type="date" placeholder="Release date"
                  value={newTrack.release_date} onChange={(e) => setNewTrack({ ...newTrack, release_date: e.target.value })} />
              </div>
              <input className="search-input" style={{ width: "100%", marginBottom: 6 }} placeholder="Producers"
                value={newTrack.producers} onChange={(e) => setNewTrack({ ...newTrack, producers: e.target.value })} />
              <input className="search-input" style={{ width: "100%", marginBottom: 6 }} placeholder="Genre"
                value={newTrack.genre} onChange={(e) => setNewTrack({ ...newTrack, genre: e.target.value })} />
              <textarea className="comment-textarea" style={{ marginBottom: 10 }} placeholder="Notes"
                value={newTrack.notes} onChange={(e) => setNewTrack({ ...newTrack, notes: e.target.value })} />

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
