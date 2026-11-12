"use client";

// Your notifications, grouped by day: leaks and releases from artists you
// follow, the daily round-up, songs you asked to be reminded about, songs
// you've collected changing status, new followers and messages. Each has a
// picture (cover, artist or person) and a status tag. In admin mode this page
// shows admin alerts instead, which never appear in your own account's list.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin } from "../useIsAdmin";
import { thumb } from "@/lib/thumb";

type Note = {
  id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null;
  image: string | null; round: boolean; status: string | null;
};
type Filter = "all" | "artists" | "reminders" | "social";
const FILTERS: [Filter, string][] = [["all", "All"], ["artists", "Artists"], ["reminders", "Reminders"], ["social", "Social"]];
const GROUP: Record<string, Filter> = { alert: "artists", digest: "artists", release_day: "reminders", status: "reminders", follow: "social", message: "social", reward: "social" };
const KIND_TAG: Record<string, string> = { digest: "round-up", follow: "follow", message: "message", admin: "admin", release_day: "out today", reward: "premium" };

function ago(at: string) {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(at)) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "Yesterday" : `${d}d ago`;
}

function dayGroup(at: string) {
  const d = new Date(at), now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= start) return "Today";
  if (t >= start - 86400000) return "Yesterday";
  if (t >= start - 6 * 86400000) return "This week";
  return "Earlier";
}

function Icon({ kind }: { kind: string }) {
  const p = { viewBox: "0 0 24 24", width: 24, height: 24, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "message") return <svg {...p}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>;
  if (kind === "reward") return <svg {...p}><path d="M12 3l7 9-7 9-7-9z" /></svg>;
  if (kind === "follow") return <svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></svg>;
  return <svg {...p}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>;
}

export default function NotificationsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const [items, setItems] = useState<Note[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    setItems(null);
    supabase.rpc("rpc_my_notifications", { p_limit: 100, p_admin: isAdmin }).then(({ data }) => {
      const d = data as { items: Note[] } | null;
      setItems(d?.items ?? []);
      // Opening the page counts as reading them (the dots stay until you leave).
      if ((d?.items ?? []).some((n) => !n.read_at)) supabase.rpc("rpc_mark_notifications_read", { p_admin: isAdmin });
    });
  }, [authLoading, user, router, isAdmin]);

  async function remove(n: Note) {
    setItems((prev) => (prev ?? []).filter((x) => x.id !== n.id));
    await supabase.from("notifications").delete().eq("id", n.id);
  }

  const shown = useMemo(() => (items ?? []).filter((n) => filter === "all" || GROUP[n.kind] === filter), [items, filter]);
  const groups = useMemo(() => {
    const g: [string, Note[]][] = [];
    for (const n of shown) {
      const k = dayGroup(n.created_at);
      const last = g[g.length - 1];
      if (last && last[0] === k) last[1].push(n); else g.push([k, [n]]);
    }
    return g;
  }, [shown]);

  return (
    <div className="wrap nt-page">
      <header className="nt-head">
        {isAdmin && <div className="ls-crumb"><Link href="/control">Control room</Link> / <span>Alerts</span></div>}
        <h1 className="ls-title nt-title">{isAdmin ? "ALERTS" : "NOTIFICATIONS"}<span>//</span></h1>
      </header>

      {!isAdmin && (
        <nav className="rd-chips nt-chips" aria-label="Show">
          {FILTERS.map(([k, label]) => (
            <button key={k} className={filter === k ? "on" : undefined} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}//</button>
          ))}
        </nav>
      )}

      {!items && <div className="empty-state">loading…</div>}
      {items && shown.length === 0 && (
        <div className="empty-state">
          {isAdmin ? "No alerts. All quiet."
            : filter === "all" ? <>Nothing yet. Follow artists or press &ldquo;remind me&rdquo; on anything coming up.</>
            : "Nothing here yet."}
        </div>
      )}

      {groups.map(([label, list]) => (
        <section key={label} className="nt-group">
          <h2 className="nt-day">{label}<span>//</span></h2>
          <ul className="nt-list">
            {list.map((n) => {
              const tag = n.status && ["alert", "status", "release_day"].includes(n.kind) ? n.status : KIND_TAG[n.kind] ?? n.kind;
              const isDigest = n.kind === "digest" && !!n.body;
              const lines = isDigest ? n.body!.split(" · ") : [];
              const main = (
                <>
                  <span className={`nt-pic ${n.round ? "round" : ""}`}>
                    {n.image
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={thumb(n.image)} alt="" width={56} height={56} loading="lazy" />
                      : <Icon kind={n.kind} />}
                  </span>
                  <span className="nt-text">
                    <span className="nt-what">{n.title}</span>
                    {n.body && !isDigest && <span className="nt-body">{n.body}</span>}
                    {isDigest && <span className="nt-body">{open === n.id ? "Tap to close" : `${lines.length} artist${lines.length === 1 ? "" : "s"} · tap to see`}</span>}
                  </span>
                </>
              );
              return (
                <li key={n.id} className={`nt-row ${!n.read_at ? "unread" : ""}`} data-st={n.status ?? undefined}>
                  {isDigest
                    ? <button className="nt-main" aria-expanded={open === n.id} onClick={() => setOpen(open === n.id ? null : n.id)}>{main}</button>
                    : n.link ? <Link href={n.link} className="nt-main">{main}</Link> : <div className="nt-main">{main}</div>}
                  <span className="nt-meta">
                    <span className={`feature-tag st ${n.status ? `st-${n.status}` : ""} nt-tag`}>{tag}</span>
                    <span className="nt-when">{ago(n.created_at)}</span>
                  </span>
                  <span className={`nt-dot ${!n.read_at ? "on" : ""}`} aria-label={!n.read_at ? "new" : undefined} />
                  <button className="nt-x" aria-label="Remove" onClick={() => remove(n)}>✕</button>
                  {isDigest && open === n.id && (
                    <div className="nt-digest">
                      {lines.map((l, i) => <span key={i}>{l}</span>)}
                      <Link href="/new/following" className="text-link">See what changed →</Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {!isAdmin && (
        <Link href="/settings#notifications" className="nt-settings">
          <Icon kind="bell" /> <span>Alert settings//</span>
        </Link>
      )}
    </div>
  );
}
