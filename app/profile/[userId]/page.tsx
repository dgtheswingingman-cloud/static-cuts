"use client";

// Someone's profile: a hero (banner, big avatar, name, badge, counts, bio),
// then two columns: their music (showcase, collection progress, recently
// collected, ratings, lists) and the side (contributions, artists they
// follow, friends). Premium people's colour runs through it (--pf).

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePersonalUser } from "../../useIsAdmin";
import Contributions from "./Contributions";
import ProfileLists from "./ProfileLists";
import ShareButton from "../../components/ShareButton";
import Supporter from "../../components/Supporter";
import { useProfileStyle, Showcase, CustomiseProfile, PremiumTeaser } from "./PremiumProfile";
import { usePremium } from "../../usePremium";

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
type TrackRef = { title: string; artist_id: string; cover_url: string | null; artists: { name: string } | null } | null;
type CollectedTrack = { track_id: string; tracks: TrackRef };
type RatedTrack = { track_id: string; value: number; tracks: TrackRef };
type FollowedArtist = { artist_id: string; artists: { name: string; image_url: string | null } | null };
type Social = { followers: number; following: number; i_follow: boolean; follows_me: boolean; friends: { id: string; name: string | null; avatar_url: string | null }[] };

const n = (x: number) => x.toLocaleString("en-GB");

function Panel({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="pf-panel">
      <div className="pf-panel-head">
        <span>{title}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

function Avatar({ url, size, name }: { url: string | null; size: number; name?: string | null }) {
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt="" className="pf-av" style={{ width: size, height: size }} />
    : <span className="pf-av pf-av-blank" style={{ width: size, height: size, fontSize: size / 2.6 }}>{(name ?? "?").slice(0, 1).toUpperCase()}</span>;
}

export default function ProfilePage() {
  const params = useParams();
  const viewer = usePersonalUser();
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
  const [social, setSocial] = useState<Social | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [allCollected, setAllCollected] = useState(false);
  const [allRated, setAllRated] = useState(false);
  const [allArtists, setAllArtists] = useState(false);
  // Premium look (banner, colour, showcase), shown only while they have premium.
  const { style: pstyle, reload: reloadStyle } = useProfileStyle(userId);
  const accent = pstyle?.premium ? pstyle.accent ?? null : null;
  const { premium: iAmPremium } = usePremium();

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
      const [statRes, colRes, rateRes, folRes] = await Promise.all([
        supabase.from("user_completion_stats").select("total_tracks, collected_tracks, followed_artists").eq("user_id", userId).maybeSingle(),
        supabase.from("track_ownership").select("track_id, tracks(title, artist_id, cover_url, artists!artist_id(name))")
          .eq("user_id", userId).order("collected_at", { ascending: false }).limit(1000),
        supabase.from("ratings").select("track_id, value, tracks(title, artist_id, cover_url, artists!artist_id(name))")
          .eq("user_id", userId).order("updated_at", { ascending: false }).limit(100),
        supabase.from("follows").select("artist_id, artists!artist_id(name, image_url)").eq("user_id", userId).order("followed_at", { ascending: false }),
      ]);
      if (statRes.data) setStats(statRes.data as { total_tracks: number; collected_tracks: number; followed_artists?: number });
      setCollected((colRes.data as unknown as CollectedTrack[]) ?? []);
      setRated((rateRes.data as unknown as RatedTrack[]) ?? []);
      setFollowedArtists((folRes.data as unknown as FollowedArtist[]) ?? []);
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
    if (file.type === "image/gif" && !iAmPremium) { alert("GIF avatars are a premium perk."); return; }

    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${viewer.id}/avatar.${ext}`;
    const { error: uploadErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (uploadErr) { alert(uploadErr.message); setUploading(false); return; }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const freshUrl = `${data.publicUrl}?t=${Date.now()}`;
    const { error: saveErr } = await supabase.from("profiles").update({ avatar_url: freshUrl }).eq("id", viewer.id);
    if (saveErr) { alert(saveErr.message); setUploading(false); return; }
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

  if (notFound) return <div className="wrap"><div className="empty-state" style={{ marginTop: 18 }}>That profile doesn&apos;t exist.</div></div>;
  if (!profile) return <div className="wrap"><div className="empty-state" style={{ marginTop: 18 }}>loading…</div></div>;

  const pct = stats && stats.total_tracks > 0 ? Math.round((stats.collected_tracks / stats.total_tracks) * 100) : 0;
  const showCollection = !!stats && (profile.show_completion_pct || seesAll) && Number(stats.followed_artists ?? 0) > 0;
  const showCollected = (profile.show_collected_tracks || seesAll) && collected.length > 0;
  const showRated = (profile.show_ratings || seesAll) && rated.length > 0;
  const showArtists = (profile.show_followed_artists || seesAll) && followedArtists.length > 0;
  const nothingPublic = !profile.show_completion_pct && !profile.show_collected_tracks && !profile.show_ratings && !profile.show_followed_artists && !profile.show_contributions;
  const name = profile.display_name ?? "anonymous";
  const banner = pstyle?.premium ? pstyle.banner_url : null;

  return (
    <div className="wrap pf" style={{ "--pf": accent ?? "#8B7CF6" } as CSSProperties}>
      {/* ---- hero ---- */}
      <div className={`pf-banner${banner ? "" : " pf-banner-plain"}`}>
        {banner && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={banner} alt="" />
        )}
      </div>

      <div className="pf-hero">
        <div className="pf-avatar-wrap">
          <Avatar url={profile.avatar_url} size={132} name={name} />
          {isOwnProfile && (
            <>
              <input type="file" accept="image/*" id="avatarInput" style={{ display: "none" }}
                onChange={(e) => { if (e.target.files?.[0]) uploadAvatar(e.target.files[0]); }} />
              <label htmlFor="avatarInput" className="tab pf-avatar-edit">{uploading ? "…" : "edit"}</label>
            </>
          )}
        </div>

        <div className="pf-id">
          {editingName ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input autoFocus className="search-input" style={{ maxWidth: 260 }} value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }} />
              <button className="tab active" disabled={savingName} onClick={saveName}>{savingName ? "…" : "save"}</button>
              <button className="tab" onClick={() => setEditingName(false)}>cancel</button>
            </div>
          ) : (
            <div className="pf-name-row">
              <h1 className="pf-name">{name}</h1>
              <Supporter id={profile.id} full />
              {!isOwnProfile && social?.follows_me && !social.i_follow && <span className="feature-tag">follows you</span>}
            </div>
          )}
          {social && (
            <div className="pf-counts">
              <span><b>{n(social.followers)}</b> follower{social.followers === 1 ? "" : "s"}</span>
              <span><b>{n(social.following)}</b> following</span>
              <span><b>{n(social.friends.length)}</b> friend{social.friends.length === 1 ? "" : "s"}</span>
              {showCollection && <span><b>{pct}%</b> collected</span>}
            </div>
          )}
        </div>

        <div className="pf-actions">
          {viewer && !isOwnProfile && social && (
            <button className={`tab ${social.i_follow ? "" : "active"}`} disabled={followBusy} onClick={toggleFollow}
              title={social.i_follow ? "Unfollow" : social.follows_me ? "They follow you: follow back to be friends" : undefined}>
              {isFriend ? "friends ✓" : social.i_follow ? "following" : social.follows_me ? "follow back" : "follow"}
            </button>
          )}
          {viewer && !isOwnProfile && isFriend && <Link href={`/messages/${userId}`} className="tab pf-btn">message</Link>}
          {isOwnProfile && !editingName && <button className="tab" onClick={() => { setNameDraft(profile.display_name ?? ""); setEditingName(true); }}>edit name</button>}
          {isOwnProfile && <Link href="/settings" className="tab pf-btn">settings</Link>}
          {isOwnProfile && <Link href="/year" className="tab pf-btn">your year</Link>}
          <ShareButton title={`${profile.display_name ?? "A collector"} on Static Cuts//`} label="share" />
        </div>
      </div>

      {editingAbout ? (
        <div style={{ maxWidth: 560, margin: "6px 0 16px" }}>
          <textarea className="comment-textarea" autoFocus value={aboutDraft} onChange={(e) => setAboutDraft(e.target.value)}
            placeholder="A short bio, what you're into, whatever you want…" maxLength={500} style={{ marginBottom: 8 }} />
          <button className="tab active" disabled={savingAbout} onClick={saveAbout}>{savingAbout ? "…" : "save"}</button>{" "}
          <button className="tab" onClick={() => setEditingAbout(false)}>cancel</button>
        </div>
      ) : (profile.about || isOwnProfile) && (
        <div className="pf-bio">
          {profile.about || (isOwnProfile ? <span style={{ color: "var(--smoke)" }}>No bio yet.</span> : null)}
          {isOwnProfile && (
            <button className="tab" style={{ marginLeft: 10, fontSize: "0.6rem", padding: "2px 6px" }}
              onClick={() => { setAboutDraft(profile.about ?? ""); setEditingAbout(true); }}>edit</button>
          )}
        </div>
      )}

      {isOwnProfile && pstyle?.premium && (
        <div style={{ marginBottom: 16 }}><CustomiseProfile userId={userId} style={pstyle} onSaved={reloadStyle} /></div>
      )}

      {nothingPublic && !seesAll && (
        <div className="empty-state" style={{ marginTop: 16 }}>This user hasn&apos;t made anything public on their profile yet.</div>
      )}

      {/* ---- two columns ---- */}
      <div className="pf-grid">
        <div className="pf-main">
          {pstyle?.premium && (pstyle.showcase ?? []).length > 0 && (
            <Panel title="Showcase"><Showcase songs={pstyle.showcase ?? []} accent={accent} bare /></Panel>
          )}

          {showCollection && stats && (
            <Panel title="Collection">
              <div className="pf-progress">
                <div className="pf-progress-pct">{pct}%</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="comment-meta" style={{ marginBottom: 8 }}>
                    {n(Number(stats.collected_tracks))} of {n(Number(stats.total_tracks))} songs from the {n(Number(stats.followed_artists ?? 0))} artist
                    {Number(stats.followed_artists) === 1 ? "" : "s"} {isOwnProfile ? "you follow" : "they follow"}
                  </div>
                  <div className="pf-bar"><div style={{ width: `${pct}%` }} /></div>
                </div>
              </div>
            </Panel>
          )}

          {showCollected && (
            <Panel title={`Recently collected · ${n(collected.length)}${collected.length >= 1000 ? "+" : ""}`}
              right={collected.length > 12 && <button className="tab" onClick={() => setAllCollected(!allCollected)}>{allCollected ? "less" : "see more"}</button>}>
              <div className="pf-covers">
                {collected.slice(0, allCollected ? 60 : 12).map((c) => (
                  <Link key={c.track_id} href={`/song/${c.track_id}`} className="pf-cover">
                    {c.tracks?.cover_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={c.tracks.cover_url} alt="" loading="lazy" />
                      : <span className="pf-cover-blank">SC//</span>}
                    <span className="pf-cover-title">{c.tracks?.title ?? "unknown"}</span>
                    <span className="pf-cover-meta">{c.tracks?.artists?.name ?? ""}</span>
                  </Link>
                ))}
              </div>
              {allCollected && collected.length > 60 && (
                <div className="pf-list">
                  {collected.slice(60).map((c) => (
                    <Link key={c.track_id} href={`/song/${c.track_id}`} className="pf-list-row">
                      <span style={{ flex: 1, minWidth: 0 }}>{c.tracks?.title ?? "unknown"}</span>
                      <span className="comment-meta">{c.tracks?.artists?.name ?? ""}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>
          )}

          {showRated && (
            <Panel title={`Ratings · ${n(rated.length)}`}
              right={rated.length > 8 && <button className="tab" onClick={() => setAllRated(!allRated)}>{allRated ? "less" : "see all"}</button>}>
              <div className="pf-list">
                {rated.slice(0, allRated ? 100 : 8).map((r) => (
                  <Link key={r.track_id} href={`/song/${r.track_id}`} className="pf-list-row">
                    <span className="pf-score">{r.value}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>{r.tracks?.title ?? "unknown"}</span>
                    <span className="comment-meta">{r.tracks?.artists?.name ?? ""}</span>
                  </Link>
                ))}
              </div>
            </Panel>
          )}

          <div className="pf-panel pf-panel-loose"><ProfileLists userId={userId} /></div>
        </div>

        <aside className="pf-side">
          {isOwnProfile && pstyle && !pstyle.premium && <PremiumTeaser />}

          <div className="pf-panel pf-panel-loose pf-contrib"><Contributions userId={userId} /></div>

          {showArtists && (
            <Panel title={`Following · ${n(followedArtists.length)}`}
              right={followedArtists.length > 12 && <button className="tab" onClick={() => setAllArtists(!allArtists)}>{allArtists ? "less" : "all"}</button>}>
              <div className="pf-artists">
                {followedArtists.slice(0, allArtists ? 500 : 12).map((f) => (
                  <Link key={f.artist_id} href={`/artist/${f.artist_id}`} className="pf-artist" title={f.artists?.name ?? ""}>
                    <Avatar url={f.artists?.image_url ?? null} size={56} name={f.artists?.name} />
                    <span>{f.artists?.name ?? "unknown"}</span>
                  </Link>
                ))}
              </div>
            </Panel>
          )}

          {social && social.friends.length > 0 && (
            <Panel title={`Friends · ${n(social.friends.length)}`}>
              <div className="pf-list">
                {social.friends.map((f) => (
                  <Link key={f.id} href={`/profile/${f.id}`} className="pf-list-row" style={{ alignItems: "center" }}>
                    <Avatar url={f.avatar_url} size={32} name={f.name} />
                    <span style={{ flex: 1 }}>{f.name ?? "anonymous"}<Supporter id={f.id} /></span>
                  </Link>
                ))}
              </div>
            </Panel>
          )}

          {isOwnProfile && (
            <div className="comment-meta" style={{ lineHeight: 1.6, padding: "0 2px" }}>
              Visitors only see what you&apos;ve turned on in <Link href="/settings" className="text-link">privacy settings</Link>.
              Friends (people you follow who follow you back) see everything.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
