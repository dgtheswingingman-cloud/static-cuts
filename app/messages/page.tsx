"use client";

// Messages: your chats with friends (people who follow you back), newest
// first, plus friends you haven't messaged yet. On computers the two sit
// side by side.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { usePersonalUser } from "../useIsAdmin";
import { Avatar, ago, type Chat } from "./shared";
import Supporter from "../components/Supporter";

export default function MessagesPage() {
  const { loading } = useAuth();
  const user = usePersonalUser();
  const router = useRouter();
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!loading && !user) { router.push("/login"); return; }
    if (!user) return;
    const load = () => supabase.rpc("rpc_conversations").then(({ data }) => setChats((data as Chat[]) ?? []));
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
    return () => clearInterval(t);
  }, [loading, user, router]);

  const needle = q.trim().toLowerCase();
  const match = (c: Chat) => !needle || (c.name ?? "").toLowerCase().includes(needle);
  const talking = useMemo(() => (chats ?? []).filter((c) => c.last && match(c)), [chats, needle]); // eslint-disable-line react-hooks/exhaustive-deps
  const quiet = useMemo(() => (chats ?? []).filter((c) => !c.last && c.friend && match(c)), [chats, needle]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="wrap ms-page">
      <header className="ms-head">
        <h1 className="ls-title ms-title">MESSAGES<span>//</span></h1>
        <div className="sr-box ms-search">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input placeholder="Search friends…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search friends" />
          {q && <button aria-label="Clear" onClick={() => setQ("")}>✕</button>}
        </div>
      </header>

      {chats === null && <div className="empty-state">loading…</div>}
      {chats && chats.length === 0 && (
        <div className="empty-state">
          Messages are for friends: people you follow who follow you back. Find people in{" "}
          <Link href="/search" className="text-link">search</Link> and follow them from their profile.
        </div>
      )}

      {chats && chats.length > 0 && (
        <div className="ms-cols">
          <section className="ms-chats">
            {talking.length === 0 && <div className="comment-meta">{needle ? "No chats match." : "No chats yet. Say hi to a friend."}</div>}
            {talking.map((c) => (
              <Link key={c.id} href={`/messages/${c.id}`} className={`ms-chat ${c.unread > 0 ? "unread" : ""}`}>
                <Avatar url={c.avatar_url} size={52} />
                <span className="ms-chat-text">
                  <span className="ms-chat-name">{c.name ?? "anonymous"}<Supporter id={c.id} /></span>
                  <span className="ms-chat-last">{c.last_mine ? "You: " : ""}{c.last}</span>
                </span>
                <span className="ms-chat-side">
                  {c.last_at && <span className="ms-when">{ago(c.last_at)}</span>}
                  {c.unread > 0 && <span className="ms-badge">{c.unread}</span>}
                </span>
              </Link>
            ))}
          </section>

          {quiet.length > 0 && (
            <section className="ms-friends">
              <h2 className="nt-day">Friends you haven&apos;t messaged<span>//</span></h2>
              {quiet.map((c) => (
                <div key={c.id} className="ms-friend">
                  <Link href={`/profile/${c.id}`} className="ms-friend-who">
                    <Avatar url={c.avatar_url} size={44} />
                    <span className="ms-chat-text">
                      <span className="ms-chat-name">{c.name ?? "anonymous"}</span>
                      <span className="ms-chat-last">Friends</span>
                    </span>
                  </Link>
                  <Link href={`/messages/${c.id}`} className="ms-say">Message//</Link>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
