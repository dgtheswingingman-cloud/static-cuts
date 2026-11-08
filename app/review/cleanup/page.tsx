"use client";

// Clean-up (moderators): entries that don't look like songs (interviews,
// podcasts, full-album uploads, tracklists, cover art...) and empty
// placeholders ("???", "Unknown Song 3" with nothing on them). Tick and
// delete, or keep (then they're never listed again). Deleting can be undone
// from the undo history. Nothing here is deleted automatically.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";
import { ModPage, ModToolbar, ModTabs, ModRow, ModButton, ModTag, ModBulkBar, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

type Kind = "not_song" | "placeholder";
type Item = {
  id: string; title: string; artist_id: string; artist: string; status: string | null; source: string | null;
  album: string | null; kind: Kind; versions: number; collected: number;
};

export default function CleanupPage() {
  const { loading: authLoading } = useAuth();
  const canModerate = useIsModerator();
  const [kind, setKind] = useState<Kind>("not_song");
  const [items, setItems] = useState<Item[] | null>(null);
  const [counts, setCounts] = useState<Record<Kind, number> | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load(k = kind) {
    setItems(null);
    const { data, error: err } = await supabase.rpc("admin_cleanup_list", { p_kind: k, p_limit: 500 });
    if (err) { setError(err.message); setItems([]); return; }
    const d = data as { counts: Record<Kind, number>; items: Item[] };
    setCounts(d.counts);
    setItems(d.items);
    setTicked(new Set());
  }
  useEffect(() => { if (canModerate) load(kind); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [canModerate, kind]);

  async function act(ids: string[], action: "delete" | "keep") {
    if (!ids.length) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("admin_cleanup_action", { p_ids: ids, p_action: action });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setDone(action === "delete" ? `Deleted ${data} (undo from the undo history).` : `Kept ${data}: they won't be listed again.`);
    setItems((prev) => (prev ?? []).filter((x) => !ids.includes(x.id)));
    setCounts((c) => (c ? { ...c, [kind]: Math.max(0, c[kind] - ids.length) } : c));
    setTicked(new Set());
  }

  const toggle = (id: string, on: boolean) => setTicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;
  return (
    <ModPage
      title="Clean-up"
      intro="Entries that don't look like songs, and empty placeholders. Delete what isn't a song; keep anything that is (it won't be listed again). Deletes can be undone from the undo history."
    >
      <ModToolbar
        sticky
        right={items && items.length > 0 && (
          <button className="mod-link" onClick={() => setTicked(ticked.size === items.length ? new Set() : new Set(items.map((i) => i.id)))}>
            {ticked.size === items.length ? "untick all" : "tick all"}
          </button>
        )}
      >
        <ModTabs<Kind>
          value={kind}
          onChange={setKind}
          tabs={[
            { key: "not_song", label: "Not songs", count: counts?.not_song ?? null },
            { key: "placeholder", label: "Empty placeholders", count: counts?.placeholder ?? null },
          ]}
        />
      </ModToolbar>
      {error && <ModNotice kind="error" onClose={() => setError(null)}>{error}</ModNotice>}
      {done && <ModNotice kind="done" onClose={() => setDone(null)}>{done}</ModNotice>}
      <ModBulkBar count={ticked.size} onClear={() => setTicked(new Set())}>
        <ModButton kind="danger" busy={busy} confirm={`Delete ${ticked.size} entr${ticked.size === 1 ? "y" : "ies"}? (Undo from the undo history.)`}
          onClick={() => act([...ticked], "delete")}>delete</ModButton>
        <ModButton kind="approve" busy={busy} onClick={() => act([...ticked], "keep")}>keep</ModButton>
      </ModBulkBar>
      {!items && <ModLoading />}
      {items && items.length === 0 && <ModEmpty>Nothing to clean up here.</ModEmpty>}
      {items?.map((i) => (
        <ModRow
          key={i.id}
          check={{ checked: ticked.has(i.id), onChange: (v) => toggle(i.id, v) }}
          title={<>
            <Link href={`/song/${i.id}`}>{i.title}</Link>
            {i.versions > 0 && <ModTag kind="warn">{i.versions} version{i.versions === 1 ? "" : "s"}</ModTag>}
            {i.collected > 0 && <ModTag kind="warn">collected by {i.collected}</ModTag>}
          </>}
          meta={<>
            <Link href={`/artist/${i.artist_id}`}>{i.artist}</Link>
            {i.status && <span>{i.status}</span>}
            {i.album && <span>{i.album}</span>}
            {i.source && <span>from {i.source}</span>}
          </>}
          actions={<>
            <ModButton kind="danger" busy={busy} confirm={`Delete "${i.title}"?`} onClick={() => act([i.id], "delete")}>delete</ModButton>
            <ModButton kind="approve" busy={busy} onClick={() => act([i.id], "keep")}>keep</ModButton>
          </>}
        />
      ))}
    </ModPage>
  );
}
