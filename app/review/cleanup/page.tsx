"use client";

// Clean-up (moderators): entries that don't look like songs (interviews,
// podcasts, full-album uploads, tracklists, cover art...) and empty
// placeholders ("???", "Unknown Song 3" with nothing on them). Tick and
// delete, or keep (then they're never listed again). Deleting can be undone
// from the undo history. Nothing here is deleted automatically.
// Wrong links: Spotify links whose title and artist don't match what Spotify
// says (found by the link checker). Clear the link, or say it's right.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";
import { ModPage, ModToolbar, ModTabs, ModRow, ModButton, ModTag, ModBulkBar, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

type Kind = "not_song" | "placeholder" | "links";
type Item = {
  id: string; title: string; artist_id: string; artist: string; status: string | null; source?: string | null;
  album?: string | null; kind?: Kind; versions?: number; collected?: number;
  spotify_url?: string; spotify_title?: string | null; spotify_artists?: string | null;
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
    const [list, links] = await Promise.all([
      supabase.rpc("admin_cleanup_list", { p_kind: k === "links" ? "not_song" : k, p_limit: k === "links" ? 1 : 500 }),
      supabase.rpc("admin_link_issues", { p_limit: k === "links" ? 500 : 1 }),
    ]);
    const err = list.error ?? links.error;
    if (err) { setError(err.message); setItems([]); return; }
    const d = list.data as { counts: Record<"not_song" | "placeholder", number>; items: Item[] };
    const l = links.data as { count: number; items: Item[] };
    setCounts({ ...d.counts, links: l.count });
    setItems(k === "links" ? l.items : d.items);
    setTicked(new Set());
  }
  useEffect(() => { if (canModerate) load(kind); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [canModerate, kind]);

  async function act(ids: string[], action: "delete" | "keep") {
    if (!ids.length) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = kind === "links"
      ? await supabase.rpc("admin_link_issue_action", { p_ids: ids, p_action: action === "delete" ? "clear" : "ok" })
      : await supabase.rpc("admin_cleanup_action", { p_ids: ids, p_action: action });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setDone(kind === "links"
      ? (action === "delete" ? `Cleared ${data} link${data === 1 ? "" : "s"} (undo from the undo history).` : `Marked ${data} as right: they won't be listed again.`)
      : action === "delete" ? `Deleted ${data} (undo from the undo history).` : `Kept ${data}: they won't be listed again.`);
    setItems((prev) => (prev ?? []).filter((x) => !ids.includes(x.id)));
    setCounts((c) => (c ? { ...c, [kind]: Math.max(0, c[kind] - ids.length) } : c));
    setTicked(new Set());
  }

  const toggle = (id: string, on: boolean) => setTicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;
  return (
    <ModPage
      title="Clean-up"
      intro="Entries that don't look like songs, empty placeholders, and Spotify links that point at a different song. Delete what isn't a song; keep anything that is (it won't be listed again). Deletes can be undone from the undo history."
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
            { key: "links", label: "Wrong links", count: counts?.links ?? null },
          ]}
        />
      </ModToolbar>
      {error && <ModNotice kind="error" onClose={() => setError(null)}>{error}</ModNotice>}
      {done && <ModNotice kind="done" onClose={() => setDone(null)}>{done}</ModNotice>}
      <ModBulkBar count={ticked.size} onClear={() => setTicked(new Set())}>
        <ModButton kind="danger" busy={busy}
          confirm={kind === "links" ? `Clear ${ticked.size} Spotify link${ticked.size === 1 ? "" : "s"}?` : `Delete ${ticked.size} entr${ticked.size === 1 ? "y" : "ies"}? (Undo from the undo history.)`}
          onClick={() => act([...ticked], "delete")}>{kind === "links" ? "clear link" : "delete"}</ModButton>
        <ModButton kind="approve" busy={busy} onClick={() => act([...ticked], "keep")}>{kind === "links" ? "link is right" : "keep"}</ModButton>
      </ModBulkBar>
      {!items && <ModLoading />}
      {items && items.length === 0 && <ModEmpty>Nothing to clean up here.</ModEmpty>}
      {items?.map((i) => (
        <ModRow
          key={i.id}
          check={{ checked: ticked.has(i.id), onChange: (v) => toggle(i.id, v) }}
          title={<>
            <Link href={`/song/${i.id}`}>{i.title}</Link>
            {(i.versions ?? 0) > 0 && <ModTag kind="warn">{i.versions} version{i.versions === 1 ? "" : "s"}</ModTag>}
            {(i.collected ?? 0) > 0 && <ModTag kind="warn">collected by {i.collected}</ModTag>}
          </>}
          meta={<>
            <Link href={`/artist/${i.artist_id}`}>{i.artist}</Link>
            {i.spotify_url && (
              <a href={i.spotify_url} target="_blank" rel="noopener noreferrer">
                Spotify says: {i.spotify_title ?? "?"}{i.spotify_artists ? ` by ${i.spotify_artists}` : ""} ↗
              </a>
            )}
            {i.status && <span>{i.status}</span>}
            {i.album && <span>{i.album}</span>}
            {i.source && <span>from {i.source}</span>}
          </>}
          actions={<>
            <ModButton kind="danger" busy={busy} confirm={kind === "links" ? `Clear the Spotify link on "${i.title}"?` : `Delete "${i.title}"?`}
              onClick={() => act([i.id], "delete")}>{kind === "links" ? "clear link" : "delete"}</ModButton>
            <ModButton kind="approve" busy={busy} onClick={() => act([i.id], "keep")}>{kind === "links" ? "link is right" : "keep"}</ModButton>
          </>}
        />
      ))}
    </ModPage>
  );
}
