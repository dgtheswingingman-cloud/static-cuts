"use client";

// Suggest// : add to the archive. Pick what you're suggesting (new artist,
// new song, new version, fix details, status change, broken link), find the
// artist or song it's about, fill in what you know. A moderator checks it
// first, unless you're a trusted contributor. Song and artist pages link here
// with everything filled in already.

import { useEffect, useState, Suspense, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../useIsAdmin";
import DateDropdownPicker from "../components/DateDropdownPicker";
import AlbumAutocomplete from "../components/AlbumAutocomplete";
import { thumb } from "@/lib/thumb";

type SubmitType = "new_artist" | "new_track" | "new_version" | "correction" | "status_change" | "flag_link" | "flag_deletion";
type Tag = { id: string; name: string };
type SongHit = { id: string; title: string; artist_id: string; cover_url: string | null; release_status: string | null; artists: { name: string; image_url: string | null } | null };

const STATUSES = ["released", "leaked", "snippet", "teased", "announced", "unconfirmed"];

const CARDS: [SubmitType, string, ReactNode][] = [
  ["new_artist", "New artist", <svg key="a" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></svg>],
  ["new_track", "New song", <svg key="s" viewBox="0 0 24 24"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>],
  ["new_version", "New version", <svg key="v" viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="1" /><path d="M4 16V5a1 1 0 0 1 1-1h11" /></svg>],
  ["correction", "Fix details", <svg key="f" viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16z" /><path d="M14 6l3 3" /></svg>],
  ["status_change", "Status change", <svg key="c" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5M20 20v-4h-4" /></svg>],
  ["flag_link", "Broken link", <svg key="l" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>],
];

const HEAD: Record<SubmitType, [string, string]> = {
  new_artist: ["New artist", "Suggest an artist who isn't in the archive yet."],
  new_track: ["New song", "Suggest a new song for the archive."],
  new_version: ["New version", "Add an alternate version of a song that's already here (demo, live, a different mix)."],
  correction: ["Fix details", "Change whatever needs fixing on a song; leave the rest as it is."],
  status_change: ["Status change", "A song leaked, came out, or got snippeted? Say what it is now."],
  flag_link: ["Broken link", "The listen link on a song is dead or wrong."],
  flag_deletion: ["Remove a song", "A song that shouldn't be here (duplicate, wrong artist, doesn't exist)."],
};

function Field({ label, req, hint, children }: { label: string; req?: boolean; hint?: string; children: ReactNode }) {
  return (
    <div className="sb-field">
      <div className="sb-label">{label}{req && <em> *</em>}{hint && <small>{hint}</small>}</div>
      <div className="sb-input">{children}</div>
    </div>
  );
}

function Face({ url, round = true }: { url: string | null | undefined; round?: boolean }) {
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={thumb(url)} alt="" className={round ? "sb-face" : "sb-face sq"} />
    : <span className={round ? "sb-face blank" : "sb-face sq blank"} />;
}

function SubmitForm() {
  const { loading: authLoading } = useAuth();
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sp = (k: string) => searchParams.get(k) ?? "";

  const typeParam = searchParams.get("type") as SubmitType | null;
  const prefillNewArtistName = sp("prefill_name");
  const currentFeaturedArtistTags: Tag[] = (() => {
    const raw = searchParams.get("current_featured_artist_tags");
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  })();

  const initialType: SubmitType = typeParam ? typeParam : sp("parent_track_id") ? "new_version" : sp("artist_id") ? "new_track" : prefillNewArtistName ? "new_artist" : "new_track";
  const [type, setType] = useState<SubmitType>(initialType);

  // What it's about: filled from the link, or picked here.
  const [prefilledArtistId, setArtistId] = useState(sp("artist_id"));
  const [prefilledArtistName, setArtistName2] = useState(sp("artist_name"));
  const [artistImage, setArtistImage] = useState<string | null>(null);
  const [prefilledParentTrackId, setParentTrackId] = useState(sp("parent_track_id"));
  const [prefilledParentTitle, setParentTitle] = useState(sp("parent_title"));
  const [prefilledTrackId, setTrackId] = useState(sp("track_id"));
  const [prefilledTrackTitle, setTrackTitle2] = useState(sp("track_title"));
  const [currentUrl, setCurrentUrl] = useState(sp("current_url"));
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [pickedCover, setPickedCover] = useState<string | null>(null);

  const [parentSearch, setParentSearch] = useState(sp("current_parent_title"));
  const [parentResults, setParentResults] = useState<{ id: string; title: string }[]>([]);
  const [parentSuggestionsOpen, setParentSuggestionsOpen] = useState(false);

  const [artistName, setArtistName] = useState(prefillNewArtistName);
  const [trackTitle, setTrackTitle] = useState("");
  const [trackUrl, setTrackUrl] = useState("");
  const [versionTitle, setVersionTitle] = useState("");
  const [versionUrl, setVersionUrl] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [isFeatured, setIsFeatured] = useState(false);
  const [mainArtistSearch, setMainArtistSearch] = useState("");
  const [mainArtistResults, setMainArtistResults] = useState<Tag[]>([]);
  const [mainArtistId, setMainArtistId] = useState("");
  const [subVersionSearch, setSubVersionSearch] = useState("");
  const [subVersionResults, setSubVersionResults] = useState<{ id: string; title: string }[]>([]);
  const [subVersionParentId, setSubVersionParentId] = useState("");
  const [newAliases, setNewAliases] = useState("");
  const [newAlbum, setNewAlbum] = useState("");
  const [newTrackNumber, setNewTrackNumber] = useState("");
  const [newReleaseDate, setNewReleaseDate] = useState("");
  const [newProducers, setNewProducers] = useState("");
  const [newGenre, setNewGenre] = useState("");
  const [newNotes, setNewNotes] = useState("");

  // Fix details: the song's current values.
  const [editTitle, setEditTitle] = useState(sp("track_title"));
  const [editUrl, setEditUrl] = useState(sp("current_url"));
  const [editFeatured, setEditFeatured] = useState(sp("current_featured") === "true");
  const [editOfficial, setEditOfficial] = useState(sp("current_official") === "true");
  const [editParentId, setEditParentId] = useState(sp("current_parent_id"));
  const [editAliases, setEditAliases] = useState(sp("current_aliases"));
  const [editTrackNumber, setEditTrackNumber] = useState(sp("current_track_number"));
  const [editReleaseDate, setEditReleaseDate] = useState(sp("current_release_date"));
  const [editProducers, setEditProducers] = useState(sp("current_producers"));
  const [newFeaturedTags, setNewFeaturedTags] = useState<Tag[]>([]);
  const [newFeaturedSearch, setNewFeaturedSearch] = useState("");
  const [newFeaturedResults, setNewFeaturedResults] = useState<Tag[]>([]);
  const [editFeaturedTags, setEditFeaturedTags] = useState<Tag[]>(currentFeaturedArtistTags);
  const [editFeaturedSearch, setEditFeaturedSearch] = useState("");
  const [editFeaturedResults, setEditFeaturedResults] = useState<Tag[]>([]);
  const [editGenre, setEditGenre] = useState(sp("current_genre"));
  const [editNotes, setEditNotes] = useState(sp("current_notes"));
  const [editAlbum, setEditAlbum] = useState(sp("current_album"));
  const [flagReason, setFlagReason] = useState("");
  const [flagReplacement, setFlagReplacement] = useState("");
  const [deletionReason, setDeletionReason] = useState("");
  const [toStatus, setToStatus] = useState("");
  const [statusDate, setStatusDate] = useState("");
  const [statusLink, setStatusLink] = useState("");

  // Pickers
  const [artistQ, setArtistQ] = useState("");
  const [artistHits, setArtistHits] = useState<{ id: string; name: string; image_url: string | null }[]>([]);
  const [songQ, setSongQ] = useState("");
  const [songHits, setSongHits] = useState<SongHit[]>([]);

  const [trust, setTrust] = useState<{ approved: number; rejected: number; trusted: boolean } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => { supabase.rpc("rpc_my_trust").then(({ data }) => setTrust(data ?? null)); }, []);

  // Picture of the artist (and the song's cover and status) when they came in on the link.
  useEffect(() => {
    if (prefilledArtistId) supabase.from("artists").select("image_url").eq("id", prefilledArtistId).maybeSingle()
      .then(({ data }) => setArtistImage((data as { image_url: string | null } | null)?.image_url ?? null));
    // Opened with just a song (e.g. "Fill in" from Help wanted): load what it has now,
    // so a fix only changes what you change.
    if (sp("track_id") && !searchParams.has("current_url") && (initialType === "correction" || initialType === "status_change" || initialType === "flag_link")) {
      supabase.from("tracks").select("id, title, artist_id, cover_url, release_status, artists!artist_id(name, image_url)").eq("id", sp("track_id")).maybeSingle()
        .then(({ data }) => { if (data) pickSong(data as unknown as SongHit); });
      return;
    }
    const tid = sp("track_id") || sp("parent_track_id");
    if (tid) supabase.from("tracks").select("cover_url, release_status").eq("id", tid).maybeSingle().then(({ data }) => {
      const d = data as { cover_url: string | null; release_status: string | null } | null;
      setPickedCover(d?.cover_url ?? null);
      setCurrentStatus(d?.release_status ?? null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Artist search (new song).
  useEffect(() => {
    const q = artistQ.trim();
    if (q.length < 2) { setArtistHits([]); return; }
    const h = setTimeout(async () => {
      const { data } = await supabase.from("artists").select("id, name, image_url").ilike("name", `%${q}%`).limit(8);
      setArtistHits((data as { id: string; name: string; image_url: string | null }[]) ?? []);
    }, 250);
    return () => clearTimeout(h);
  }, [artistQ]);

  // Song search (version, fix, status, link).
  useEffect(() => {
    const q = songQ.trim();
    if (q.length < 2) { setSongHits([]); return; }
    const h = setTimeout(async () => {
      let req = supabase.from("tracks").select("id, title, artist_id, cover_url, release_status, artists!artist_id(name, image_url)").ilike("title", `%${q}%`);
      if (type === "new_version") req = req.is("parent_track_id", null);
      const { data } = await req.limit(10);
      setSongHits((data as unknown as SongHit[]) ?? []);
    }, 250);
    return () => clearTimeout(h);
  }, [songQ, type]);

  function pickArtist(a: { id: string; name: string; image_url: string | null }) {
    setArtistId(a.id); setArtistName2(a.name); setArtistImage(a.image_url); setArtistQ(""); setArtistHits([]);
  }

  async function pickSong(s: SongHit) {
    setSongQ(""); setSongHits([]);
    setArtistId(s.artist_id); setArtistName2(s.artists?.name ?? ""); setArtistImage(s.artists?.image_url ?? null);
    setPickedCover(s.cover_url); setCurrentStatus(s.release_status);
    if (type === "new_version") { setParentTrackId(s.id); setParentTitle(s.title); return; }
    setTrackId(s.id); setTrackTitle2(s.title);
    // Everything about the song as it is now, so a fix only changes what you change.
    const [{ data: t }, { data: feats }] = await Promise.all([
      supabase.from("tracks").select("title, spotify_url, is_featured, is_official, parent_track_id, aliases, track_number, release_date, producers, genre, notes, album").eq("id", s.id).maybeSingle(),
      supabase.from("track_appearances").select("artist_id, artists!artist_id(name)").eq("track_id", s.id),
    ]);
    const d = (t ?? {}) as Record<string, string | number | boolean | null>;
    setCurrentUrl((d.spotify_url as string) ?? "");
    setEditTitle((d.title as string) ?? s.title);
    setEditUrl((d.spotify_url as string) ?? "");
    setEditFeatured(!!d.is_featured);
    setEditOfficial(!!d.is_official);
    setEditParentId((d.parent_track_id as string) ?? "");
    setEditAliases((d.aliases as string) ?? "");
    setEditTrackNumber(d.track_number != null ? String(d.track_number) : "");
    setEditReleaseDate((d.release_date as string) ?? "");
    setEditProducers((d.producers as string) ?? "");
    setEditGenre((d.genre as string) ?? "");
    setEditNotes((d.notes as string) ?? "");
    setEditAlbum((d.album as string) ?? "");
    setEditFeaturedTags(((feats ?? []) as unknown as { artist_id: string; artists: { name: string } | null }[])
      .filter((f) => f.artists?.name).map((f) => ({ id: f.artist_id, name: f.artists!.name })));
    if (d.parent_track_id) {
      const { data: p } = await supabase.from("tracks").select("title").eq("id", d.parent_track_id as string).maybeSingle();
      setParentSearch((p as { title: string } | null)?.title ?? "");
    } else setParentSearch("");
  }

  function clearTarget() {
    setArtistId(""); setArtistName2(""); setArtistImage(null); setParentTrackId(""); setParentTitle("");
    setTrackId(""); setTrackTitle2(""); setCurrentUrl(""); setCurrentStatus(null); setPickedCover(null);
  }

  function changeType(t: SubmitType) {
    if (t === type) return;
    // Keep the artist when moving between song kinds; clear a picked song.
    setTrackId(""); setTrackTitle2(""); setParentTrackId(""); setParentTitle(""); setCurrentUrl(""); setPickedCover(null);
    setError(null);
    setType(t);
  }

  useEffect(() => {
    if (type !== "correction" || !prefilledArtistId) return;
    const q = parentSearch.trim();
    if (q.length < 2) { setParentResults([]); return; }
    const handle = setTimeout(async () => {
      const { data } = await supabase.from("tracks").select("id, title").eq("artist_id", prefilledArtistId)
        .is("parent_track_id", null).neq("id", prefilledTrackId || "-").ilike("title", `%${q}%`).limit(8);
      setParentResults(data ?? []);
    }, 300);
    return () => clearTimeout(handle);
  }, [parentSearch, type, prefilledArtistId, prefilledTrackId]);

  // Checks for an existing track with a matching title (under the same
  // parent scope) or the same listen link, and asks before submitting a
  // likely duplicate. Returns true if it's OK to go ahead.
  async function checkForDuplicates(opts: { artistId: string; title: string; url: string; parentTrackId?: string | null; excludeTrackId?: string }): Promise<boolean> {
    const { artistId, title, url, parentTrackId, excludeTrackId } = opts;
    let titleQuery = supabase.from("tracks").select("id, title").eq("artist_id", artistId).ilike("title", title.trim());
    if (parentTrackId) titleQuery = titleQuery.eq("parent_track_id", parentTrackId);
    else titleQuery = titleQuery.is("parent_track_id", null);
    const { data: titleMatches } = await titleQuery;
    if ((titleMatches ?? []).some((t) => t.id !== excludeTrackId)) {
      if (!window.confirm(`A song called "${title.trim()}" is already here. Submit anyway?`)) return false;
    }
    if (url.trim()) {
      const { data: linkMatches } = await supabase.from("tracks").select("id, title").eq("spotify_url", url.trim());
      const real = (linkMatches ?? []).filter((t) => t.id !== excludeTrackId);
      if (real.length > 0 && !window.confirm(`That link is already on "${real[0].title}". Submit anyway?`)) return false;
    }
    return true;
  }

  useEffect(() => {
    const q = mainArtistSearch.trim();
    if (q.length < 2) { setMainArtistResults([]); return; }
    const handle = setTimeout(async () => {
      const { data } = await supabase.from("artists").select("id, name").ilike("name", `%${q}%`).neq("id", prefilledArtistId || "-").limit(8);
      setMainArtistResults(data ?? []);
    }, 300);
    return () => clearTimeout(handle);
  }, [mainArtistSearch, prefilledArtistId]);

  // "Is this a version of something already here?" for a new song: searches
  // whichever artist it'll live under, main songs only.
  useEffect(() => {
    const q = subVersionSearch.trim();
    const homeArtist = isFeatured ? mainArtistId : prefilledArtistId;
    if (q.length < 2 || !homeArtist) { setSubVersionResults([]); return; }
    const handle = setTimeout(async () => {
      const { data } = await supabase.from("tracks").select("id, title").eq("artist_id", homeArtist).is("parent_track_id", null).ilike("title", `%${q}%`).limit(8);
      setSubVersionResults(data ?? []);
    }, 300);
    return () => clearTimeout(handle);
  }, [subVersionSearch, isFeatured, mainArtistId, prefilledArtistId]);

  useEffect(() => {
    const q = newFeaturedSearch.trim();
    if (q.length < 2) { setNewFeaturedResults([]); return; }
    const handle = setTimeout(async () => {
      const { data } = await supabase.from("artists").select("id, name").ilike("name", `%${q}%`).neq("id", prefilledArtistId || "-").limit(8);
      setNewFeaturedResults((data ?? []).filter((a) => !newFeaturedTags.some((t) => t.id === a.id)));
    }, 300);
    return () => clearTimeout(handle);
  }, [newFeaturedSearch, prefilledArtistId, newFeaturedTags]);

  useEffect(() => {
    const q = editFeaturedSearch.trim();
    if (q.length < 2) { setEditFeaturedResults([]); return; }
    const handle = setTimeout(async () => {
      const { data } = await supabase.from("artists").select("id, name").ilike("name", `%${q}%`).neq("id", prefilledArtistId || "-").limit(8);
      setEditFeaturedResults((data ?? []).filter((a) => !editFeaturedTags.some((t) => t.id === a.id)));
    }, 300);
    return () => clearTimeout(handle);
  }, [editFeaturedSearch, editFeaturedTags, prefilledArtistId]);

  // Featured artists picker (no creating artists here: suggest a new artist instead).
  function featuredTagPicker(tags: Tag[], setTags: (t: Tag[]) => void, search: string, setSearch: (s: string) => void, results: Tag[]) {
    return (
      <div>
        {tags.length > 0 && (
          <div className="sb-tags">
            {tags.map((a) => (
              <span key={a.id} className="feature-tag">{a.name}<button aria-label={`Remove ${a.name}`} onClick={() => setTags(tags.filter((t) => t.id !== a.id))}>✕</button></span>
            ))}
          </div>
        )}
        <div className="sb-drop-wrap">
          <input className="sb-text" placeholder="Search artists to add…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search.trim().length >= 2 && (
            <div className="sb-drop">
              {results.map((a) => <button key={a.id} onClick={() => { setTags([...tags, a]); setSearch(""); }}>{a.name}</button>)}
              {results.length === 0 && <small>Not found. If they&apos;re not here yet, suggest them as a new artist.</small>}
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
        const { data: existing } = await supabase.from("artists").select("id, name").ilike("name", artistName.trim());
        if ((existing ?? []).length > 0 && !window.confirm(`"${existing![0].name}" is already in the archive. Submit anyway?`)) { setBusy(false); return; }
        const { error: err } = await supabase.from("submissions").insert({ type: "new_artist", submitted_by: user.id, payload: { name: artistName.trim() } });
        if (err) throw err;
      } else if (type === "new_track") {
        if (!prefilledArtistId) throw new Error("Pick the artist first.");
        if (!trackTitle.trim()) throw new Error("Enter the song title.");
        if (isFeatured && !mainArtistId) throw new Error("Since they're only featured, pick who the main artist is.");
        const ok = await checkForDuplicates({ artistId: prefilledArtistId, title: trackTitle, url: trackUrl });
        if (!ok) { setBusy(false); return; }
        const { error: err } = await supabase.from("submissions").insert({
          type: "new_track", artist_id: prefilledArtistId, submitted_by: user.id,
          payload: {
            title: trackTitle.trim(), spotify_url: trackUrl.trim() || undefined, is_featured: isFeatured, is_official: newStatus === "released",
            release_status: newStatus || undefined, has_audio: true, main_artist_id: isFeatured ? mainArtistId : undefined,
            parent_track_id: subVersionParentId || undefined, aliases: newAliases.trim(), album: newAlbum.trim(), track_number: newTrackNumber.trim(),
            release_date: newReleaseDate.trim(), producers: newProducers.trim(), featured_artist_ids: isFeatured ? [] : newFeaturedTags.map((a) => a.id),
            genre: newGenre.trim(), notes: newNotes.trim(),
          },
        });
        if (err) throw err;
      } else if (type === "new_version") {
        if (!prefilledParentTrackId || !prefilledArtistId) throw new Error("Pick the original song first.");
        if (!versionTitle.trim()) throw new Error("Give this version a name (e.g. Demo).");
        const ok = await checkForDuplicates({ artistId: prefilledArtistId, title: versionTitle, url: versionUrl, parentTrackId: prefilledParentTrackId });
        if (!ok) { setBusy(false); return; }
        const { error: err } = await supabase.from("submissions").insert({
          type: "new_version", artist_id: prefilledArtistId, submitted_by: user.id,
          payload: {
            title: versionTitle.trim(), spotify_url: versionUrl.trim() || undefined, parent_track_id: prefilledParentTrackId,
            is_featured: false, is_official: newStatus === "released", release_status: newStatus || undefined, has_audio: true,
            aliases: newAliases.trim(), album: newAlbum.trim(), track_number: newTrackNumber.trim(), release_date: newReleaseDate.trim(),
            producers: newProducers.trim(), featured_artist_ids: newFeaturedTags.map((a) => a.id), genre: newGenre.trim(), notes: newNotes.trim(),
          },
        });
        if (err) throw err;
      } else if (type === "correction") {
        if (!prefilledTrackId || !prefilledArtistId) throw new Error("Pick the song first.");
        if (!editTitle.trim()) throw new Error("The title can't be empty.");
        const ok = await checkForDuplicates({ artistId: prefilledArtistId, title: editTitle, url: editUrl, excludeTrackId: prefilledTrackId });
        if (!ok) { setBusy(false); return; }
        const { error: err } = await supabase.from("submissions").insert({
          type: "correction", artist_id: prefilledArtistId, submitted_by: user.id,
          payload: {
            track_id: prefilledTrackId, title: editTitle.trim(), spotify_url: editUrl.trim(), is_featured: editFeatured, is_official: editOfficial,
            parent_track_id: editParentId, aliases: editAliases.trim(), track_number: editTrackNumber.trim(), release_date: editReleaseDate.trim(),
            producers: editProducers.trim(), featured_artist_ids: editFeaturedTags.map((a) => a.id), genre: editGenre.trim(), notes: editNotes.trim(),
            album: editAlbum.trim(),
          },
        });
        if (err) throw err;
      } else if (type === "status_change") {
        if (!prefilledTrackId || !prefilledArtistId) throw new Error("Pick the song first.");
        if (!toStatus) throw new Error("Pick what it is now.");
        if (toStatus === currentStatus) throw new Error(`It's already marked ${toStatus}.`);
        const { error: err } = await supabase.from("submissions").insert({
          type: "status_change", artist_id: prefilledArtistId, submitted_by: user.id,
          payload: {
            track_id: prefilledTrackId, from_status: currentStatus, to_status: toStatus,
            release_date: statusDate.trim() || undefined, link_candidate_url: statusLink.trim() || undefined,
          },
        });
        if (err) throw err;
      } else if (type === "flag_link") {
        if (!prefilledTrackId || !prefilledArtistId) throw new Error("Pick the song first.");
        const { error: err } = await supabase.from("submissions").insert({
          type: "flag_link", artist_id: prefilledArtistId, submitted_by: user.id,
          payload: { track_id: prefilledTrackId, reason: flagReason.trim(), suggested_replacement_url: flagReplacement.trim() || undefined },
        });
        if (err) throw err;
      } else if (type === "flag_deletion") {
        if (!prefilledTrackId || !prefilledArtistId) throw new Error("Missing the song: use \"flag for deletion\" from that song.");
        if (!deletionReason.trim()) throw new Error("Say why it should go. This one's permanent, so the moderators need the reason.");
        const { error: err } = await supabase.from("submissions").insert({
          type: "flag_deletion", artist_id: prefilledArtistId, submitted_by: user.id,
          payload: { track_id: prefilledTrackId, reason: deletionReason.trim() },
        });
        if (err) throw err;
      }
      setSubmitted(true);
      window.scrollTo({ top: 0 });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const trustBar = trust && (
    <div className="sb-trust">
      <span className="sb-trust-icon" aria-hidden="true"><i /><i /><i /></span>
      <span>
        {trust.trusted
          ? <><b>Trusted contributor.</b> Your suggestions go live straight away (removing songs still waits for a moderator).</>
          : <><b>{trust.approved} of 25 approved:</b> at 25 your suggestions go live straight away.</>}
      </span>
      {trust.trusted && <span className="sb-trusted">Trusted ✓</span>}
      {!trust.trusted && <span className="sb-trust-bar"><span style={{ width: `${Math.min(100, (trust.approved / 25) * 100)}%` }} /></span>}
    </div>
  );

  if (submitted) {
    return (
      <div className="wrap sb-page">
        <h1 className="ls-title sb-title">SUGGEST<span>//</span></h1>
        <div className="nw-panel sb-thanks">
          <span className="sb-tick" aria-hidden="true">✓</span>
          <h2>Thanks!</h2>
          <p>{trust?.trusted && type !== "flag_deletion" ? "It's live. You're a trusted contributor, so it went straight in." : "Your suggestion is in. A moderator will check it soon."}</p>
          <button className="sb-submit" onClick={() => window.location.assign("/submit")}>Suggest another</button>
          <Link href="/my-submissions" className="st-btn st-wide sb-see">See my submissions</Link>
        </div>
      </div>
    );
  }

  if (isAdmin) {
    return (
      <div className="wrap sb-page">
        <h1 className="ls-title sb-title">SUGGEST<span>//</span></h1>
        <div className="empty-state">Admin mode doesn&apos;t send suggestions: edit the artist page directly, or switch to your account to suggest like everyone else.</div>
      </div>
    );
  }

  const songTypes: SubmitType[] = ["new_version", "correction", "status_change", "flag_link"];
  const needsSong = songTypes.includes(type);
  const pickedSong = type === "new_version" ? prefilledParentTrackId : prefilledTrackId;
  const pickedTitle = type === "new_version" ? prefilledParentTitle : prefilledTrackTitle;

  const statusChips = (value: string, set: (s: string) => void, current?: string | null) => (
    <div className="sb-chips">
      {STATUSES.map((s) => (
        <button key={s} className={`feature-tag st st-${s} ${value === s ? "on" : ""}`} aria-pressed={value === s} disabled={current === s}
          onClick={() => set(value === s ? "" : s)}>{s}//</button>
      ))}
    </div>
  );

  const extras = (album: { v: string; set: (s: string) => void; prefix: string; artist: string | null },
    num: [string, (s: string) => void], date: [string, (s: string) => void], prod: [string, (s: string) => void],
    alias: [string, (s: string) => void], genre: [string, (s: string) => void], notes: [string, (s: string) => void], feats: ReactNode) => (
    <>
      <div className="sb-two">
        <Field label="Release date"><DateDropdownPicker idPrefix={`${album.prefix}-date`} value={date[0]} onChange={date[1]} /></Field>
        <Field label="Track number"><input className="sb-text" type="number" aria-label="Track number" value={num[0]} onChange={(e) => num[1](e.target.value)} /></Field>
      </div>
      <Field label="Album"><AlbumAutocomplete idPrefix={album.prefix} artistId={album.artist} value={album.v} onChange={album.set} /></Field>
      <Field label="Producers"><input className="sb-text" placeholder="e.g. F1lthy, Art Dealer" value={prod[0]} onChange={(e) => prod[1](e.target.value)} /></Field>
      {feats}
      <Field label="Aliases" hint="comma separated"><input className="sb-text" placeholder="Other names it goes by" value={alias[0]} onChange={(e) => alias[1](e.target.value)} /></Field>
      <Field label="Genre"><input className="sb-text" value={genre[0]} onChange={(e) => genre[1](e.target.value)} /></Field>
      <Field label="Notes"><textarea className="sb-text sb-area" placeholder="Where it's from, other titles it goes by…" value={notes[0]} onChange={(e) => notes[1](e.target.value)} /></Field>
    </>
  );

  return (
    <div className="wrap sb-page">
      <header className="sb-head">
        <div>
          <h1 className="ls-title sb-title">SUGGEST<span>//</span></h1>
          <p className="sb-lead">Add to the archive. A moderator checks it first, unless you&apos;re a trusted contributor.</p>
        </div>
        <Link href="/my-submissions" className="sb-mine">My submissions →</Link>
      </header>
      {trustBar}

      {type !== "flag_deletion" && (
        <nav className="sb-cards" aria-label="What are you suggesting?">
          {CARDS.map(([k, label, icon]) => (
            <button key={k} className={type === k ? "on" : undefined} aria-pressed={type === k} onClick={() => changeType(k)}>
              <span className="sb-card-icon" aria-hidden="true">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}

      <section className="nw-panel sb-form">
        <h2 className="sb-form-h">{HEAD[type][0]}</h2>
        <p className="sb-form-sub">{HEAD[type][1]}</p>

        {type === "new_artist" && (
          <Field label="Artist name" req>
            <input className="sb-text" placeholder="Their name as it appears on releases" value={artistName} onChange={(e) => setArtistName(e.target.value)} />
          </Field>
        )}

        {/* Which artist (new song) */}
        {type === "new_track" && (
          <Field label="Artist" req>
            {prefilledArtistId ? (
              <div className="sb-picked"><Face url={artistImage} /><span>{prefilledArtistName}</span><button aria-label="Change artist" onClick={clearTarget}>✕</button></div>
            ) : (
              <div className="sb-drop-wrap">
                <input className="sb-text" placeholder="Search artists…" value={artistQ} onChange={(e) => setArtistQ(e.target.value)} autoFocus />
                {artistQ.trim().length >= 2 && (
                  <div className="sb-drop">
                    {artistHits.map((a) => <button key={a.id} onClick={() => pickArtist(a)}><Face url={a.image_url} />{a.name}</button>)}
                    {artistHits.length === 0 && <small>Not here yet? <button className="text-link sb-inline" onClick={() => { setArtistName(artistQ); changeType("new_artist"); }}>Suggest them as a new artist</button></small>}
                  </div>
                )}
              </div>
            )}
          </Field>
        )}

        {/* Which song (version, fix, status, link) */}
        {(needsSong || type === "flag_deletion") && (
          <Field label={type === "new_version" ? "Original song" : "Song"} req>
            {pickedSong ? (
              <div className="sb-picked"><Face url={pickedCover} round={false} /><span>{prefilledArtistName ? `${prefilledArtistName} – ` : ""}{pickedTitle}</span>
                {currentStatus && <span className={`feature-tag st st-${currentStatus}`}>{currentStatus}</span>}
                {type !== "flag_deletion" && <button aria-label="Change song" onClick={clearTarget}>✕</button>}</div>
            ) : (
              <div className="sb-drop-wrap">
                <input className="sb-text" placeholder="Search songs…" value={songQ} onChange={(e) => setSongQ(e.target.value)} autoFocus />
                {songQ.trim().length >= 2 && (
                  <div className="sb-drop">
                    {songHits.map((s) => (
                      <button key={s.id} onClick={() => pickSong(s)}>
                        <Face url={s.cover_url ?? s.artists?.image_url} round={!s.cover_url} />
                        <span className="sb-drop-text">{s.artists?.name} – {s.title}</span>
                        {s.release_status && <span className={`feature-tag st st-${s.release_status}`}>{s.release_status}</span>}
                      </button>
                    ))}
                    {songHits.length === 0 && <small>No songs match.</small>}
                  </div>
                )}
              </div>
            )}
          </Field>
        )}

        {type === "new_track" && prefilledArtistId && (
          <>
            <Field label="Song title" req><input className="sb-text" value={trackTitle} onChange={(e) => setTrackTitle(e.target.value)} /></Field>
            <Field label="Listen link" hint="optional"><input className="sb-text" placeholder="https://" value={trackUrl} onChange={(e) => setTrackUrl(e.target.value)} /></Field>
            <Field label="Release status">{statusChips(newStatus, setNewStatus)}</Field>
            <Field label="Featured?">
              <label className="sb-check"><input type="checkbox" checked={isFeatured} onChange={(e) => { setIsFeatured(e.target.checked); setMainArtistId(""); setMainArtistSearch(""); }} /> {prefilledArtistName} is only featured on it</label>
              {isFeatured && (
                <div className="sb-drop-wrap" style={{ marginTop: 8 }}>
                  <input className="sb-text" placeholder="Who's the main artist?" value={mainArtistSearch} onChange={(e) => { setMainArtistSearch(e.target.value); setMainArtistId(""); }} />
                  {mainArtistSearch.trim().length >= 2 && !mainArtistId && (
                    <div className="sb-drop">
                      {mainArtistResults.map((a) => <button key={a.id} onClick={() => { setMainArtistId(a.id); setMainArtistSearch(a.name); }}>{a.name}</button>)}
                      {mainArtistResults.length === 0 && <small>No matches. Suggest them as a new artist first.</small>}
                    </div>
                  )}
                  {mainArtistId && <small className="sb-note">Goes under {mainArtistSearch}, linked here as a feature.</small>}
                </div>
              )}
            </Field>
            <Field label="Version of" hint="optional">
              <div className="sb-drop-wrap">
                <input className="sb-text" placeholder="Is it a version of a song already here?" value={subVersionSearch} onChange={(e) => { setSubVersionSearch(e.target.value); setSubVersionParentId(""); }} />
                {subVersionSearch.trim().length >= 2 && !subVersionParentId && (
                  <div className="sb-drop">
                    {subVersionResults.map((t) => <button key={t.id} onClick={() => { setSubVersionParentId(t.id); setSubVersionSearch(t.title); }}>{t.title}</button>)}
                    {subVersionResults.length === 0 && <small>No matches.</small>}
                  </div>
                )}
                {subVersionParentId && <small className="sb-note">Goes in as a version of &ldquo;{subVersionSearch}&rdquo;. <button className="text-link sb-inline" onClick={() => { setSubVersionParentId(""); setSubVersionSearch(""); }}>clear</button></small>}
              </div>
            </Field>
            {extras({ v: newAlbum, set: setNewAlbum, prefix: "new-track", artist: isFeatured ? (mainArtistId || null) : prefilledArtistId },
              [newTrackNumber, setNewTrackNumber], [newReleaseDate, setNewReleaseDate], [newProducers, setNewProducers],
              [newAliases, setNewAliases], [newGenre, setNewGenre], [newNotes, setNewNotes],
              !isFeatured && <Field label="Featuring" hint="optional">{featuredTagPicker(newFeaturedTags, setNewFeaturedTags, newFeaturedSearch, setNewFeaturedSearch, newFeaturedResults)}</Field>)}
          </>
        )}

        {type === "new_version" && prefilledParentTrackId && (
          <>
            <Field label="Version name" req><input className="sb-text" placeholder='e.g. "Demo", "Live at Radio City", "Alt Mix"' value={versionTitle} onChange={(e) => setVersionTitle(e.target.value)} /></Field>
            <Field label="Listen link" hint="optional"><input className="sb-text" placeholder="https://" value={versionUrl} onChange={(e) => setVersionUrl(e.target.value)} /></Field>
            <Field label="Release status">{statusChips(newStatus, setNewStatus)}</Field>
            {extras({ v: newAlbum, set: setNewAlbum, prefix: "new-version", artist: prefilledArtistId },
              [newTrackNumber, setNewTrackNumber], [newReleaseDate, setNewReleaseDate], [newProducers, setNewProducers],
              [newAliases, setNewAliases], [newGenre, setNewGenre], [newNotes, setNewNotes],
              <Field label="Featuring" hint="optional">{featuredTagPicker(newFeaturedTags, setNewFeaturedTags, newFeaturedSearch, setNewFeaturedSearch, newFeaturedResults)}</Field>)}
          </>
        )}

        {type === "correction" && prefilledTrackId && (
          <>
            <Field label="Title" req><input className="sb-text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} /></Field>
            <Field label="Listen link" hint="blank removes it"><input className="sb-text" placeholder="https://" value={editUrl} onChange={(e) => setEditUrl(e.target.value)} /></Field>
            <Field label="Flags">
              <label className="sb-check"><input type="checkbox" checked={editFeatured} onChange={(e) => setEditFeatured(e.target.checked)} /> Featured (guest artist)</label>
              <label className="sb-check"><input type="checkbox" checked={editOfficial} onChange={(e) => setEditOfficial(e.target.checked)} /> Official release</label>
            </Field>
            <Field label="Version of" hint="if it's really a demo or alt of another song">
              <div className="sb-drop-wrap">
                <input className="sb-text" placeholder="Search main songs…" value={parentSearch}
                  onChange={(e) => { setParentSearch(e.target.value); setParentSuggestionsOpen(true); if (!e.target.value) setEditParentId(""); }}
                  onFocus={() => setParentSuggestionsOpen(true)} />
                {parentSuggestionsOpen && parentSearch.trim().length >= 2 && (
                  <div className="sb-drop">
                    {parentResults.map((mt) => <button key={mt.id} onClick={() => { setEditParentId(mt.id); setParentSearch(mt.title); setParentSuggestionsOpen(false); }}>{mt.title}</button>)}
                    {parentResults.length === 0 && <small>No matches.</small>}
                  </div>
                )}
                <small className="sb-note">{editParentId ? "Becomes a version of that song." : "Leave empty to keep it a main song."}</small>
              </div>
            </Field>
            {extras({ v: editAlbum, set: setEditAlbum, prefix: "correction", artist: prefilledArtistId },
              [editTrackNumber, setEditTrackNumber], [editReleaseDate, setEditReleaseDate], [editProducers, setEditProducers],
              [editAliases, setEditAliases], [editGenre, setEditGenre], [editNotes, setEditNotes],
              <Field label="Featuring">{featuredTagPicker(editFeaturedTags, setEditFeaturedTags, editFeaturedSearch, setEditFeaturedSearch, editFeaturedResults)}</Field>)}
          </>
        )}

        {type === "status_change" && prefilledTrackId && (
          <>
            <Field label="It's now" req>{statusChips(toStatus, setToStatus, currentStatus)}</Field>
            {toStatus === "released" && <Field label="Release date" hint="optional"><DateDropdownPicker idPrefix="status-date" value={statusDate} onChange={setStatusDate} /></Field>}
            <Field label="Source link" hint="optional"><input className="sb-text" placeholder="Where you saw it (a post, a listen link)" value={statusLink} onChange={(e) => setStatusLink(e.target.value)} /></Field>
          </>
        )}

        {type === "flag_link" && prefilledTrackId && (
          <>
            <Field label="Current link"><span className="sb-current">{currentUrl || "No link on this song."}</span></Field>
            <Field label="What's wrong" hint="optional"><textarea className="sb-text sb-area" placeholder="Dead, wrong song, region-locked…" value={flagReason} onChange={(e) => setFlagReason(e.target.value)} /></Field>
            <Field label="Correct link" hint="optional"><input className="sb-text" placeholder="https://" value={flagReplacement} onChange={(e) => setFlagReplacement(e.target.value)} /></Field>
          </>
        )}

        {type === "flag_deletion" && (
          <Field label="Why remove it" req>
            <textarea className="sb-text sb-area" placeholder="Duplicate of another entry, not by this artist, doesn't exist…" value={deletionReason} onChange={(e) => setDeletionReason(e.target.value)} />
            <small className="sb-note">If approved it's deleted for good, so be specific.</small>
          </Field>
        )}

        {error && <div className="sb-error">{error}</div>}
        <button className="sb-submit" disabled={busy || (needsSong && !pickedSong) || (type === "new_track" && !prefilledArtistId)} onClick={submit}>
          {busy ? "Sending…" : "Submit//"}
        </button>
      </section>
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
