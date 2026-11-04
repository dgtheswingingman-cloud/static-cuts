"use client";

// Someone's profile: a hero (their artists sliding across the top, big avatar, name, badges, counts, bio),
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
import HeroCollage from "../../components/HeroCollage";
import { useProfileStyle, Showcase, EditProfile } from "./PremiumProfile";
import { usePremium } from "../../usePremium";
import Leaderboard from "../../components/Leaderboard";

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
  const [tab, setTab] = useState<"activity" | "collection" | "lists" | "contributions" | "network">("activity");
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
    <button className={`tab pf-main-btn ${social.i_follow ? "on" : ""}`} disabled={followBusy} onClick={toggleFollow}
      title={social.i_follow ? "Unfollow" : social.follows_me ? "They follow you: follow back to be friends" : undefined}>
      {isFriend ? "Friends ✓" : social.i_follow ? "Following" : social.follows_me ? "Follow back" : "Follow"}
    </button>
  );
  const tabs: [typeof tab, string, string][] = [
    ["activity", "Activity", "⌁"],
    ["collection", "Collection", "◎"],
    ["lists", "Lists", "≡"],
    ["contributions", "Contributions", "✎"],
    ["network", "Network", "☺"],
  ];
  const collectedCovers = (count: number) => (
    <div className="pf-covers">
      {collected.slice(0, count).map((c) => (
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
  const network = social && (
    <div className="sp-versions">
      <button className="hf-trend pf-net" onClick={() => setTab("network")}>
        <span className="pf-act-icon" aria-hidden="true">☺</span><span className="hf-trend-name">Following <em>({n(social.following)})</em></span><span aria-hidden="true" className="hf-chev">›</span>
      </button>
      <button className="hf-trend pf-net" onClick={() => setTab("network")}>
        <span className="pf-act-icon" aria-hidden="true">☺</span><span className="hf-trend-name">Followers <em>({n(social.followers)})</em></span><span aria-hidden="true" className="hf-chev">›</span>
      </button>
      <Link href="/friends" className="hf-trend pf-net">
        <span className="pf-act-icon" aria-hidden="true">⌕</span>
        <span className="sp-version-text"><span className="hf-trend-name">Find people</span><span className="sp-sub">friends and people with similar taste</span></span>
        <span aria-hidden="true" className="hf-chev">›</span>
      </Link>
    </div>
  );

  return (
    <div className="wrap pf pf2" style={{ "--pf": accent ?? "#8B7CF6" } as CSSProperties}>
      <div className="sr-top">
        <div className="sr-title" aria-hidden="true">PROFILE<span>//</span></div>
        <div className="rd-sub">Profile / activity / network / contributions</div>
      </div>

      {/* ---- the card: their artists sliding behind, photo, name, numbers, badges ---- */}
      <section className="pf-card">
        {headerPhotos.length > 0 && <HeroCollage images={headerPhotos} className="pf-collage pf-card-collage" />}
        <div className="pf-card-inner">
          <div className="pf-card-photo">
            {profile.avatar_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={profile.avatar_url} alt="" />
              : <span className="pf-av-blank">{name.slice(0, 1).toUpperCase()}</span>}
          </div>
          <div className="pf-card-body">
            <div className="pf-card-top">
              <h1 className="pf-name">{name}</h1>
              <div className="pf-card-actions">
                {followBtn}
                {viewer && !isOwnProfile && isFriend && <Link href={`/messages/${userId}`} className="tab pf-icon-btn" aria-label="Message">✉</Link>}
                {isOwnProfile && (
                  <button className={`tab pf-main-btn ${editing ? "on" : ""}`} onClick={() => setEditing(!editing)}>✎ {editing ? "Close editor" : "Edit profile"}</button>
                )}
                <button className={`tab pf-icon-btn ${more ? "active" : ""}`} aria-label="More" aria-expanded={more} onClick={() => setMore(!more)}>•••</button>
              </div>
            </div>
            {!isOwnProfile && social?.follows_me && !social.i_follow && <span className="feature-tag">follows you</span>}
            {profile.about && <div className="pf-bio">{profile.about}</div>}
            <div className="pf-card-stats">
              {contribTotal !== null && <button onClick={() => setTab("contributions")}><strong>{n(contribTotal)}</strong><span>contributions</span></button>}
              {social && <button onClick={() => setTab("network")}><strong>{n(social.followers)}</strong><span>followers</span></button>}
              {social && <button onClick={() => setTab("network")}><strong>{n(social.following)}</strong><span>following</span></button>}
              {showCollection && <button onClick={() => setTab("collection")}><strong>{pct}%</strong><span>collected</span></button>}
            </div>
            <div className="pf-badges"><Supporter id={profile.id} full /></div>
          </div>
        </div>
      </section>

      {more && (
        <div className="artist-actions artist-more" style={{ marginTop: 10 }}>
          {isOwnProfile && <Link href="/settings" className="tab">settings</Link>}
          {isOwnProfile && <Link href="/year" className="tab">your year</Link>}
          <ShareButton title={`${profile.display_name ?? "A collector"} on Static Cuts//`} label="share profile" />
        </div>
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

      <nav className="rd-chips pf-tabs" aria-label="Profile sections">
        {tabs.map(([k, label, icon]) => (
          <button key={k} className={tab === k ? "on" : undefined} aria-pressed={tab === k} onClick={() => setTab(k)}>
            <span aria-hidden="true">{icon}</span> {label}
          </button>
        ))}
      </nav>

      <div className="pf-grid">
        <div className="pf-main">
          {tab === "activity" && (
            <>
              {pstyle?.premium && (pstyle.showcase ?? []).length > 0 && (
                <>
                  <div className="sp-head hf-head"><h2>Showcase</h2></div>
                  <Showcase songs={pstyle.showcase ?? []} accent={accent} bare />
                </>
              )}
              {contribTotal !== null && (
                <>
                  <div className="sp-head hf-head"><h2>Recent activity</h2><button onClick={() => setTab("contributions")}>View all →</button></div>
                  <Contributions userId={userId} mode="activity" />
                </>
              )}
              {showCollected && (
                <>
                  <div className="sp-head hf-head"><h2>Recently collected</h2><button onClick={() => setTab("collection")}>View all →</button></div>
                  {collectedCovers(6)}
                </>
              )}
              {showRated && (
                <>
                  <div className="sp-head hf-head"><h2>Latest ratings</h2><button onClick={() => setTab("collection")}>View all →</button></div>
                  {ratingRows(5)}
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
                <Panel title={`Recently collected · ${n(collected.length)}${collected.length >= 1000 ? "+" : ""}`}
                  right={collected.length > 12 && <button className="tab" onClick={() => setAllCollected(!allCollected)}>{allCollected ? "less" : "see more"}</button>}>
                  {collectedCovers(allCollected ? 60 : 12)}
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
                  {ratingRows(allRated ? 100 : 8)}
                </Panel>
              )}
              {!showCollection && !showCollected && !showRated && <div className="empty-state">Nothing to show here.</div>}
            </>
          )}

          {tab === "lists" && <div className="pf-panel pf-panel-loose"><ProfileLists userId={userId} /></div>}

          {tab === "contributions" && (
            <>
              <div className="pf-panel pf-panel-loose pf-contrib"><Contributions userId={userId} /></div>
              {contribTotal === null && <div className="empty-state">Contributions are private.</div>}
            </>
          )}

          {tab === "network" && (
            <>
              {showArtists && (
                <Panel title={`Artists followed · ${n(followedArtists.length)}`}
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
              {social && <div className="comment-meta">{n(social.followers)} follower{social.followers === 1 ? "" : "s"} · following {n(social.following)} {social.following === 1 ? "person" : "people"}. <Link href="/friends" className="text-link">Find people →</Link></div>}
            </>
          )}
        </div>

        <aside className="pf-side">
          {social && (
            <>
              <div className="sp-head hf-head"><h2>{isOwnProfile ? "Your network" : "Network"}</h2></div>
              {network}
            </>
          )}
          <div className="sp-head hf-head"><h2>Top contributors</h2></div>
          <div className="pf-panel pf-panel-loose"><Leaderboard /></div>
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
