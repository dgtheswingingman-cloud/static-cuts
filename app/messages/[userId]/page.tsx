"use client";

// One chat with a friend. New messages show up every few seconds while the
// page is open; opening it marks their messages as read.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { usePersonalUser } from "../../useIsAdmin";
import { Avatar, when } from "../shared";

type Msg = { id: string; sender: string; recipient: string; body: string; created_at: string; read_at: string | null };
type Person = { id: string; display_name: string | null; avatar_url: string | null };

export default function ChatPage() {
  const params = useParams();
  const userId = params.userId as string;
  const { loading } = useAuth();
  const user = usePersonalUser();
  const router = useRouter();
  const [other, setOther] = useState<Person | null>(null);
  const [friend, setFriend] = useState<boolean | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  async function load() {
    if (!user) return;
    const { data } = await supabase.from("messages")
      .select("id, sender, recipient, body, created_at, read_at")
      .or(`and(sender.eq.${user.id},recipient.eq.${userId}),and(sender.eq.${userId},recipient.eq.${user.id})`)
      .order("created_at", { ascending: false }).limit(200);
    const list = ((data as Msg[]) ?? []).reverse();
    setMsgs(list);
    if (list.some((m) => m.sender === userId && !m.read_at)) supabase.rpc("rpc_read_messages", { p_with: userId }).then(() => {});
  }

  useEffect(() => {
    if (!loading && !user) { router.push("/login"); return; }
    if (!user) return;
    supabase.from("profiles").select("id, display_name, avatar_url").eq("id", userId).maybeSingle()
      .then(({ data }) => setOther((data as Person) ?? null));
    supabase.rpc("rpc_profile_social", { p_user: userId })
      .then(({ data }) => setFriend(!!data?.i_follow && !!data?.follows_me));
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user?.id, userId]);

  // Scroll to the newest message when new ones arrive.
  useEffect(() => {
    if (msgs && msgs.length !== lastCount.current) {
      lastCount.current = msgs.length;
      bottom.current?.scrollIntoView({ block: "end" });
    }
  }, [msgs]);

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true); setError(null);
    const { error: err } = await supabase.rpc("rpc_send_message", { p_to: userId, p_body: body });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setDraft("");
    load();
  }

  const name = other?.display_name ?? "anonymous";

  return (
    <div className="wrap" style={{ maxWidth: 720 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <Link href="/messages" className="comment-meta" style={{ textDecoration: "none" }}>← messages</Link>
        <Avatar url={other?.avatar_url ?? null} size={32} />
        <Link href={`/profile/${userId}`} className="track-title" style={{ textDecoration: "none" }}>{name}</Link>
      </div>

      <div className="comments-panel" style={{ minHeight: 240, maxHeight: "60vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {msgs === null && <div className="comment-meta">Loading…</div>}
        {msgs && msgs.length === 0 && <div className="comment-meta">No messages yet. Say hi.</div>}
        {msgs && msgs.map((m) => {
          const mine = m.sender === user?.id;
          return (
            <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "80%" }}>
              <div className="comment-body" style={{
                background: mine ? "var(--bone)" : "var(--surface2)", color: mine ? "var(--void)" : "var(--bone)",
                padding: "8px 12px", borderRadius: 12, whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>{m.body}</div>
              <div className="comment-meta" style={{ textAlign: mine ? "right" : "left", marginTop: 2, fontSize: 11 }}>
                {when(m.created_at)}{mine && m.read_at ? " · seen" : ""}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {friend === false ? (
        <div className="comment-meta" style={{ marginTop: 12 }}>
          You can only message friends: people you follow who follow you back.{" "}
          <Link href={`/profile/${userId}`} className="text-link">See {name}&apos;s profile</Link>.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-end" }}>
          <textarea className="search-input" rows={2} maxLength={2000} placeholder={`Message ${name}…`}
            style={{ flex: 1, resize: "vertical", minHeight: 44 }}
            value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="tab" disabled={busy || !draft.trim()} onClick={send}>{busy ? "sending…" : "send"}</button>
        </div>
      )}
      {error && <div className="comment-meta error-text" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
}
