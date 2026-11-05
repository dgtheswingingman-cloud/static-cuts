"use client";

// The list of chats: your conversations (newest first) and friends you
// haven't messaged. On phones it's the whole Messages page; on computers it
// sits on the left with the open chat on the right.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Avatar, ago, type Chat } from "./shared";
import Supporter from "../components/Supporter";

export default function ChatList({ activeId, userId }: { activeId?: string; userId: string | null }) {
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!userId) return;
    const load = () => supabase.rpc("rpc_conversations").then(({ data }) => setChats((data as Chat[]) ?? []));
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
    return () => clearInterval(t);
  }, [userId, activeId]);

  const needle = q.trim().toLowerCase();
  const talking = useMemo(() => (chats ?? []).filter((c) => c.last && (!needle || (c.name ?? "").toLowerCase().includes(needle))), [chats, needle]);
  const quiet = useMemo(() => (chats ?? []).filter((c) => !c.last && c.friend && (!needle || (c.name ?? "").toLowerCase().includes(needle))), [chats, needle]);

  return (
    <aside className="ms-list">
      <div className="ms-list-head">
        <h1 className="ls-title ms-title">MESSAGES<span>//</span></h1>
        <div className="sr-box ms-search">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input placeholder="Search friends…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search friends" />
          {q && <button aria-label="Clear" onClick={() => setQ("")}>✕</button>}
        </div>
      </div>

      <div className="ms-list-body">
        {chats === null && <div className="comment-meta ms-pad">loading…</div>}
        {chats && chats.length === 0 && (
          <div className="comment-meta ms-pad">
            Messages are for friends: people you follow who follow you back. Find people in{" "}
            <Link href="/search" className="text-link">search</Link> and follow them from their profile.
          </div>
        )}
        {chats && chats.length > 0 && talking.length === 0 && <div className="comment-meta ms-pad">{needle ? "No chats match." : "No chats yet. Say hi to a friend."}</div>}
        {talking.map((c) => (
          <Link key={c.id} href={`/messages/${c.id}`} className={`ms-chat ${c.unread > 0 ? "unread" : ""} ${activeId === c.id ? "active" : ""}`} aria-current={activeId === c.id ? "page" : undefined}>
            <Avatar url={c.avatar_url} size={48} />
            <span className="ms-chat-text">
              <span className="ms-chat-name">{c.name ?? "anonymous"}<Supporter id={c.id} /></span>
              <span className="ms-chat-last">{c.last_mine ? "You: " : ""}{c.last}</span>
            </span>
            <span className="ms-chat-side">
              {c.last_at && <span className="ms-when">{ago(c.last_at)}</span>}
              {c.unread > 0 && activeId !== c.id && <span className="ms-badge">{c.unread}</span>}
            </span>
          </Link>
        ))}

        {quiet.length > 0 && (
          <div className="ms-friends">
            <h2 className="nt-day">Friends you haven&apos;t messaged<span>//</span></h2>
            {quiet.map((c) => (
              <div key={c.id} className={`ms-friend ${activeId === c.id ? "active" : ""}`}>
                <Link href={`/profile/${c.id}`} className="ms-friend-who">
                  <Avatar url={c.avatar_url} size={40} />
                  <span className="ms-chat-text"><span className="ms-chat-name">{c.name ?? "anonymous"}</span></span>
                </Link>
                <Link href={`/messages/${c.id}`} className="ms-say">Message//</Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
