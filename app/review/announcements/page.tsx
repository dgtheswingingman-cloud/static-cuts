"use client";

// Shows, tours, festivals and merch drops (moderators). Reported by the
// ChatGPT connector or the daily check, with a source link. Approve to show
// it on the artist page under "Coming up"; dismiss to hide it. Trusted
// contributors' reports are approved already and can be dismissed here.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";
import { ModPage, ModToolbar, ModTabs, ModRow, ModButton, ModTag, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

type State = "open" | "approved" | "dismissed";
type Item = {
  id: string; artist_id: string; artist: string; kind: string; title: string; starts_on: string | null; ends_on: string | null;
  venue: string | null; city: string | null; country: string | null; source_url: string; notes: string | null; by_name: string | null;
};

export default function AnnouncementsPage() {
  const { loading: authLoading } = useAuth();
  const canModerate = useIsModerator();
  const [state, setState] = useState<State>("open");
  const [items, setItems] = useState<Item[] | null>(null);
  const [counts, setCounts] = useState<Partial<Record<State, number>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canModerate) return;
    setItems(null);
    supabase.rpc("admin_announcements", { p_state: state }).then(({ data, error: err }) => {
      if (err) { setError(err.message); setItems([]); return; }
      const d = data as { counts: Partial<Record<State, number>> | null; items: Item[] };
      setCounts(d.counts ?? {});
      setItems(d.items);
    });
  }, [canModerate, state]);

  async function act(i: Item, action: "approve" | "dismiss") {
    setBusy(i.id);
    const { error: err } = await supabase.rpc("admin_announcement_action", { p_ids: [i.id], p_action: action });
    setBusy(null);
    if (err) { setError(err.message); return; }
    setItems((prev) => (prev ?? []).filter((x) => x.id !== i.id));
  }

  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;
  return (
    <ModPage title="Shows & merch" intro="Shows, tours, festivals and merch drops for artist pages. Approved ones show under Coming up until they've passed.">
      <ModToolbar>
        <ModTabs<State>
          value={state}
          onChange={setState}
          tabs={[
            { key: "open", label: "Waiting", count: counts.open ?? 0 },
            { key: "approved", label: "On artist pages", count: counts.approved ?? 0 },
            { key: "dismissed", label: "Dismissed", count: counts.dismissed ?? 0 },
          ]}
        />
      </ModToolbar>
      {error && <ModNotice kind="error" onClose={() => setError(null)}>{error}</ModNotice>}
      {!items && <ModLoading />}
      {items && items.length === 0 && <ModEmpty>Nothing here.</ModEmpty>}
      {items?.map((i) => (
        <ModRow
          key={i.id}
          title={<>{i.title} <ModTag>{i.kind}</ModTag></>}
          meta={<>
            <Link href={`/artist/${i.artist_id}`}>{i.artist}</Link>
            {i.starts_on && <span>{i.starts_on}{i.ends_on && i.ends_on !== i.starts_on ? ` – ${i.ends_on}` : ""}</span>}
            {(i.venue || i.city) && <span>{[i.venue, i.city, i.country].filter(Boolean).join(", ")}</span>}
            <a href={i.source_url} target="_blank" rel="noopener noreferrer">source ↗</a>
            {i.by_name && <span>from {i.by_name}</span>}
            {i.notes && <span>{i.notes}</span>}
          </>}
          actions={<>
            {state !== "approved" && <ModButton kind="approve" busy={busy === i.id} onClick={() => act(i, "approve")}>approve</ModButton>}
            {state !== "dismissed" && <ModButton kind="danger" busy={busy === i.id} onClick={() => act(i, "dismiss")}>dismiss</ModButton>}
          </>}
        />
      ))}
    </ModPage>
  );
}
