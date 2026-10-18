"use client";

// Your notifications: songs you asked to be reminded about, and songs you've
// collected changing status.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin } from "../useIsAdmin";
import { AdminModePage } from "../components/AdminModeNote";

type Note = { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };

export default function NotificationsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const [items, setItems] = useState<Note[] | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    supabase.rpc("rpc_my_notifications", { p_limit: 100 }).then(({ data }) => {
      const d = data as { items: Note[] } | null;
      setItems(d?.items ?? []);
      // Opening the page counts as reading them.
      if ((d?.items ?? []).some((n) => !n.read_at)) supabase.rpc("rpc_mark_notifications_read", {});
    });
  }, [authLoading, user, router]);

  async function remove(n: Note) {
    await supabase.from("notifications").delete().eq("id", n.id);
    setItems((prev) => (prev ?? []).filter((x) => x.id !== n.id));
  }

  if (isAdmin) return <AdminModePage title="Notifications" />;

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← home</button>
      <h1 className="detail-name page-title">Notifications</h1>
      <div className="detail-meta">
        Songs you asked to be reminded about (on the <Link href="/radar" className="text-link">release radar</Link> or a
        song page), and songs you&apos;ve collected changing status.
      </div>
      {!items && <div className="empty-state">loading…</div>}
      {items && items.length === 0 && (
        <div className="empty-state">Nothing yet. Press &ldquo;remind me&rdquo; on anything coming up.</div>
      )}
      {items?.map((n) => (
        <div key={n.id} className={`review-row ${n.read_at ? "" : "unread-note"}`} style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">{n.link ? <Link href={n.link}>{n.title}</Link> : n.title}</div>
            <div className="review-row-meta">
              {n.body && <span>{n.body}</span>}
              <span>{new Date(n.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>
          <button className="rating-chip" aria-label="Remove" onClick={() => remove(n)}>✕</button>
        </div>
      ))}
    </div>
  );
}
