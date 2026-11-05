"use client";
import "../../styles/profile-menu.css";

// Someone's profile: a hero (their artists sliding across the top, big avatar, name, badges, counts, bio),
// then two columns: their music (showcase, collection progress, recently
// collected, ratings, lists) and the side (contributions, artists they
// follow, friends). Premium people's colour runs through it (--pf).

import ProfileNetwork from "./ProfileNetwork";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePersonalUser } from "../../useIsAdmin";
import Contributions from "./Contributions";
import ProfileLists from "./ProfileLists";
import ShareButton from "../../components/ShareButton";
import { profileCard } from "../../components/cards";
import Supporter from "../../components/Supporter";
import HeroCollage from "../../components/HeroCollage";
import { useProfileStyle, Showcase, EditProfile } from "./PremiumProfile";
import { usePremium } from "../../usePremium";
import { thumb } from "@/lib/thumb";

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
  fan_artists: string[];
};
type TrackRef = { title: string; artist_id: string; cover_url: string | null; artists: { name: string } | null } | null;
type CollectedTrack = { track_id: string; tracks: TrackRef };
type RatedTrack = { track_id: string; value: number; tracks: TrackRef };
type FollowedArtist = { artist_id: string; artists: { name: string; image_url: string | null; tag: string | null } | null };
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
  const [editing, setEditing] = useState(false);
  // Following people: one way. Friends: following each other. Friends see
  // each other's collection, ratings and artists even when they're private.
  const [social, setSocial] = useState<Social | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [allCollected, setAllCollected] = useState(false);
  const [allRated, setAllRated] = useState(false);
  const [allArtists, setAllArtists] = useState(false);
  const [tab, setTab] = useState<"overview" | "collection" | "contributions" | "network">("overview");
  const [more, setMore] = useState(false);
  const [contribTotal, setContribTotal] = useState<number | null>(null);
  // Premium look (colour, showcase), shown only while they have premium.
  const { style: pstyle, reload: reloadStyle } = useProfileStyle(userId);
  const accent = pstyle?.premium ? pstyle.accent ?? null : null;
  const { premium: iAmPremium } = usePremium();

  useEffect(() => {
    async function load() {
      const { data: profileRow, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, about, show_completion_pct, show_collected_tracks, show_ratings, show_followed_artists, show_contributions, fan_artists")
        .eq("id", userId)
        .single();
      if (error || !profileRow) {
        setNotFound(true);
        return;
      }
      setProfile(profileRow as Profile);
      supabase.rpc("rpc_profile_social", { p_user: userId }).then(({ data }) => setSocial((data as Social) ?? null));
      supabase.rpc("rpc_user_contributions", { p_user: userId }).then(({ data }) => {
        const d = data as { visible?: boolean; total?: number } | null;
        setContribTotal(d?.visible ? d.total ?? 0 : null);
      });

      // Private sections are still asked for: the database only returns them
      // to you, or to friends.
      const [statRes, colRes, rateRes, folRes] = await Promise.all([
        supabase.from("user_completion_stats").select("total_tracks, collected_tracks, followed_artists").eq("user_id", userId).maybeSingle(),
        supabase.from("track_ownership").select("track_id, tracks(title, artist_id, cover_url, artists!artist_id(name))")
          .eq("user_id", userId).order("collected_at", { ascending: false }).limit(1000),
        supabase.from("ratings").select("track_id, value, tracks(title, artist_id, cover_url, artists!artist_id(name))")
          .eq("user_id", userId).order("updated_at", { ascending: false }).limit(100),
        supabase.from("follows").select("artist_id, artists!artist_id(name, image_url, tag)").eq("user_id", userId).order("followed_at", { ascending: false }),
      ]);
      if (statRes.data) setStats(statRes.data as { total_tracks: number; collected_tracks: number; followed_artists?: number });
      setCollected((colRes.data as unknown as CollectedTrack[]) ?? []);
      setRated((rateRes.data as unknown as RatedTrack[]) ?? []);
      setFollowedArtists((folRes.data as unknown as FollowedArtist[]) ?? []);
    }
    load();
  }, [userId]);

  // A link can open a tab directly, e.g. /profile/<id>#network.
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h === "network" || h === "collection" || h === "contributions") setTab(h);
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

  if (notFound) return <div className="wrap"><div className="empty-state" style={{ marginTop: 18 }}>That profile doesn&apos;t exist.</div></div>;
  if (!profile) return <div className="wrap"><div className="empty-state" style={{ marginTop: 18 }}>loading…</div></div>;

  const pct = stats && stats.total_tracks > 0 ? Math.round((stats.collected_tracks / stats.total_tracks) * 100) : 0;
  const showCollection = !!stats && (profile.show_completion_pct || seesAll) && Number(stats.followed_artists ?? 0) > 0;
  const showCollected = (profile.show_collected_tracks || seesAll) && collected.length > 0;
  const showRated = (profile.show_ratings || seesAll) && rated.length > 0;
  const showArtists = (profile.show_followed_artists || seesAll) && followedArtists.length > 0;
  const nothingPublic = !profile.show_completion_pct && !profile.show_collected_tracks && !profile.show_ratings && !profile.show_followed_artists && !profile.show_contributions;
  const name = profile.display_name ?? "anonymous";
  const fanIds = profile.fan_artists ?? [];
  const headerPhotos = (showArtists ? [...followedArtists].sort((x, y) => Number(fanIds.includes(y.artist_id)) - Number(fanIds.includes(x.artist_id))) : [])
    .map((f) => f.artists?.image_url).filter((u): u is string => !!u).slice(0, 24);

  const followBtn = viewer && !isOwnProfile && social && (
    <button className={`tab ah2-follow ${social.i_follow ? "on" : ""}`} disabled={followBusy} onClick={toggleFollow}
      title={social.i_follow ? "Unfollow" : social.follows_me ? "They follow you: follow back to be friends" : undefined}>
      {isFriend ? "✓ Friends" : social.i_follow ? "✓ Following" : social.follows_me ? "+ Follow back" : "+ Follow"}
    </button>
  );
  const tabs: [typeof tab, string][] = [
    ["overview", "Overview"],
    ["collection", "Collection"],
    ["contributions", "Contributions"],
    ["network", "Network"],
  ];
  const coverTile = (id: string, t: TrackRef, sub?: string) => (
    <Link key={id} href={`/song/${id}`} className="pf-cover">
      {t?.cover_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={thumb(t.cover_url)} alt="" loading="lazy" />
        : <span className="pf-cover-blank">SC//</span>}
      <span className="pf-cover-title">{t?.title ?? "unknown"}</span>
      <span className="pf-cover-meta">{sub ?? t?.artists?.name ?? ""}</span>
    </Link>
  );
  const ratingRows = (count: number) => (
    <div className="pf-list">
      {rated.slice(0, count).map((r) => (
        <Link key={r.track_id} href={`/song/${r.track_id}`} className="pf-list-row">
          <span className="pf-score">{r.value}</span>
          <span style={{ flex: 1, minWidth: 0 }}>{r.tracks?.title ?? "unknown"}</span>
          <span className="comment-meta">{r.tracks?.artists?.name ?? ""}</span>
        </Link>
      ))}
    </div>
  );
  // Favourite artists: the ones they wear as fan badges.
  const favourites = fanIds.map((id) => followedArtists.find((f) => f.artist_id === id)).filter(Boolean) as FollowedArtist[];
  const showcase = pstyle?.premium ? pstyle.showcase ?? [] : [];
  const topRated = [...rated].sort((x, y) => y.value - x.value).slice(0, 6);
  const H = ({ title, onAll, label = "View all" }: { title: string; onAll?: () => void; label?: string }) => (
    <div className="sp-head hf-head"><h2>{title}</h2>{onAll && <button onClick={onAll}>{label} →</button>}</div>
  );

  return (
    <div className="wrap pf pf2" style={{ "--pf": accent ?? "#8B7CF6" } as CSSProperties}>
      {/* ---- banner: their artists sliding behind, like an artist page ---- */}
      <header className={`artist-hero ah2 has-img ${headerPhotos.length ? "ah2-has-collage" : ""}`} style={accent ? ({ "--accent": accent } as CSSProperties) : undefined}>
        {headerPhotos.length > 0 && <HeroCollage images={headerPhotos} className="pf-collage ah2-collage" />}
        <div className="artist-hero-inner ah2-inner">
          <span className="ah2-tag">Profile</span>
          <div className="ah2-id">
            {profile.avatar_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={profile.avatar_url} alt="" className="ah2-pfp" width={96} height={96} />
              : <span className="ah2-pfp pf-pfp-blank">{name.slice(0, 1).toUpperCase()}</span>}
            <h1 className="detail-name artist-hero-name">{name}</h1>
          </div>
          {profile.about && (
            <div className="pf-tagline">&ldquo;{(() => { const t = profile.about.replace(/\s*\n\s*/g, " ").trim(); return t.length > 80 ? `${t.slice(0, 79).trimEnd()}…` : t; })()}&rdquo;</div>
          )}
          {!isOwnProfile && social?.follows_me && !social.i_follow && <span className="feature-tag" style={{ marginTop: 8 }}>follows you</span>}
          <div className="pf-badges" style={{ marginTop: 10 }}><Supporter id={profile.id} full /></div>
          <div className="ah2-stats">
            {contribTotal !== null && <button onClick={() => setTab("contributions")}><strong>{n(contribTotal)}</strong><span>contributions</span></button>}
            {social && <button onClick={() => setTab("network")}><strong>{n(social.followers)}</strong><span>followers</span></button>}
            {social && <button onClick={() => setTab("network")}><strong>{n(social.following)}</strong><span>following</span></button>}
            {showCollection && <button onClick={() => setTab("collection")}><strong>{pct}%</strong><span>collected</span></button>}
          </div>
        </div>
      </header>


      <div className="artist-actions ah2-actions">
        {followBtn}
        {isOwnProfile && (
          <button className={`tab ah2-follow ${editing ? "" : "on"}`} onClick={() => setEditing(!editing)}>✎ {editing ? "Close editor" : "Edit profile"}</button>
        )}
        {viewer && !isOwnProfile && isFriend && <Link href={`/messages/${userId}`} className="tab sp-icon-btn" aria-label="Message">✉</Link>}
        <ShareButton title={`${profile.display_name ?? "A collector"} on Static Cuts//`} path={`/profile/${userId}`} className="tab sp-icon-btn" ariaLabel="Share"
          storyKey={`${userId}:${favourites.length}:${contribTotal ?? ""}:${social?.followers ?? ""}`}
          fileName={`static-cuts-${(profile.display_name ?? "profile").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
          image={() => profileCard({
            name: profile.display_name ?? "A collector",
            tagline: profile.about ? profile.about.replace(/\s*\n\s*/g, " ").trim().slice(0, 80) : null,
            avatar: profile.avatar_url, accent,
            stats: [
              ...(contribTotal !== null ? [[n(contribTotal), "contributions"] as [string, string]] : []),
              ...(showCollection ? [[`${pct}%`, "collected"] as [string, string]] : []),
              ...(social ? [[n(social.followers), "followers"] as [string, string]] : []),
            ],
            favourites: (favourites.length ? favourites : followedArtists.slice(0, 6)).map((f) => ({ name: f.artists?.name ?? "", image: f.artists?.image_url ?? null })),
            url: `static-cuts.com/profile/${userId}`,
          })}
          label={<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 5l7 6-7 6v-3.5c-5 0-8.5 1.5-11 5 1-5 4-9.5 11-10.5z" /></svg>} />
        {isOwnProfile && (
          <button className={`tab sp-icon-btn ${more ? "active" : ""}`} aria-label="More" aria-expanded={more} onClick={() => setMore(!more)}>•••</button>
        )}
      </div>
      {more && isOwnProfile && (
        <nav className="pf-menu" aria-label="More">
          <Link href="/year" className="pf-menu-item">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" /></svg>
            <span><strong>Your year//</strong><small>Your top artists, songs and finds, ready to share.</small></span>
          </Link>
          <Link href="/my-submissions" className="pf-menu-item">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
            <span><strong>My submissions</strong><small>Everything you&apos;ve suggested and where it&apos;s got to.</small></span>
          </Link>
          <Link href="/settings" className="pf-menu-item">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>
            <span><strong>Settings</strong><small>Privacy, notifications, connections and your data.</small></span>
          </Link>
        </nav>
      )}

      {isOwnProfile && editing && pstyle && (
        <EditProfile userId={userId} profile={profile} style={pstyle} premium={!!pstyle.premium || !!iAmPremium}
          followed={followedArtists.map((f) => ({ artist_id: f.artist_id, name: f.artists?.name ?? "unknown", tag: f.artists?.tag ?? null }))}
          onClose={() => setEditing(false)} onStyle={reloadStyle}
          onProfile={(p) => setProfile((prev) => (prev ? { ...prev, ...p } : prev))} />
      )}

      {nothingPublic && !seesAll && (
        <div className="empty-state" style={{ marginTop: 16 }}>This user hasn&apos;t made anything public on their profile yet.</div>
      )}

      <nav className="ap-tabs" aria-label="Profile sections">
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : undefined} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>
        ))}
      </nav>

      {tab === "overview" && (
        <>
          {favourites.length > 0 && (
            <>
              <H title="Favourite artists" />
              <div className="pf-favs">
                {favourites.map((f) => (
                  <Link key={f.artist_id} href={`/artist/${f.artist_id}`} className="pf-fav">
                    <Avatar url={f.artists?.image_url ?? null} size={84} name={f.artists?.name} />
                    <span>{f.artists?.name ?? "unknown"}</span>
                    {f.artists?.tag && <span className="pf-fav-tag">{f.artists.tag}</span>}
                  </Link>
                ))}
              </div>
            </>
          )}

          {showcase.length > 0 ? (
            <>
              <H title="Songs" />
              <Showcase songs={showcase} accent={accent} bare />
            </>
          ) : showRated && topRated.length > 0 && (
            <>
              <H title="Top songs" onAll={() => setTab("collection")} />
              <div className="pf-covers">{topRated.map((r) => coverTile(r.track_id, r.tracks, `${r.tracks?.artists?.name ?? ""} · ★ ${r.value}`))}</div>
            </>
          )}

          <div className="pf-panel pf-panel-loose pf-lists2"><ProfileLists userId={userId} /></div>

          {showArtists && (
            <>
              <H title={`Artists followed (${n(followedArtists.length)})`} onAll={followedArtists.length > 18 ? () => setAllArtists(!allArtists) : undefined} label={allArtists ? "Less" : "All"} />
              <div className="pf-artists">
                {followedArtists.slice(0, allArtists ? 500 : 18).map((f) => (
                  <Link key={f.artist_id} href={`/artist/${f.artist_id}`} className="pf-artist" title={f.artists?.name ?? ""}>
                    <Avatar url={f.artists?.image_url ?? null} size={56} name={f.artists?.name} />
                    <span>{f.artists?.name ?? "unknown"}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {tab === "collection" && (
        <>
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
            <>
              <H title={`Recently collected · ${n(collected.length)}${collected.length >= 1000 ? "+" : ""}`}
                onAll={collected.length > 12 ? () => setAllCollected(!allCollected) : undefined} label={allCollected ? "Less" : "More"} />
              <div className="pf-covers">{collected.slice(0, allCollected ? 60 : 12).map((c) => coverTile(c.track_id, c.tracks))}</div>
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
            </>
          )}
          {showRated && (
            <>
              <H title={`Ratings · ${n(rated.length)}`} onAll={rated.length > 8 ? () => setAllRated(!allRated) : undefined} label={allRated ? "Less" : "All"} />
              {ratingRows(allRated ? 100 : 8)}
            </>
          )}
          {!showCollection && !showCollected && !showRated && <div className="empty-state">Nothing to show here.</div>}
        </>
      )}

      {tab === "contributions" && (
        <>
          {isOwnProfile && (
            <Link href="/my-submissions" className="lb-card pf-subs-link">
              <span className="sp-version-text">
                <strong>My submissions</strong>
                <span>Everything you&apos;ve suggested: pending, approved and rejected, with moderator notes.</span>
              </span>
              <span aria-hidden="true" className="hf-chev">›</span>
            </Link>
          )}
          {contribTotal === null && <div className="empty-state">Contributions are private.</div>}
          {contribTotal !== null && (
            <>
              <div className="pf-contrib"><Contributions userId={userId} /></div>
              <H title="Recent contributions" />
              <Contributions userId={userId} mode="activity" limit={30} />
            </>
          )}
        </>
      )}

      {tab === "network" && social && (
        <ProfileNetwork userId={userId} isOwn={isOwnProfile} viewerId={viewer?.id ?? null} social={social}
          onChange={() => supabase.rpc("rpc_profile_social", { p_user: userId }).then(({ data }) => setSocial((data as Social) ?? null))} />
      )}

      {isOwnProfile && (
        <div className="comment-meta" style={{ lineHeight: 1.6, marginTop: 24 }}>
          Visitors only see what you&apos;ve turned on in <Link href="/settings" className="text-link">privacy settings</Link>.
          Friends (people you follow who follow you back) see everything.
        </div>
      )}
    </div>
  );
}
