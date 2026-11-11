"use client";

// Cover suggestions (moderators): art for songs that have none, mostly leaks,
// suggested through the ChatGPT connector with the page it was found on.
// Approve and it's copied to Static-Cuts within a couple of minutes and
// becomes the song's cover (a fan cover from whoever suggested it, so fans
// can still out-vote it). Failed copies (dead links, not a picture) show here
// with the reason, to approve again or reject.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { thumb } from "@/lib/thumb";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";
import { ModPage, ModToolbar, ModTabs, ModRow, ModButton, ModBulkBar, ModTag, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

type State = "pending" | "approved" | "live" | "rejected";
type Item = {
  id: string; track_id: string; title: string; release_status: string | null; artist_id: string; artist: string;
  image_url: string; source_url: string; notes: string | null; note: string | null; status: string; by_name: string | null;
  current: { url: string; kind: string } | null;
};

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

export default function CoversPage() {
  const { loading: authLoading } = useAuth();
  const canModerate = useIsModerator();
  const [state, setState] = useState<State>("pending");
  const [items, setItems] = useState<Item[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load(s = state) {
    setItems(null); setSelected(new Set());
    const { data, error: err } = await supabase.rpc("admin_cover_suggestions", { p_status: s });
    if (err) { setError(err.message); setItems([]); return; }
    const d = data as { counts: Record<string, number> | null; items: Item[] };
    setCounts(d.counts ?? {}); setItems(d.items);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (canModerate) load(state); }, [canModerate, state]);

  async function act(ids: string[], action: "approve" | "reject") {
    if (!ids.length) return;
    setBusy(ids.length === 1 ? ids[0] : "bulk");
    const { data, error: err } = await supabase.rpc("admin_cover_suggestion_action", { p_ids: ids, p_action: action });
    setBusy(null);
    if (err) { setError(err.message); return; }
    const gone = new Set(ids);
    setItems((prev) => (prev ?? []).filter((x) => !gone.has(x.id)));
    setSelected(new Set());
    setDone(action === "approve" ? `${data} approved. They go live within a couple of minutes.` : `${data} rejected.`);
  }
  const toggle = (id: string, on: boolean) => setSelected((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const ticked = (items ?? []).filter((i) => selected.has(i.id)).map((i) => i.id);
  const canAct = state === "pending" || state === "approved";

  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;
  return (
    <ModPage title="Covers" intro="Cover art suggested for songs that have none, with the page it was found on. Approve and it's copied to Static-Cuts and shown as the song's cover within a couple of minutes.">
      <ModToolbar right={canAct && items && items.length > 1 ? <ModButton onClick={() => setSelected(new Set(items.map((i) => i.id)))}>tick all ({items.length.toLocaleString()})</ModButton> : undefined}>
        <ModTabs<State>
          value={state}
          onChange={setState}
          tabs={[
            { key: "pending", label: "Waiting", count: counts.pending ?? 0 },
            { key: "approved", label: "Copying / failed", count: (counts.approved ?? 0) + (counts.failed ?? 0) },
            { key: "live", label: "Live", count: counts.live ?? 0 },
            { key: "rejected", label: "Rejected", count: counts.rejected ?? 0 },
          ]}
        />
      </ModToolbar>
      {canAct && (
        <ModBulkBar count={ticked.length} onClear={() => setSelected(new Set())}>
          <ModButton kind="approve" busy={busy === "bulk"} onClick={() => act(ticked, "approve")}>approve</ModButton>
          <ModButton kind="danger" busy={busy === "bulk"} onClick={() => act(ticked, "reject")}>reject</ModButton>
        </ModBulkBar>
      )}
      {error && <ModNotice kind="error" onClose={() => setError(null)}>{error}</ModNotice>}
      {done && <ModNotice kind="done" onClose={() => setDone(null)}>{done}</ModNotice>}
      {!items && <ModLoading />}
      {items && items.length === 0 && <ModEmpty>Nothing here.</ModEmpty>}
      {items?.map((i) => (
        <ModRow
          key={i.id}
          check={canAct ? { checked: selected.has(i.id), onChange: (on) => toggle(i.id, on) } : undefined}
          title={<span className="cv-row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <a href={i.image_url} target="_blank" rel="noopener noreferrer"><img src={i.image_url} alt="" className="cv-new" referrerPolicy="no-referrer" /></a>
            <span>
              <Link href={`/song/${i.track_id}`} className="text-link">{i.title}</Link>
              {i.release_status && <> <ModTag>{i.release_status}</ModTag></>}
              {i.status === "failed" && <> <ModTag kind="warn">copy failed</ModTag></>}
            </span>
          </span>}
          meta={<>
            <Link href={`/artist/${i.artist_id}`}>{i.artist}</Link>
            <a href={i.source_url} target="_blank" rel="noopener noreferrer">found on {host(i.source_url)} ↗</a>
            {i.by_name && <span>from {i.by_name}</span>}
            {i.notes && <span>“{i.notes}”</span>}
            {i.note && <span>{i.note}</span>}
            {i.current && i.current.kind !== "own" && (
              <span className="cv-now">now shows
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb(i.current.url, 120)} alt="" /> ({i.current.kind === "artist" ? "artist photo" : i.current.kind === "era" ? "era art" : "fan cover"})</span>
            )}
          </>}
          actions={canAct ? <>
            <ModButton kind="approve" busy={busy === i.id} onClick={() => act([i.id], "approve")}>{i.status === "failed" ? "try again" : "approve"}</ModButton>
            <ModButton kind="danger" busy={busy === i.id} onClick={() => act([i.id], "reject")}>reject</ModButton>
          </> : undefined}
        />
      ))}
    </ModPage>
  );
}
