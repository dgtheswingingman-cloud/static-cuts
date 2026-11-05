"use client";

// The Network tab on a profile. Anyone sees the friends, followers and
// following lists. On your own profile it's also your friends hub: what your
// friends have been doing, people to follow back, and people who follow the
// same artists as you. On computers the people and activity sit on the left,
// follow back and find people on the right.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import Supporter from "../../components/Supporter";

type Person = { id: string; display_name: string | null; avatar_url: string | null };
type Social = { followers: number; following: number; i_follow: boolean; follows_me: boolean; friends: { id: string; name: string | null; avatar_url: string | null }[] };
type Feed = {
  at: string; kind: "collected" | "rated" | "added" | "list" | "list_new"; user_id: string; name: string | null; avatar_url: string | null;
  track_id: string | null; list_id: string | null; title: string; artist_id: string | null; artist: string | null;
  cover_url: string | null; status: string | null; value: number | null;
};
type Suggestion = { id: string; name: string | null; avatar_url: string | null; shared: number; artists: string[] | null };
type Which = "friends" | "followers" | "following";
type ActFilter = "all" | "collected" | "added" | "rated" | "lists";

const n = (x: number) => x.toLocaleString("en-GB");
function ago(at: string) {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(at)) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "Yesterday" : `${d}d ago`;
}

function Face({ url, size = 44 }: { url: string | null; size?: number }) {
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt="" className="ms-avatar" style={{ width: size, height: size }} loading="lazy" />
    : <span className="ms-avatar ms-avatar-blank" style={{ width: size, height: size }} />;
}

const ListIcon = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" />
  </svg>
);

export default function ProfileNetwork({ userId, isOwn, viewerId, social, onChange }: {
  userId: string; isOwn: boolean; viewerId: string | null; social: Social; onChange: () => void;
}) {
  const [which, setWhich] = useState<Which>("friends");
  const [people, setPeople] = useState<{ followers: Person[]; following: Person[] } | null>(null);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [feed, setFeed] = useState<Feed[] | null>(null);
  const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [allPeople, setAllPeople] = useState(false);
  const [allBack, setAllBack] = useState(false);
  const [allSugg, setAllSugg] = useState(false);
  const [act, setAct] = useState<ActFilter>("all");
  const [feedShown, setFeedShown] = useState(6);

  async function load() {
    const [{ data: ers }, { data: ing }] = await Promise.all([
      supabase.from("user_follows").select("follower").eq("followee", userId).order("created_at", { ascending: false }).limit(500),
      supabase.from("user_follows").select("followee").eq("follower", userId).order("created_at", { ascending: false }).limit(500),
    ]);
    const followers = ((ers ?? []) as { follower: string }[]).map((r) => r.follower);
    const following = ((ing ?? []) as { followee: string }[]).map((r) => r.followee);
    const ids = [...new Set([...followers, ...following])];
    const { data: ps } = ids.length ? await supabase.from("profiles").select("id, display_name, avatar_url").in("id", ids) : { data: [] };
    const byId = new Map(((ps ?? []) as Person[]).map((p) => [p.id, p]));
    const pick = (l: string[]) => l.map((id) => byId.get(id)).filter((p): p is Person => !!p);
    setPeople({ followers: pick(followers), following: pick(following) });
    if (viewerId) {
      const { data: m } = await supabase.from("user_follows").select("followee").eq("follower", viewerId).limit(1000);
      setMine(new Set(((m ?? []) as { followee: string }[]).map((r) => r.followee)));
    }
  }

  useEffect(() => {
    load();
    if (isOwn) {
      supabase.rpc("rpc_friends_feed", { p_limit: 120 }).then(({ data }) => setFeed((data as Feed[]) ?? []));
      supabase.rpc("rpc_people_suggestions", { p_limit: 12 }).then(({ data }) => setSugg((data as Suggestion[]) ?? []));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, isOwn, viewerId]);

  async function follow(id: string) {
    if (!viewerId) return;
    setBusy(id);
    await supabase.from("user_follows").insert({ follower: viewerId, followee: id });
    setBusy(null);
    setMine((p) => new Set([...p, id]));
    setSugg((p) => p.filter((s) => s.id !== id));
    load();
    onChange();
  }

  const friends: Person[] = social.friends.map((f) => ({ id: f.id, display_name: f.name, avatar_url: f.avatar_url }));
  const friendIds = new Set(friends.map((f) => f.id));
  const list = which === "friends" ? friends : which === "followers" ? people?.followers ?? [] : people?.following ?? [];
  const followBack = isOwn ? (people?.followers ?? []).filter((p) => !mine.has(p.id)) : [];
  const feedList = (feed ?? []).filter((f) => act === "all" || (act === "lists" ? !!f.list_id : f.kind === act));

  const verb = (f: Feed) => f.kind === "collected" ? "collected" : f.kind === "rated" ? "rated" : f.kind === "added" ? "added"
    : f.kind === "list_new" ? "made a list" : "updated a list";

  const label = (p: Person) => friendIds.has(p.id) ? "Friends" : which === "followers" ? "Follows " + (isOwn ? "you" : "them") : null;
  const action = (p: Person) => {
    if (!viewerId || p.id === viewerId) return null;
    if (isOwn && friendIds.has(p.id)) return <Link href={`/messages/${p.id}`} className="ms-say">Message//</Link>;
    if (!mine.has(p.id)) return <button className="ms-say nw-follow" disabled={busy === p.id} onClick={() => follow(p.id)}>{isOwn && which === "followers" ? "Follow back//" : "Follow//"}</button>;
    return <span className="nw-following">Following</span>;
  };

  const personRow = (p: Person, sub: string | null, act2: ReactNode) => (
    <div key={p.id} className="ms-friend nw-person">
      <Link href={`/profile/${p.id}`} className="ms-friend-who">
        <Face url={p.avatar_url} />
        <span className="ms-chat-text">
          <span className="ms-chat-name">{p.display_name ?? "anonymous"}<Supporter id={p.id} /></span>
          {sub && <span className="ms-chat-last">{sub}</span>}
        </span>
      </Link>
      {act2}
    </div>
  );

  const peoplePanel = (
    <section className="nw-panel">
      <h2 className="nw-h">{which === "friends" ? "Friends" : which === "followers" ? "Followers" : "Following"}<span>//</span></h2>
      {which === "friends" && list.length === 0 && (
        <div className="comment-meta">{isOwn ? "No friends yet. Follow people from their profile; when they follow you back you're friends." : "No friends yet."}</div>
      )}
      {which !== "friends" && people && list.length === 0 && <div className="comment-meta">Nobody yet.</div>}
      {list.slice(0, allPeople ? 500 : 5).map((p) => personRow(p, label(p), action(p)))}
      {list.length > 5 && (
        <button className="nw-more" onClick={() => setAllPeople(!allPeople)}>{allPeople ? "Show fewer" : `View all ${which}`} →</button>
      )}
    </section>
  );

  const activityPanel = isOwn && (
    <section className="nw-panel">
      <div className="nw-h-row">
        <h2 className="nw-h">Friend activity<span>//</span></h2>
        <select className="nw-select" value={act} onChange={(e) => { setAct(e.target.value as ActFilter); setFeedShown(6); }} aria-label="Show">
          <option value="all">All activity</option>
          <option value="collected">Collected</option>
          <option value="added">Added</option>
          <option value="rated">Rated</option>
          <option value="lists">Lists</option>
        </select>
      </div>
      {feed === null && <div className="comment-meta">loading…</div>}
      {feed && feedList.length === 0 && <div className="comment-meta">Nothing from your friends in the last 60 days.</div>}
      {feedList.slice(0, feedShown).map((f, i) => (
        <Link key={i} href={f.list_id ? `/list/${f.list_id}` : `/song/${f.track_id}`} className="nw-act" data-st={f.status ?? undefined}>
          <span className="nw-act-pics">
            <span className="nw-act-cover">
              {f.cover_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={f.cover_url} alt="" width={64} height={64} loading="lazy" />
                : <ListIcon />}
            </span>
            <Face url={f.avatar_url} size={26} />
          </span>
          <span className="nw-act-text">
            <span className="nw-act-what"><strong>{f.name ?? "A friend"}</strong> {verb(f)}</span>
            <span className="nw-act-title">&lsquo;{f.title}&rsquo;{f.kind === "rated" && f.value != null ? ` ${f.value}/10` : ""}</span>
            {f.artist && <span className="nw-act-artist">{f.artist}</span>}
          </span>
          <span className="nw-act-side">
            {f.status && <span className={`feature-tag st st-${f.status}`}>{f.status}//</span>}
            <span className="nt-when">{ago(f.at)}</span>
          </span>
        </Link>
      ))}
      {feedList.length > feedShown && (
        <button className="nw-more" onClick={() => setFeedShown(feedShown + 12)}>View more activity →</button>
      )}
    </section>
  );

  const backPanel = isOwn && followBack.length > 0 && (
    <section className="nw-panel">
      <h2 className="nw-h">Follow back to be friends<span>//</span></h2>
      {followBack.slice(0, allBack ? 500 : 3).map((p) => personRow(p, "Follows you",
        <button className="ms-say nw-follow" disabled={busy === p.id} onClick={() => follow(p.id)}>Follow back//</button>))}
      {followBack.length > 3 && <button className="nw-more" onClick={() => setAllBack(!allBack)}>{allBack ? "Show fewer" : "View all"} →</button>}
    </section>
  );

  const findPanel = isOwn && (
    <section className="nw-panel">
      <h2 className="nw-h">Find people<span>//</span></h2>
      {sugg.length === 0 && (
        <div className="comment-meta">Find people by typing their name in <Link href="/search" className="text-link">search</Link>, or share your profile link.</div>
      )}
      {sugg.slice(0, allSugg ? 12 : 3).map((s) => personRow(
        { id: s.id, display_name: s.name, avatar_url: s.avatar_url },
        `${s.shared} artist${s.shared === 1 ? "" : "s"} in common${s.artists?.length ? `: ${s.artists.join(", ")}` : ""}`,
        <button className="ms-say nw-follow" disabled={busy === s.id} onClick={() => follow(s.id)}>Follow//</button>))}
      {sugg.length > 3 && <button className="nw-more" onClick={() => setAllSugg(!allSugg)}>{allSugg ? "Show fewer" : "View more"} →</button>}
    </section>
  );

  return (
    <div className="nw">
      <nav className="nw-switch" aria-label="People">
        {([["friends", "Friends", social.friends.length], ["followers", "Followers", social.followers], ["following", "Following", social.following]] as [Which, string, number][]).map(([k, lbl, c]) => (
          <button key={k} className={which === k ? "on" : undefined} aria-pressed={which === k} onClick={() => { setWhich(k); setAllPeople(false); }}>
            <strong>{n(c)}</strong><span>{lbl}</span>
          </button>
        ))}
      </nav>
      <div className={`nw-cols ${isOwn ? "own" : ""}`}>
        <div className="nw-col">
          {peoplePanel}
          {activityPanel}
        </div>
        {isOwn && (
          <div className="nw-col">
            {backPanel}
            {findPanel}
          </div>
        )}
      </div>
    </div>
  );
}
