"use client";

// Friends: people you follow who follow you back. What they've been
// collecting, rating and adding lately, plus people who follow you that you
// could follow back.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { usePersonalUser } from "../useIsAdmin";

type Activity = {
  at: string; kind: "collected" | "rated" | "added"; user_id: string; name: string | null; avatar_url: string | null;
  track_id: string; title: string; artist_id: string; artist: string | null; value: number | null;
};
type Person = { id: string; display_name: string | null; avatar_url: string | null };

function Avatar({ url, size = 28 }: { url: string | null; size?: number }) {
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
    : <span style={{ width: size, height: size, borderRadius: "50%", background: "var(--surface)", display: "inline-block", flexShrink: 0 }} />;
}

function ago(at: string) {
  const m = Math.round((Date.now() - Date.parse(at)) / 60000);
  if (m < 60) return `${Math.max(m, 1)} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

export default function FriendsPage() {
  const { loading } = useAuth();
  const user = usePersonalUser();
  const router = useRouter();
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [friends, setFriends] = useState<Person[]>([]);
  const [followBack, setFollowBack] = useState<Person[]>([]);

  async function load() {
    if (!user) return;
    const [{ data: act }, { data: mine }, { data: fans }] = await Promise.all([
      supabase.rpc("rpc_friends_activity", { p_limit: 80 }),
      supabase.from("user_follows").select("followee").eq("follower", user.id),
      supabase.from("user_follows").select("follower").eq("followee", user.id),
    ]);
    setActivity((act as Activity[]) ?? []);
    const iFollow = new Set(((mine ?? []) as { followee: string }[]).map((r) => r.followee));
    const followMe = ((fans ?? []) as { follower: string }[]).map((r) => r.follower);
    const ids = [...new Set([...iFollow, ...followMe])];
    const { data: people } = ids.length
      ? await supabase.from("profiles").select("id, display_name, avatar_url").in("id", ids)
      : { data: [] };
    const byId = new Map(((people ?? []) as Person[]).map((p) => [p.id, p]));
    setFriends(followMe.filter((id) => iFollow.has(id)).map((id) => byId.get(id)).filter((p): p is Person => !!p));
    setFollowBack(followMe.filter((id) => !iFollow.has(id)).map((id) => byId.get(id)).filter((p): p is Person => !!p));
  }

  useEffect(() => {
    if (!loading && !user) { router.push("/login"); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user?.id]);

  async function follow(id: string) {
    if (!user) return;
    await supabase.from("user_follows").insert({ follower: user.id, followee: id });
    load();
  }

  const verb = (a: Activity) => a.kind === "collected" ? "collected" : a.kind === "rated" ? `rated ${a.value}/10` : "added";

  return (
    <div className="wrap">
      <h1 className="detail-name page-title">Friends</h1>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        Friends are people you follow who follow you back. You can see each other&apos;s collections and ratings, even
        private ones. Find people by typing their name in <Link href="/search" className="text-link">search</Link>, or send
        them your profile link (the &ldquo;share profile&rdquo; button on your profile), then follow from their profile.
      </div>

      {followBack.length > 0 && (
        <>
          <div className="section-label">Follow back to be friends</div>
          {followBack.map((p) => (
            <div key={p.id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center" }}>
              <Link href={`/profile/${p.id}`} style={{ display: "flex", gap: 10, alignItems: "center", textDecoration: "none", color: "var(--bone)", minWidth: 0 }}>
                <Avatar url={p.avatar_url} />
                <span className="review-row-title">{p.display_name ?? "anonymous"}</span>
              </Link>
              <button className="tab active" onClick={() => follow(p.id)}>follow back</button>
            </div>
          ))}
        </>
      )}

      <div className="section-label">Your friends ({friends.length})</div>
      {friends.length === 0 && <div className="empty-state">No friends yet. Follow someone and ask them to follow you back.</div>}
      {friends.length > 0 && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
          {friends.map((p) => (
            <Link key={p.id} href={`/profile/${p.id}`} style={{ display: "flex", gap: 8, alignItems: "center", textDecoration: "none", color: "var(--bone)" }}>
              <Avatar url={p.avatar_url} size={32} />
              <span style={{ fontFamily: "var(--font-inter)", fontSize: "0.9rem" }}>{p.display_name ?? "anonymous"}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="section-label">Lately</div>
      {activity === null && <div className="empty-state">loading…</div>}
      {activity && activity.length === 0 && <div className="empty-state">Nothing from your friends in the last 60 days.</div>}
      {activity?.map((a, i) => (
        <div key={i} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
            <Avatar url={a.avatar_url} />
            <div style={{ minWidth: 0 }}>
              <div className="review-row-title">
                <Link href={`/song/${a.track_id}`}>{a.title}</Link>
              </div>
              <div className="review-row-meta">
                <span>{a.name ?? "a friend"} {verb(a)}</span>
                {a.artist && <Link href={`/artist/${a.artist_id}`} className="feature-tag" style={{ textDecoration: "none" }}>{a.artist}</Link>}
              </div>
            </div>
          </div>
          <span className="comment-meta">{a.at ? ago(a.at) : ""}</span>
        </div>
      ))}
    </div>
  );
}
