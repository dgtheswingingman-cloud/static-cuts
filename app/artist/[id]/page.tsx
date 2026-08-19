"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import TrackComments from "./TrackComments";

type Track = {
  id: string;
  title: string;
  spotify_url: string | null;
  parent_track_id: string | null;
  track_type: string;
  is_featured: boolean;
  is_official: boolean;
  has_audio: boolean;
};
type Artist = { id: string; name: string; status: string | null };
type RoleFilter = "all" | "main" | "featured";
type ReleaseFilter = "all" | "official" | "unreleased";
type CollectedFilter = "all" | "collected" | "uncollected";
type TrackSortKey = "title-asc" | "title-desc";

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

export default function ArtistPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { user, loading: authLoading } = useAuth();

  const [artist, setArtist] = useState<Artist | null>(null);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [releaseFilter, setReleaseFilter] = useState<ReleaseFilter>("all");
  const [collectedFilter, setCollectedFilter] = useState<CollectedFilter>("all");
  const [sort, setSort] = useState<TrackSortKey>("title-asc");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [myRatings, setMyRatings] = useState<Record<string, number>>({});
  const [avgRatings, setAvgRatings] = useState<Record<string, { avg: number; count: number }>>({});
  const [openRatingId, setOpenRatingId] = useState<string | null>(null);
  const [openCommentsId, setOpenCommentsId] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  useEffect(() => {
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
            .select(
              "id, title, spotify_url, parent_track_id, track_type, is_featured, is_official, has_audio"
            )
            .eq("artist_id", id)
            .range(from, from + PAGE_SIZE - 1);
          if (trackErr) throw trackErr;
          all = all.concat(page ?? []);
          if (!page || page.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }
        all.sort((a, b) => a.title.localeCompare(b.title));
        setTracks(all);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    }
    load();
  }, [id]);

  // Load this user's collected tracks once we know both who they are and
  // which tracks belong to this artist.
  useEffect(() => {
    async function loadOwned() {
      if (!user || !tracks) {
        setOwned(new Set());
        return;
      }
      const trackIds = tracks.map((t) => t.id);
      if (trackIds.length === 0) return;
      const { data, error: ownedErr } = await supabase
        .from("track_ownership")
        .select("track_id")
        .eq("user_id", user.id)
        .in("track_id", trackIds);
      if (ownedErr) {
        console.error(ownedErr);
        return;
      }
      setOwned(new Set((data ?? []).map((r) => r.track_id)));
    }
    loadOwned();
  }, [user, tracks]);

  // Community averages: fetched via the public aggregate view, scoped to
  // this artist so it stays a small query regardless of catalog size.
  useEffect(() => {
    async function loadAvgRatings() {
      const { data, error: avgErr } = await supabase
        .from("track_rating_stats")
        .select("track_id, avg_rating, rating_count")
        .eq("artist_id", id);
      if (avgErr) {
        console.error(avgErr);
        return;
      }
      const map: Record<string, { avg: number; count: number }> = {};
      (data ?? []).forEach((r: any) => {
        map[r.track_id] = { avg: Number(r.avg_rating), count: r.rating_count };
      });
      setAvgRatings(map);
    }
    loadAvgRatings();
  }, [id]);

  // This user's own ratings, once we know both who they are and which
  // tracks belong to this artist.
  useEffect(() => {
    async function loadMyRatings() {
      if (!user || !tracks) {
        setMyRatings({});
        return;
      }
      const trackIds = tracks.map((t) => t.id);
      if (trackIds.length === 0) return;
      const { data, error: ratingErr } = await supabase
        .from("ratings")
        .select("track_id, value")
        .eq("user_id", user.id)
        .in("track_id", trackIds);
      if (ratingErr) {
        console.error(ratingErr);
        return;
      }
      const map: Record<string, number> = {};
      (data ?? []).forEach((r) => { map[r.track_id] = r.value; });
      setMyRatings(map);
    }
    loadMyRatings();
  }, [user, tracks]);

  async function setRating(trackId: string, value: number) {
    if (!user) {
      router.push("/login");
      return;
    }
    const { error: rateErr } = await supabase
      .from("ratings")
      .upsert({ user_id: user.id, track_id: trackId, value, updated_at: new Date().toISOString() });
    if (rateErr) {
      console.error(rateErr);
      return;
    }
    setMyRatings((prev) => ({ ...prev, [trackId]: value }));
    // Refresh this track's community average since it just changed.
    const { data } = await supabase
      .from("track_rating_stats")
      .select("avg_rating, rating_count")
      .eq("track_id", trackId)
      .maybeSingle();
    if (data) {
      setAvgRatings((prev) => ({
        ...prev,
        [trackId]: { avg: Number(data.avg_rating), count: data.rating_count },
      }));
    }
    setOpenRatingId(null);
  }

  async function clearRating(trackId: string) {
    if (!user) return;
    const { error: delErr } = await supabase
      .from("ratings")
      .delete()
      .eq("user_id", user.id)
      .eq("track_id", trackId);
    if (delErr) {
      console.error(delErr);
      return;
    }
    setMyRatings((prev) => {
      const next = { ...prev };
      delete next[trackId];
      return next;
    });
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
    if (!user) {
      router.push("/login");
      return;
    }
    setTogglingId(trackId);
    const isOwned = owned.has(trackId);
    try {
      if (isOwned) {
        const { error: delErr } = await supabase
          .from("track_ownership")
          .delete()
          .eq("user_id", user.id)
          .eq("track_id", trackId);
        if (delErr) throw delErr;
        setOwned((prev) => {
          const next = new Set(prev);
          next.delete(trackId);
          return next;
        });
      } else {
        const { error: insErr } = await supabase
          .from("track_ownership")
          .insert({ user_id: user.id, track_id: trackId });
        if (insErr) throw insErr;
        setOwned((prev) => new Set(prev).add(trackId));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setTogglingId(null);
    }
  }

  const mainTracks = tracks?.filter((t) => !t.parent_track_id) ?? [];
  const subsByParent: Record<string, Track[]> = {};
  (tracks ?? []).forEach((t) => {
    if (t.parent_track_id) {
      (subsByParent[t.parent_track_id] = subsByParent[t.parent_track_id] || []).push(t);
    }
  });

  const filteredMain = (() => {
    const list = mainTracks.filter((t) =>
      trackPasses(t, owned, roleFilter, releaseFilter, collectedFilter)
    );
    const sorted = [...list];
    if (sort === "title-desc") sorted.sort((a, b) => b.title.localeCompare(a.title));
    else sorted.sort((a, b) => a.title.localeCompare(b.title));
    return sorted;
  })();
  const confirmedCount = tracks?.filter((t) => t.spotify_url).length ?? 0;
  const collectedCount = tracks?.filter((t) => owned.has(t.id)).length ?? 0;
  const collectedPct = tracks && tracks.length > 0 ? Math.round((collectedCount / tracks.length) * 100) : 0;

  function trackRow(t: Track, isSub: boolean) {
    const isOwned = owned.has(t.id);
    const isToggling = togglingId === t.id;
    const myRating = myRatings[t.id];
    const hasRated = myRating !== undefined;
    const avg = avgRatings[t.id];
    const chipLabel = hasRated ? `your rating: ${myRating}/10` : "rate";
    const isRatingOpen = openRatingId === t.id;
    return (
      <div key={t.id} style={{ marginLeft: isSub ? 30 : 0 }}>
        <div
          className="track-row"
          onClick={() => toggleOwned(t.id)}
          style={{ opacity: isToggling ? 0.5 : 1 }}
        >
          <div className={`sigil ${isOwned ? "owned" : ""}`}>{isOwned ? "✓" : ""}</div>
          <span className={`track-title ${isOwned ? "owned" : ""}`}>{t.title}</span>
          {t.is_featured && <span className="feature-tag">featured</span>}
          {t.is_official ? (
            <span className="feature-tag">official</span>
          ) : (
            <span className="feature-tag">unreleased</span>
          )}
          {!t.has_audio && <span className="feature-tag">no audio</span>}
          <button
            className={`rating-chip ${hasRated ? "rated" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setOpenRatingId(isRatingOpen ? null : t.id);
            }}
          >
            {chipLabel}
          </button>
          <button
            className="rating-chip"
            onClick={(e) => {
              e.stopPropagation();
              setOpenCommentsId(openCommentsId === t.id ? null : t.id);
            }}
          >
            comments
          </button>
          {t.spotify_url ? (
            <a
              className="listen-link"
              href={t.spotify_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              spotify
            </a>
          ) : (
            <a
              className="listen-link"
              href={`https://open.spotify.com/search/${encodeURIComponent(
                `${artist?.name ?? ""} ${t.title}`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              search
            </a>
          )}
        </div>
        {isRatingOpen && (
          <div className="rating-popover" onClick={(e) => e.stopPropagation()}>
            <div className="rp-label">
              {hasRated
                ? avg
                  ? `community avg: ${avg.avg}/10 (${avg.count} rating${avg.count === 1 ? "" : "s"})`
                  : "no other ratings yet"
                : "rate to see the community average"}
            </div>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                className={`rating-num ${myRating === n ? "selected" : ""}`}
                onClick={() => setRating(t.id, n)}
              >
                {n}
              </button>
            ))}
            {hasRated && (
              <button className="rating-clear" onClick={() => clearRating(t.id)}>
                clear rating
              </button>
            )}
          </div>
        )}
        {openCommentsId === t.id && (
          <div onClick={(e) => e.stopPropagation()}>
            <TrackComments trackId={t.id} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="wrap">
      <Link
        href="/"
        style={{
          textDecoration: "none",
          fontFamily: "var(--font-anton)",
          fontSize: "1.1rem",
          letterSpacing: "0.01em",
          color: "var(--bone)",
          display: "block",
          marginBottom: 14,
        }}
      >
        STATIC CUTS<span style={{ color: "var(--smoke)" }}>//</span>
      </Link>
      <button className="back-btn" onClick={() => router.push("/")}>
        ← back to archive
      </button>

      {error && (
        <div className="empty-state" style={{ borderColor: "#a33", marginTop: 18 }}>
          Couldn&apos;t load this artist: <b>{error}</b>
        </div>
      )}

      {!error && artist && (
        <>
          <h1 className="detail-name">{artist.name}</h1>
          <button
            className={`tab ${isFollowing ? "active" : ""}`}
            style={{ marginBottom: 14 }}
            disabled={followBusy}
            onClick={toggleFollow}
          >
            {isFollowing ? "✓ following" : "+ follow"}
          </button>
          <a
            href={`/submit?artist_id=${id}&artist_name=${encodeURIComponent(artist.name)}`}
            className="tab"
            style={{ marginBottom: 14, marginLeft: 8, textDecoration: "none", display: "inline-block" }}
          >
            + suggest a track
          </a>
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
              <a href="/login" style={{ color: "var(--bone)" }}>
                Log in
              </a>{" "}
              to start tracking which of these you&apos;ve found.
            </div>
          )}

          <div className="tabs">
            {(["all", "main", "featured"] as RoleFilter[]).map((f) => (
              <button
                key={f}
                className={`tab ${roleFilter === f ? "active" : ""}`}
                onClick={() => setRoleFilter(f)}
              >
                {f}
              </button>
            ))}
            <span style={{ width: 4 }} />
            {(["all", "official", "unreleased"] as ReleaseFilter[]).map((f) => (
              <button
                key={f}
                className={`tab ${releaseFilter === f ? "active" : ""}`}
                onClick={() => setReleaseFilter(f)}
              >
                {f}
              </button>
            ))}
            {user && (
              <>
                <span style={{ width: 4 }} />
                {(["all", "collected", "uncollected"] as CollectedFilter[]).map((f) => (
                  <button
                    key={f}
                    className={`tab ${collectedFilter === f ? "active" : ""}`}
                    onClick={() => setCollectedFilter(f)}
                  >
                    {f}
                  </button>
                ))}
              </>
            )}
          </div>

          <div className="sort-row">
            <select
              className="sort-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as TrackSortKey)}
            >
              <option value="title-asc">Title (A–Z)</option>
              <option value="title-desc">Title (Z–A)</option>
            </select>
          </div>

          {!tracks && <div className="empty-state">loading tracklist…</div>}

          {tracks && (
            <div>
              {filteredMain.map((t) => (
                <div key={t.id}>
                  {trackRow(t, false)}
                  {(subsByParent[t.id] ?? [])
                    .filter((s) => trackPasses(s, owned, roleFilter, releaseFilter, collectedFilter))
                    .map((s) => trackRow(s, true))}
                </div>
              ))}
              {filteredMain.length === 0 && (
                <div className="empty-state">Nothing here yet.</div>
              )}
            </div>
          )}

          <div className="note">
            <b>Your collection now syncs</b> — click any track to mark it collected; it saves
            straight to your account and follows you across devices. What &quot;collected&quot;
            means is up to you (heard it, found a link, own a copy — your call).
          </div>
        </>
      )}
    </div>
  );
}
