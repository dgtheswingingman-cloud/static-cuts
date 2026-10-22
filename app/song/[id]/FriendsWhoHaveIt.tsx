"use client";

// On a song page: friends (people you follow who follow you back) who have
// collected this song.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Friend = { user_id: string; name: string | null; avatar_url: string | null };

export default function FriendsWhoHaveIt({ trackId, signedIn }: { trackId: string; signedIn: boolean }) {
  const [friends, setFriends] = useState<Friend[]>([]);
  useEffect(() => {
    if (!signedIn) return;
    supabase.rpc("rpc_song_friends", { p_track_id: trackId }).then(({ data }) => setFriends((data as Friend[]) ?? []));
  }, [trackId, signedIn]);
  if (friends.length === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
      <span className="comment-meta">Friends who have it:</span>
      {friends.map((f) => (
        <Link key={f.user_id} href={`/profile/${f.user_id}`} title={f.name ?? "a friend"}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", color: "var(--bone)" }}>
          {f.avatar_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={f.avatar_url} alt="" style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }} />
            : <span style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--surface)", display: "inline-block" }} />}
          <span style={{ fontFamily: "var(--font-inter)", fontSize: "0.82rem" }}>{f.name ?? "a friend"}</span>
        </Link>
      ))}
    </div>
  );
}
