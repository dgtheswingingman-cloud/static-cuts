"use client";

// The Network tab on a profile. Anyone sees the friends, followers and
// following lists. On your own profile it's also your friends hub (this used
// to be the separate Friends page): people to follow back, what your friends
// have been doing, and people who follow the same artists as you.

import { useEffect, useState } from "react";
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

export default function ProfileNetwork({ userId, isOwn, viewerId, social, onChange }: {
  userId: string; isOwn: boolean; viewerId: string | null; social: Social; onChange: () => void;
}) {
  const [which, setWhich] = useState<Which>("friends");
  const [people, setPeople] = useState<{ followers: Person[]; following: Person[] } | null>(null);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [feed, setFeed] = useState<Feed[] | null>(null);
  const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedShown, setFeedShown] = useState(12);

  async function load() {
    const [{ data: ers }, { data: ing }] = await Promise.all([
      supabase.from("user_follows").select("follower").eq("followee", userId).limit(500),
      supabase.from("user_follows").select("followee").eq("follower", userId).limit(500),
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
      supabase.rpc("rpc_friends_feed", { p_limit: 80 }).then(({ data }) => setFeed((data as Feed[]) ?? []));
      supabase.rpc("rpc_people_suggestions", { p_limit: 8 }).then(({ data }) => setSugg((data as Suggestion[]) ?? []));
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
  const list = which === "friends" ? friends : which === "followers" ? people?.followers ?? [] : people?.following ?? [];
  const followBack = isOwn ? (people?.followers ?? []).filter((p) => !mine.has(p.id)) : [];
  const friendIds = new Set(friends.map((f) => f.id));

  const verb = (f: Feed) => f.kind === "collected" ? "collected" : f.kind === "rated" ? `rated ${f.value}/10`
    : f.kind === "added" ? "added" : f.kind === "list_new" ? "made a list" : "updated a list";

  const action = (p: Person) => {
    if (!viewerId || p.id === viewerId) return null;
    if (isOwn && friendIds.has(p.id)) return <Link href={`/messages/${p.id}`} className="ms-say">Message//</Link>;
    if (!mine.has(p.id)) return <button className="ms-say nw-follow" disabled={busy === p.id} onClick={() => follow(p.id)}>{isOwn && which === "followers" ? "Follow back//" : "Follow//"}</button>;
    return <span className="nw-following">Following</span>;
  };

  return (
    <div className="nw">
      <nav className="nw-switch" aria-label="People">
        {([["friends", "Friends", social.friends.length], ["followers", "Followers", social.followers], ["following", "Following", social.following]] as [Which, string, number][]).map(([k, label, c]) => (
          <button key={k} className={which === k ? "on" : undefined} aria-pressed={which === k} onClick={() => setWhich(k)}>
            <strong>{n(c)}</strong><span>{label}</span>
          </button>
        ))}
      </nav>

      {isOwn && followBack.length > 0 && (
        <section className="nw-sec nw-back">
          <h2 className="nt-day">Follow back to be friends<span>//</span></h2>
          {followBack.slice(0, 6).map((p) => (
            <div key={p.id} className="ms-friend">
              <Link href={`/profile/${p.id}`} className="ms-friend-who">
                <Face url={p.avatar_url} />
                <span className="ms-chat-text"><span className="ms-chat-name">{p.display_name ?? "anonymous"}<Supporter id={p.id} /></span><span className="ms-chat-last">Follows you</span></span>
              </Link>
              <button className="ms-say nw-follow" disabled={busy === p.id} onClick={() => follow(p.id)}>Follow back//</button>
            </div>
          ))}
        </section>
      )}

      <section className="nw-sec">
        <h2 className="nt-day">{which === "friends" ? "Friends" : which === "followers" ? "Followers" : "Following"}<span>//</span></h2>
        {which === "friends" && list.length === 0 && (
          <div className="comment-meta">{isOwn ? "No friends yet. Follow people from their profile; when they follow you back you're friends." : "No friends yet."}</div>
        )}
        {which !== "friends" && people && list.length === 0 && <div className="comment-meta">Nobody yet.</div>}
        <div className="nw-people">
          {list.map((p) => (
            <div key={p.id} className="ms-friend">
              <Link href={`/profile/${p.id}`} className="ms-friend-who">
                <Face url={p.avatar_url} />
                <span className="ms-chat-text">
                  <span className="ms-chat-name">{p.display_name ?? "anonymous"}<Supporter id={p.id} /></span>
                  {friendIds.has(p.id) && which !== "friends" && <span className="ms-chat-last">Friends</span>}
                </span>
              </Link>
              {action(p)}
            </div>
          ))}
        </div>
      </section>

      {isOwn && (
        <section className="nw-sec">
          <h2 className="nt-day">Friend activity<span>//</span></h2>
          {feed === null && <div className="comment-meta">loading…</div>}
          {feed && feed.length === 0 && <div className="comment-meta">Nothing from your friends in the last 60 days.</div>}
          <ul className="nt-list">
            {(feed ?? []).slice(0, feedShown).map((f, i) => (
              <li key={i} className="nt-row nw-act" data-st={f.status ?? undefined}>
                <Link href={f.list_id ? `/list/${f.list_id}` : `/song/${f.track_id}`} className="nt-main">
                  <span className="nw-act-pics">
                    <Face url={f.avatar_url} size={36} />
                    <span className="nt-pic">
                      {f.cover_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={f.cover_url} alt="" width={56} height={56} loading="lazy" />
                        : <span className="nw-blank">SC//</span>}
                    </span>
                  </span>
                  <span className="nt-text">
                    <span className="nt-what"><strong>{f.name ?? "A friend"}</strong> {verb(f)} {f.list_id ? <>&ldquo;{f.title}&rdquo;</> : <>&lsquo;{f.title}&rsquo;</>}</span>
                    {f.artist && <span className="nt-body">{f.artist}</span>}
                  </span>
                </Link>
                <span className="nt-meta">
                  {f.status ? <span className={`feature-tag st st-${f.status} nt-tag`}>{f.status}</span> : f.list_id ? <span className="feature-tag nt-tag">list</span> : null}
                  <span className="nt-when">{ago(f.at)}</span>
                </span>
              </li>
            ))}
          </ul>
          {feed && feed.length > feedShown && (
            <div style={{ textAlign: "center", marginTop: 12 }}><button className="tab" onClick={() => setFeedShown(feedShown + 20)}>Show more</button></div>
          )}
        </section>
      )}

      {isOwn && (
        <section className="nw-sec">
          <h2 className="nt-day">Find people<span>//</span></h2>
          {sugg.length === 0
            ? <div className="comment-meta">Find people by typing their name in <Link href="/search" className="text-link">search</Link>, or share your profile link.</div>
            : <div className="nw-sugg">
                {sugg.map((s) => (
                  <div key={s.id} className="nw-card">
                    <Link href={`/profile/${s.id}`} className="nw-card-who">
                      <Face url={s.avatar_url} size={64} />
                      <strong>{s.name ?? "anonymous"}</strong>
                      <span>{s.shared} artist{s.shared === 1 ? "" : "s"} in common{s.artists?.length ? `: ${s.artists.join(", ")}` : ""}</span>
                    </Link>
                    <button className="ms-say nw-follow" disabled={busy === s.id} onClick={() => follow(s.id)}>Follow//</button>
                  </div>
                ))}
              </div>}
        </section>
      )}
    </div>
  );
}
