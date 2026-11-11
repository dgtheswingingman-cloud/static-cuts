"use client";

// Inbox (moderators): everything waiting for a person on one page, most
// urgent first (takedowns, reported comments, suggestions and ChatGPT finds,
// album fixes, shows, sheets sent in, tracker disagreements), oldest first
// within each. Each row opens the list where it's decided. The big lists that
// are worked through in bulk are shown as counts at the bottom.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";
import { ModPage, ModRow, ModTag, ModNotice, ModLoading, ModEmpty, ModSection } from "../../components/Mod";

type Item = { priority: number; kind: string; label: string; title: string | null; artist: string | null; at: string; href: string };
type Counts = Record<string, number | null | undefined>;

const BIG: { key: string; title: string; href: string }[] = [
  { key: "sub_versions", title: "Sub-versions", href: "/review/versions" },
  { key: "duplicates", title: "Duplicates", href: "/review/duplicates" },
  { key: "imported_songs", title: "Imported songs", href: "/review/imports" },
  { key: "guest_artists", title: "Guest artists", href: "/review/guests" },
  { key: "cleanup", title: "Clean-up", href: "/review/cleanup" },
  { key: "deezer_check", title: "Deezer check", href: "/review/deezer" },
];

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function InboxPage() {
  const { loading: authLoading } = useAuth();
  const canModerate = useIsModerator();
  const [items, setItems] = useState<Item[] | null>(null);
  const [counts, setCounts] = useState<Counts>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canModerate) return;
    supabase.rpc("rpc_review_inbox", { p_limit: 300 }).then(({ data, error: err }) => {
      if (err) { setError(err.message); setItems([]); return; }
      setItems((data as Item[]) ?? []);
    });
    supabase.rpc("rpc_moderation_counts").then(({ data }) => setCounts((data as Counts) ?? {}));
  }, [canModerate]);

  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;
  const big = BIG.filter((b) => (counts[b.key] ?? 0) > 0);
  return (
    <ModPage title="Inbox" intro="Everything waiting for a person, most urgent first. Each one opens the list where it's decided.">
      {error && <ModNotice kind="error" onClose={() => setError(null)}>{error}</ModNotice>}
      {!items && <ModLoading />}
      {items && items.length === 0 && <ModEmpty>Nothing waiting. All clear.</ModEmpty>}
      {items?.map((i, n) => (
        <ModRow
          key={`${i.kind}-${n}`}
          title={<><ModTag kind={i.priority <= 2 ? "warn" : undefined}>{i.label}</ModTag> {i.title ?? "(untitled)"}</>}
          meta={<>
            {i.artist && <span>{i.artist}</span>}
            <span>{ago(i.at)}</span>
          </>}
          actions={<Link href={i.href} className="mod-btn plain">open</Link>}
        />
      ))}
      {big.length > 0 && (
        <>
          <ModSection>Big lists, worked through in bulk</ModSection>
          {big.map((b) => (
            <ModRow key={b.key} title={<Link href={b.href}>{b.title}</Link>}
              meta={<span>{(counts[b.key] ?? 0).toLocaleString("en-GB")} waiting</span>}
              actions={<Link href={b.href} className="mod-btn plain">open</Link>} />
          ))}
        </>
      )}
    </ModPage>
  );
}
