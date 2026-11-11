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
import { ModPage, ModToolbar, ModTabs, ModRow, ModButton, ModBulkBar, ModTag, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

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
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!canModerate) return;
    setItems(null);
    setSelected(new Set());
    supabase.rpc("admin_announcements", { p_state: state }).then(({ data, error: err }) => {
      if (err) { setError(err.message); setItems([]); return; }
      const d = data as { counts: Partial<Record<State, number>> | null; items: Item[] };
      setCounts(d.counts ?? {});
      setItems(d.items);
    });
  }, [canModerate, state]);

  async function act(ids: string[], action: "approve" | "dismiss") {
    if (ids.length === 0) return;
    setBusy(ids.length === 1 ? ids[0] : "bulk");
    const { error: err } = await supabase.rpc("admin_announcement_action", { p_ids: ids, p_action: action });
    setBusy(null);
    if (err) { setError(err.message); return; }
    const gone = new Set(ids);
    setItems((prev) => (prev ?? []).filter((x) => !gone.has(x.id)));
    setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
    setCounts((c) => ({ ...c, [state]: Math.max(0, (c[state] ?? 0) - ids.length) }));
  }
  const toggle = (id: string, on: boolean) => setSelected((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
  const ticked = (items ?? []).filter((i) => selected.has(i.id)).map((i) => i.id);

  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;
  return (
    <ModPage title="Shows & merch" intro="Shows, tours, festivals and merch drops for artist pages. Approved ones show under Coming up until they've passed.">
      <ModToolbar right={items && items.length > 1 ? <ModButton onClick={() => setSelected(new Set(items.map((i) => i.id)))}>tick all ({items.length.toLocaleString()})</ModButton> : undefined}>
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
      <ModBulkBar count={ticked.length} onClear={() => setSelected(new Set())}>
        {state !== "approved" && <ModButton kind="approve" busy={busy === "bulk"} onClick={() => act(ticked, "approve")}>approve</ModButton>}
        {state !== "dismissed" && <ModButton kind="danger" busy={busy === "bulk"} onClick={() => act(ticked, "dismiss")}>dismiss</ModButton>}
      </ModBulkBar>
      {error && <ModNotice kind="error" onClose={() => setError(null)}>{error}</ModNotice>}
      {!items && <ModLoading />}
      {items && items.length === 0 && <ModEmpty>Nothing here.</ModEmpty>}
      {items?.map((i) => (
        <ModRow
          key={i.id}
          check={{ checked: selected.has(i.id), onChange: (on) => toggle(i.id, on) }}
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
            {state !== "approved" && <ModButton kind="approve" busy={busy === i.id} onClick={() => act([i.id], "approve")}>approve</ModButton>}
            {state !== "dismissed" && <ModButton kind="danger" busy={busy === i.id} onClick={() => act([i.id], "dismiss")}>dismiss</ModButton>}
          </>}
        />
      ))}
    </ModPage>
  );
}
