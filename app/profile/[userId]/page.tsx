"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../../useIsAdmin";
import Contributions from "./Contributions";
import ProfileLists from "./ProfileLists";
import ShareButton from "../../components/ShareButton";

type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  about: string | null;
  show_completion_pct: boolean;
  show_collected_tracks: boolean;
  show_ratings: boolean;
  show_followed_artists: boolean;
  show_contributions: boolean;
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
  const viewer = usePersonalUser();
  const isAdmin = useIsAdmin();
  const userId = params.userId as string;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [stats, setStats] = useState<{ total_tracks: number; collected_tracks: number; followed_artists?: number } | null>(null);
  const [collected, setCollected] = useState<CollectedTrack[]>([]);
  const [rated, setRated] = useState<RatedTrack[]>([]);
  const [followedArtists, setFollowedArtists] = useState<FollowedArtist[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingAbout, setEditingAbout] = useState(false);
  const [aboutDraft, setAboutDraft] = useState("");
  const [savingAbout, setSavingAbout] = useState(false);
  // Following people: one way. Friends: following each other. Friends see
  // each other's collection, ratings and artists even when they're private.
  type Social = { followers: number; following: number; i_follow: boolean; follows_me: boolean; friends: { id: string; name: string | null; avatar_url: string | null }[] };
  const [social, setSocial] = useState<Social | null>(null);
  const [followBusy, setFollowBusy] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: profileRow, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, about, show_completion_pct, show_collected_tracks, show_ratings, show_followed_artists, show_contributions")
        .eq("id", userId)
        .single();
      if (error || !profileRow) {
        setNotFound(true);
        return;
      }
      setProfile(profileRow as Profile);
      supabase.rpc("rpc_profile_social", { p_user: userId }).then(({ data }) => setSocial((data as Social) ?? null));

      // Private sections are still asked for: the database only returns them
      // to you, or to friends.
      {
        const { data: statRow } = await supabase
          .from("user_completion_stats")
          .select("total_tracks, collected_tracks, followed_artists")
          .eq("user_id", userId)
          .maybeSingle();
        if (statRow) setStats(statRow as any);
      }

      {
        const { data } = await supabase
          .from("track_ownership")
          .select("track_id, tracks(title, artist_id, artists!artist_id(name))")
          .eq("user_id", userId)
          .order("collected_at", { ascending: false })
          .limit(1000);
        setCollected((data as any) ?? []);
      }

      {
        const { data } = await supabase
          .from("ratings")
          .select("track_id, value, tracks(title, artist_id, artists!artist_id(name))")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(100);
        setRated((data as any) ?? []);
      }

      {
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
  const isFriend = !!social?.i_follow && !!social?.follows_me;
  const seesAll = isOwnProfile || isFriend;

  async function toggleFollow() {
    if (!viewer || !social) return;
    setFollowBusy(true);
    const { error: err } = social.i_follow
      ? await supabase.from("user_follows").delete().eq("follower", viewer.id).eq("followee", userId)
      : await supabase.from("user_follows").insert({ follower: viewer.id, followee: userId });
    if (!err) {
      const { data } = await supabase.rpc("rpc_profile_social", { p_user: userId });
      setSocial((data as Social) ?? null);
    }
    setFollowBusy(false);
  }

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

  async function uploadAvatar(file: File) {
    if (!viewer) return;
    const MAX_SIZE = 5 * 1024 * 1024;
    const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!ALLOWED_TYPES.includes(file.type)) { alert("Please upload a PNG, JPEG, WEBP, or GIF image."); return; }
    if (file.size > MAX_SIZE) { alert("Image is too large — 5MB max."); return; }

    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${viewer.id}/avatar.${ext}`;
    const { error: uploadErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (uploadErr) { alert(uploadErr.message); setUploading(false); return; }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const freshUrl = `${data.publicUrl}?t=${Date.now()}`;
    await supabase.from("profiles").update({ avatar_url: freshUrl }).eq("id", viewer.id);
    setProfile((prev) => (prev ? { ...prev, avatar_url: freshUrl } : prev));
    setUploading(false);
  }

  async function saveAbout() {
    if (!viewer) return;
    setSavingAbout(true);
    const trimmed = aboutDraft.trim();
    await supabase.from("profiles").update({ about: trimmed }).eq("id", viewer.id);
    setSavingAbout(false);
    setProfile((prev) => (prev ? { ...prev, about: trimmed } : prev));
    setEditingAbout(false);
  }

  const pct = stats && stats.total_tracks > 0 ? Math.round((stats.collected_tracks / stats.total_tracks) * 100) : 0;
  const nothingPublic =
    !profile?.show_completion_pct &&
    !profile?.show_collected_tracks &&
    !profile?.show_ratings &&
    !profile?.show_followed_artists &&
    !profile?.show_contributions;

  return (
    <div className="wrap">

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
              <div style={{ position: "relative" }}>
                {profile.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.avatar_url}
                    alt=""
                    style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: "1.5px solid var(--hair)" }}
                  />
                ) : isOwnProfile ? (
                  <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--surface)", border: "1.5px solid var(--hair)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ color: "var(--smoke)", fontFamily: "var(--font-mono)", fontSize: "0.6rem" }}>none</span>
                  </div>
                ) : null}
                {isOwnProfile && (
                  <>
                    <input
                      type="file"
                      accept="image/*"
                      id="avatarInput"
                      style={{ display: "none" }}
                      onChange={(e) => { if (e.target.files?.[0]) uploadAvatar(e.target.files[0]); }}
                    />
                    <label
                      htmlFor="avatarInput"
                      className="tab"
                      style={{ position: "absolute", bottom: -6, right: -6, cursor: "pointer", padding: "2px 5px", fontSize: "0.55rem" }}
                    >
                      {uploading ? "…" : "edit"}
                    </label>
                  </>
                )}
              </div>
              <h1 className="detail-name" style={{ margin: 0 }}>{profile.display_name ?? "anonymous"}</h1>
              <ShareButton title={`${profile.display_name ?? "A collector"} on Static Cuts//`} label="share profile" />
            </div>
          )}

          {social && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
              <span className="comment-meta">
                {social.followers.toLocaleString("en-GB")} follower{social.followers === 1 ? "" : "s"} · {social.following.toLocaleString("en-GB")} following
                {social.friends.length > 0 && <> · {social.friends.length} friend{social.friends.length === 1 ? "" : "s"}</>}
              </span>
              {viewer && !isOwnProfile && (
                <button className={`tab ${social.i_follow ? "active" : ""}`} disabled={followBusy} onClick={toggleFollow}
                  title={social.i_follow ? "Unfollow" : social.follows_me ? "They follow you: follow back to be friends" : undefined}>
                  {isFriend ? "friends ✓" : social.i_follow ? "following" : social.follows_me ? "follow back" : "follow"}
                </button>
              )}
              {!isOwnProfile && social.follows_me && !social.i_follow && <span className="feature-tag">follows you</span>}
              {isOwnProfile && (
                <Link href="/friends" className="tab" style={{ textDecoration: "none", display: "inline-block" }}>friends&apos; activity</Link>
              )}
            </div>
          )}

          {editingAbout ? (
            <div style={{ maxWidth: 480, marginBottom: 16 }}>
              <textarea
                className="comment-textarea"
                autoFocus
                value={aboutDraft}
                onChange={(e) => setAboutDraft(e.target.value)}
                placeholder="A short bio, what you're into, whatever you want…"
                maxLength={500}
                style={{ marginBottom: 8 }}
              />
              <button className="tab active" disabled={savingAbout} onClick={saveAbout}>
                {savingAbout ? "…" : "save"}
              </button>{" "}
              <button className="tab" onClick={() => setEditingAbout(false)}>cancel</button>
            </div>
          ) : (
            (profile.about || isOwnProfile) && (
              <div style={{ fontFamily: "var(--font-inter)", fontSize: "0.88rem", color: "var(--smoke)", maxWidth: 480, marginBottom: 16, lineHeight: 1.5 }}>
                {profile.about ?? (isOwnProfile ? "No about yet." : "")}
                {isOwnProfile && (
                  <button
                    className="tab"
                    style={{ marginLeft: 10, fontSize: "0.6rem", padding: "2px 6px" }}
                    onClick={() => { setAboutDraft(profile.about ?? ""); setEditingAbout(true); }}
                  >
                    edit
                  </button>
                )}
              </div>
            )
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
                settings
              </Link>
              <Link href="/year" className="tab" style={{ textDecoration: "none", display: "inline-block" }}>
                your year
              </Link>
            </div>
          )}

          {isOwnProfile && (
            <div className="detail-meta" style={{ marginBottom: 16 }}>
              This is your own profile — visitors only see what you&apos;ve turned on in privacy
              settings. Friends (people you follow who follow you back) see everything.
            </div>
          )}

          <Contributions userId={userId} />
          <ProfileLists userId={userId} />

          {stats && (profile.show_completion_pct || seesAll) && (
            <div style={{ marginBottom: 20 }}>
              <div className="detail-meta">
                {Number(stats.followed_artists ?? 0) === 0
                  ? "Not following any artists yet, so there's nothing to collect towards."
                  : <>{Number(stats.collected_tracks).toLocaleString("en-GB")} / {Number(stats.total_tracks).toLocaleString("en-GB")} songs
                    collected from the {Number(stats.followed_artists).toLocaleString("en-GB")} artist{Number(stats.followed_artists) === 1 ? "" : "s"}{" "}
                    {isOwnProfile ? "you follow" : "they follow"} ({pct}%)</>}
              </div>
              <div className="bar-track" style={{ height: 4 }}>
                <div className="bar-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          {social && social.friends.length > 0 && (
            <Section title="Friends" count={social.friends.length}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                {social.friends.map((f) => (
                  <Link key={f.id} href={`/profile/${f.id}`} style={{ display: "flex", gap: 8, alignItems: "center", textDecoration: "none", color: "var(--bone)" }}>
                    {f.avatar_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={f.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} />
                      : <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--surface)", display: "inline-block" }} />}
                    <span style={{ fontFamily: "var(--font-inter)", fontSize: "0.88rem" }}>{f.name ?? "anonymous"}</span>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {nothingPublic && !seesAll && (
            <div className="empty-state" style={{ marginTop: 16 }}>
              This user hasn&apos;t made anything public on their profile yet.
            </div>
          )}

          {(profile.show_collected_tracks || seesAll) && (
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

          {(profile.show_ratings || seesAll) && (
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

          {(profile.show_followed_artists || seesAll) && (
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
