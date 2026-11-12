"use client";

// One chat with a friend. New messages show up every few seconds while the
// page is open; opening it marks their messages as read. A link to a song,
// artist or list on the site shows as a little card under the message.

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { usePersonalUser } from "../../useIsAdmin";
import { Avatar, stamp } from "../shared";
import ChatList from "../ChatList";
import { thumb } from "@/lib/thumb";

type Msg = { id: string; sender: string; recipient: string; body: string; created_at: string; read_at: string | null };
type Person = { id: string; display_name: string | null; avatar_url: string | null };
type Kind = "song" | "artist" | "list";
type Card = { href: string; title: string; sub: string | null; image: string | null; status: string | null; round: boolean };

// A site link on its own (static-cuts.com/song/…, or just /song/…).
const LINK = /(^|\s)((?:https?:\/\/)?(?:www\.)?(?:static-cuts\.com)?\/(song|artist|list)\/([A-Za-z0-9_%.-]+))/g;

function links(body: string): { kind: Kind; id: string; raw: string }[] {
  const out: { kind: Kind; id: string; raw: string }[] = [];
  for (const m of body.matchAll(LINK)) {
    if (!m[2].startsWith("/") && !/static-cuts\.com/.test(m[2])) continue;
    out.push({ kind: m[3] as Kind, id: decodeURIComponent(m[4]).replace(/[.,!?]+$/, ""), raw: m[2] });
  }
  return out;
}

// The message text with site links made tappable.
function Body({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    if (!m[2].startsWith("/") && !/static-cuts\.com/.test(m[2])) continue;
    const start = (m.index ?? 0) + m[1].length;
    parts.push(text.slice(last, start));
    parts.push(<Link key={start} href={`/${m[3]}/${m[4]}`}>{m[2]}</Link>);
    last = start + m[2].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

export default function ChatPage() {
  const params = useParams();
  const userId = params.userId as string;
  const { loading } = useAuth();
  const user = usePersonalUser();
  const router = useRouter();
  const [other, setOther] = useState<Person | null>(null);
  const [friend, setFriend] = useState<boolean | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [cards, setCards] = useState<Record<string, Card | null>>({});
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

  // Look up the cards for any site links we haven't seen yet.
  useEffect(() => {
    const want = (msgs ?? []).flatMap((m) => links(m.body)).filter((l) => !(`${l.kind}:${l.id}` in cards));
    if (!want.length) return;
    const ids = (k: Kind) => [...new Set(want.filter((l) => l.kind === k).map((l) => l.id))];
    const found: Record<string, Card | null> = {};
    for (const l of want) found[`${l.kind}:${l.id}`] = null;
    Promise.all([
      ids("song").length ? supabase.from("tracks").select("id, title, cover_url, release_status, artists!artist_id(name, image_url)").in("id", ids("song")).then(({ data }) => {
        for (const t of (data ?? []) as unknown as { id: string; title: string; cover_url: string | null; release_status: string | null; artists: { name: string; image_url: string | null } | null }[])
          found[`song:${t.id}`] = { href: `/song/${t.id}`, title: t.title, sub: t.artists?.name ?? null, image: t.cover_url ?? t.artists?.image_url ?? null, status: t.release_status, round: false };
      }) : null,
      ids("artist").length ? supabase.from("artists").select("id, name, image_url").in("id", ids("artist")).then(({ data }) => {
        for (const a of (data ?? []) as { id: string; name: string; image_url: string | null }[])
          found[`artist:${a.id}`] = { href: `/artist/${a.id}`, title: a.name, sub: "Artist", image: a.image_url, status: null, round: true };
      }) : null,
      ids("list").length ? supabase.from("song_lists").select("id, title, cover_url").in("id", ids("list")).then(({ data }) => {
        for (const l of (data ?? []) as { id: string; title: string; cover_url: string | null }[])
          found[`list:${l.id}`] = { href: `/list/${l.id}`, title: l.title, sub: "List", image: l.cover_url, status: null, round: false };
      }) : null,
    ]).then(() => setCards((p) => ({ ...p, ...found })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const lastMine = [...(msgs ?? [])].reverse().find((m) => m.sender === user?.id);

  return (
    <div className="wrap ms-wrap">
    <div className="ms-shell has-chat">
    <ChatList userId={user?.id ?? null} activeId={userId} />
    <div className="ms-pane ms-chat-page">
      <header className="ms-bar">
        <Link href="/messages" className="ms-back" aria-label="Back to messages">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
        </Link>
        <Link href={`/profile/${userId}`} className="ms-who">
          <Avatar url={other?.avatar_url ?? null} size={44} />
          <span>{name}</span>
        </Link>
        <Link href={`/profile/${userId}`} className="ms-open" aria-label={`${name}'s profile`}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
        </Link>
      </header>
      <div className="ms-note">Only friends can message each other.</div>

      <div className="ms-thread">
        {msgs === null && <div className="comment-meta">loading…</div>}
        {msgs && msgs.length === 0 && <div className="ms-stamp">No messages yet. Say hi.</div>}
        {msgs && msgs.map((m, i) => {
          const mine = m.sender === user?.id;
          const prev = msgs[i - 1];
          const gap = !prev || Date.parse(m.created_at) - Date.parse(prev.created_at) > 30 * 60000;
          const found = links(m.body).map((l) => cards[`${l.kind}:${l.id}`]).filter(Boolean) as Card[];
          return (
            <div key={m.id} className="ms-item">
              {gap && <div className="ms-stamp">{stamp(m.created_at)}</div>}
              <div className={`ms-msg ${mine ? "mine" : "theirs"}`}>
                <div className="ms-bubble"><Body text={m.body} /></div>
                {found.map((c) => (
                  <Link key={c.href} href={c.href} className="ms-card">
                    {c.image
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={thumb(c.image)} alt="" width={64} height={64} className={c.round ? "round" : undefined} loading="lazy" />
                      : <span className="ms-card-blank">SC//</span>}
                    <span className="ms-card-text">
                      <strong>{c.title}</strong>
                      {c.sub && <span>{c.sub}</span>}
                      {c.status && <span className={`feature-tag st st-${c.status}`}>{c.status}//</span>}
                    </span>
                  </Link>
                ))}
                <div className="ms-time">
                  {new Date(m.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </div>
                {mine && lastMine?.id === m.id && m.read_at && (
                  <div className="ms-seen">Seen {new Date(m.read_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} ✓</div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {friend === false ? (
        <div className="ms-note ms-locked">
          You can only message friends: people you follow who follow you back.{" "}
          <Link href={`/profile/${userId}`} className="text-link">See {name}&apos;s profile</Link>.
        </div>
      ) : (
        <div className="ms-compose">
          <textarea rows={1} maxLength={2000} placeholder="Type a message…" aria-label={`Message ${name}`}
            value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="ms-send" disabled={busy || !draft.trim()} onClick={send} aria-label="Send">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M3 20.5 21 12 3 3.5 5.5 12z" /></svg>
          </button>
        </div>
      )}
      {error && <div className="comment-meta error-text" style={{ marginTop: 6 }}>{error}</div>}
    </div>
    </div>
    </div>
  );
}
