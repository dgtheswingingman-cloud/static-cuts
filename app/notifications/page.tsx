"use client";

// Your notifications: songs you asked to be reminded about, and songs you've
// collected changing status. In admin mode this page shows admin alerts
// instead (failed background jobs, takedowns...), which never appear in your
// own account's notifications.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin } from "../useIsAdmin";
import { ModPage, ModRow, ModButton, ModTag, ModLoading, ModEmpty } from "../components/Mod";

type Note = { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };

export default function NotificationsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const [items, setItems] = useState<Note[] | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    setItems(null);
    supabase.rpc("rpc_my_notifications", { p_limit: 100, p_admin: isAdmin }).then(({ data }) => {
      const d = data as { items: Note[] } | null;
      setItems(d?.items ?? []);
      // Opening the page counts as reading them.
      if ((d?.items ?? []).some((n) => !n.read_at)) supabase.rpc("rpc_mark_notifications_read", { p_admin: isAdmin });
    });
  }, [authLoading, user, router, isAdmin]);

  async function remove(n: Note) {
    await supabase.from("notifications").delete().eq("id", n.id);
    setItems((prev) => (prev ?? []).filter((x) => x.id !== n.id));
  }

  return (
    <ModPage
      title={isAdmin ? "Admin alerts" : "Notifications"}
      back={isAdmin ? "/control" : null}
      intro={isAdmin ? (
        <>Things that need the admin: background jobs that failed, takedown requests and the like. These only show in admin mode.</>
      ) : (
        <>Songs you asked to be reminded about (on the <Link href="/radar" className="text-link">release radar</Link> or a
        song page), and songs you&apos;ve collected changing status.</>
      )}
    >
      {!items && <ModLoading />}
      {items && items.length === 0 && (
        <ModEmpty>{isAdmin ? "No alerts. All quiet." : <>Nothing yet. Press &ldquo;remind me&rdquo; on anything coming up.</>}</ModEmpty>
      )}
      {items?.map((n) => (
        <ModRow
          key={n.id}
          title={<>{n.link ? <Link href={n.link}>{n.title}</Link> : n.title}{!n.read_at && <ModTag kind="good">new</ModTag>}</>}
          meta={<>
            {n.body && <span>{n.body}</span>}
            <span>{new Date(n.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </>}
          actions={<ModButton kind="dismiss" onClick={() => remove(n)}>{isAdmin ? "dismiss" : "remove"}</ModButton>}
        />
      ))}
    </ModPage>
  );
}
