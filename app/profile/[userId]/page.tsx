"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";

type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  about: string | null;
  show_completion_pct: boolean;
  show_collected_tracks: boolean;
  show_ratings: boolean;
  show_followed_artists: boolean;
};
type CollectedTrack = { track_id: string; tracks: { title: string; artist_id: string; artists: { name: string } | null } | null };
type RatedTrack = { track_id: string; value: number; tracks: { title: string; artist_id: string; artists: { name: string } | null } | null };
type FollowedArtist = { artist_id: string; artists: { name: string } | null };

// A collapsed-by-default section: just a title + count until clicked open.
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        className="section-label"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
        onClick={() => setOpen(!open)}
      >
        <span>{title} ({count})</span>
        <button className="tab" style={{ padding: "3px 10px", fontSize: "0.62rem" }}>
          {open ? "hide" : "show"}
        </button>
      </div>
      {open && count > 0 && children}
      {open && count === 0 && <div className="empty-state" style={{ marginBottom: 14 }}>Nothing here yet.</div>}
    </div>
  );
}

export default function ProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { user: viewer } = useAuth();
  const userId = params.userId as string;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [stats, setStats] = useState<{ total_tracks: number; collected_tracks: number } | null>(null);
  const [collected, setCollected] = useState<CollectedTrack[]>([]);
  const [rated, setRated] = useState<RatedTrack[]>([]);
  const [followedArtists, setFollowedArtists] = useState<FollowedArtist[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: profileRow, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, about, show_completion_pct, show_collected_tracks, show_ratings, show_followed_artists")
        .eq("id", userId)
        .single();
      if (error || !profileRow) {
        setNotFound(true);
        return;
      }
      setProfile(profileRow as Profile);

      if (profileRow.show_completion_pct) {
        const { data: statRow } = await supabase
          .from("user_completion_stats")
          .select("total_tracks, collected_tracks")
          .eq("user_id", userId)
          .maybeSingle();
        if (statRow) setStats(statRow as any);
      }

      if (profileRow.show_collected_tracks) {
        const { data } = await supabase
          .from("track_ownership")
          .select("track_id, tracks(title, artist_id, artists!artist_id(name))")
          .eq("user_id", userId)
          .order("collected_at", { ascending: false })
          .limit(100);
        setCollected((data as any) ?? []);
      }

      if (profileRow.show_ratings) {
        const { data } = await supabase
          .from("ratings")
          .select("track_id, value, tracks(title, artist_id, artists!artist_id(name))")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(100);
        setRated((data as any) ?? []);
      }

      if (profileRow.show_followed_artists) {
        const { data } = await supabase
          .from("follows")
          .select("artist_id, artists!artist_id(name)")
          .eq("user_id", userId)
          .order("followed_at", { ascending: false });
        setFollowedArtists((data as any) ?? []);
      }
    }
    load();
  }, [userId]);

  const isOwnProfile = viewer?.id === userId;

  async function saveName() {
    if (!viewer) return;
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setSavingName(true);
    const { error: err } = await supabase.from("profiles").update({ display_name: trimmed }).eq("id", viewer.id);
    setSavingName(false);
    if (!err) {
      setProfile((prev) => (prev ? { ...prev, display_name: trimmed } : prev));
      setEditingName(false);
    }
  }

  const pct = stats && stats.total_tracks > 0 ? Math.round((stats.collected_tracks / stats.total_tracks) * 100) : 0;
  const nothingPublic =
    !profile?.show_completion_pct &&
    !profile?.show_collected_tracks &&
    !profile?.show_ratings &&
    !profile?.show_followed_artists;

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>
        ← back to archive
      </button>

      {notFound && (
        <div className="empty-state" style={{ marginTop: 18 }}>
          That profile doesn&apos;t exist.
        </div>
      )}

      {profile && (
        <>
          {editingName ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
              <input
                autoFocus
                className="search-input"
                style={{ maxWidth: 260 }}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }}
              />
              <button className="tab active" disabled={savingName} onClick={saveName}>
                {savingName ? "…" : "save"}
              </button>
              <button className="tab" onClick={() => setEditingName(false)}>cancel</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 4 }}>
              {profile.avatar_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt=""
                  style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: "1.5px solid var(--hair)" }}
                />
              )}
              <h1 className="detail-name" style={{ margin: 0 }}>{profile.display_name ?? "anonymous"}</h1>
            </div>
          )}

          {profile.about && (
            <div style={{ fontFamily: "var(--font-inter)", fontSize: "0.88rem", color: "var(--smoke)", maxWidth: 480, marginBottom: 16, lineHeight: 1.5 }}>
              {profile.about}
            </div>
          )}

          {isOwnProfile && !editingName && (
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <button
                className="tab"
                onClick={() => { setNameDraft(profile.display_name ?? ""); setEditingName(true); }}
              >
                edit name
              </button>
              <Link href="/settings" className="tab" style={{ textDecoration: "none", display: "inline-block" }}>
                edit profile / privacy
              </Link>
            </div>
          )}

          {isOwnProfile && (
            <div className="detail-meta" style={{ marginBottom: 16 }}>
              This is your own profile — visitors only see what you&apos;ve turned on in privacy
              settings.
            </div>
          )}

          {stats && (
            <div style={{ marginBottom: 20 }}>
              <div className="detail-meta">
                {stats.collected_tracks} / {stats.total_tracks} tracks collected ({pct}%)
              </div>
              <div className="bar-track" style={{ height: 4 }}>
                <div className="bar-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          {nothingPublic && (
            <div className="empty-state" style={{ marginTop: 16 }}>
              This user hasn&apos;t made anything public on their profile yet.
            </div>
          )}

          {profile.show_collected_tracks && (
            <Section title="Collected tracks" count={collected.length}>
              {collected.map((c) => (
                <div key={c.track_id} className="track-row" style={{ cursor: "default" }}>
                  <span className="track-title">{c.tracks?.title ?? "unknown track"}</span>
                  {c.tracks?.artist_id && (
                    <Link href={`/artist/${c.tracks.artist_id}`} className="feature-tag" style={{ textDecoration: "none" }}>
                      {c.tracks.artists?.name ?? "unknown artist"}
                    </Link>
                  )}
                </div>
              ))}
            </Section>
          )}

          {profile.show_ratings && (
            <Section title="Ratings" count={rated.length}>
              {rated.map((r) => (
                <div key={r.track_id} className="track-row" style={{ cursor: "default" }}>
                  <span className="track-title">{r.tracks?.title ?? "unknown track"}</span>
                  {r.tracks?.artist_id && (
                    <Link href={`/artist/${r.tracks.artist_id}`} className="feature-tag" style={{ textDecoration: "none" }}>
                      {r.tracks.artists?.name ?? "unknown artist"}
                    </Link>
                  )}
                  <span className="rating-chip rated">{r.value}/10</span>
                </div>
              ))}
            </Section>
          )}

          {profile.show_followed_artists && (
            <Section title="Following" count={followedArtists.length}>
              <div className="grid" style={{ marginTop: 4 }}>
                {followedArtists.map((f) => (
                  <Link key={f.artist_id} href={`/artist/${f.artist_id}`} className="card">
                    <div className="name" style={{ fontSize: "1.2rem" }}>
                      {f.artists?.name ?? "unknown artist"}
                    </div>
                  </Link>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
