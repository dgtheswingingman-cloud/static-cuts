"use client";

// Messages: your chats with friends (people who follow you back), newest
// first, plus friends you haven't messaged yet.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { usePersonalUser } from "../useIsAdmin";
import { Avatar, when, type Chat } from "./shared";

export default function MessagesPage() {
  const { loading } = useAuth();
  const user = usePersonalUser();
  const router = useRouter();
  const [chats, setChats] = useState<Chat[] | null>(null);

  useEffect(() => {
    if (!loading && !user) { router.push("/login"); return; }
    if (!user) return;
    const load = () => supabase.rpc("rpc_conversations").then(({ data }) => setChats((data as Chat[]) ?? []));
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
    return () => clearInterval(t);
  }, [loading, user, router]);

  return (
    <div className="wrap" style={{ maxWidth: 720 }}>
      <h1 className="detail-name page-title">Messages</h1>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        Chat with friends: people you follow who follow you back. Find people in{" "}
        <Link href="/search" className="text-link">search</Link> and follow them from their profile.
      </div>
      {chats === null && <div className="comment-meta">Loading…</div>}
      {chats && chats.length === 0 && (
        <div className="empty-state">No friends yet. When someone you follow follows you back, you can message them here.</div>
      )}
      {chats && chats.map((c) => (
        <Link key={c.id} href={`/messages/${c.id}`} className="track-row"
          style={{ display: "flex", gap: 12, alignItems: "center", textDecoration: "none", padding: "10px 4px", borderBottom: "1px solid var(--hair)" }}>
          <Avatar url={c.avatar_url} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="track-title" style={{ fontWeight: c.unread > 0 ? 700 : undefined }}>{c.name ?? "anonymous"}</div>
            <div className="comment-meta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.last ? `${c.last_mine ? "You: " : ""}${c.last}` : "Say hi"}
            </div>
          </div>
          {c.last_at && <span className="comment-meta">{when(c.last_at)}</span>}
          {c.unread > 0 && <span className="notif-count">{c.unread}</span>}
        </Link>
      ))}
    </div>
  );
}
