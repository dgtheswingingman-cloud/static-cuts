"use client";

// Album fixes (moderators): suggestions waiting for review, and every album
// edit that's been applied (with undo). Kinds: wrong details, not this
// artist's album, same album as another (combine), an edition that's a
// different album (separate), a tracklist song linked to the wrong song.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";
import { ModPage, ModToolbar, ModTabs, ModRow, ModButton, ModTag, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

type Tab = "pending" | "approved" | "rejected" | "edits";
type Suggestion = {
  id: string; album_id: string; album_title: string | null; artist_id: string | null; artist: string | null; kind: string;
  payload: Record<string, unknown>; note: string | null; source_url: string | null; by_name: string | null; created_at: string;
  other_title: string | null; track_title: string | null; reviewer_note: string | null;
};
type Edit = { id: string; album_id: string; album_title: string | null; kind: string; payload: Record<string, unknown>;
  before: Record<string, unknown> | null; by_name: string | null; done_at: string; undone_at: string | null };

const KIND: Record<string, string> = {
  details: "details", not_artist: "not this artist's", same_as: "same album", not_same: "different album", tracklist: "tracklist",
};

function describe(kind: string, p: Record<string, unknown>, other: string | null, track: string | null) {
  if (kind === "details") return Object.entries(p).map(([k, v]) => `${k.replace("_", " ")} → ${v}`).join(" · ");
  if (kind === "same_as") return `combine with ${other ?? p.other_album_id}`;
  if (kind === "not_same") return "show as its own album";
  if (kind === "not_artist") return "take off this artist's page";
  if (kind === "tracklist") return `row ${p.position}${Number(p.disk ?? 1) > 1 ? ` (disc ${p.disk})` : ""} → ${p.track_id ? track ?? p.track_id : "not on the site"}`;
  return "";
}

export default function AlbumFixesPage() {
  const { loading: authLoading } = useAuth();
  const canModerate = useIsModerator();
  const [tab, setTab] = useState<Tab>("pending");
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(t = tab) {
    setItems(null);
    const { data, error: err } = await supabase.rpc("admin_album_suggestions", { p_status: t === "edits" ? "pending" : t });
    if (err) { setError(err.message); setItems([]); return; }
    const d = data as { counts: Record<string, number>; items: Suggestion[]; edits: Edit[] };
    setCounts(d.counts ?? {});
    setItems(d.items);
    setEdits(d.edits ?? []);
  }
  useEffect(() => { if (canModerate) load(tab); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [canModerate, tab]);

  async function act(s: Suggestion, action: "approve" | "reject") {
    setBusy(s.id);
    const { error: err } = await supabase.rpc("admin_album_suggestion_action", { p_id: s.id, p_action: action, p_note: null });
    setBusy(null);
    if (err) { setError(err.message); return; }
    setItems((prev) => (prev ?? []).filter((x) => x.id !== s.id));
  }
  async function undo(e: Edit) {
    setBusy(e.id);
    const { error: err } = await supabase.rpc("admin_album_undo", { p_edit: e.id });
    setBusy(null);
    if (err) { setError(err.message); return; }
    setEdits((prev) => prev.map((x) => (x.id === e.id ? { ...x, undone_at: new Date().toISOString() } : x)));
  }

  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;
  return (
    <ModPage title="Album fixes" intro="Suggested album fixes, and every album edit made (undo any of them). Moderators and trusted contributors' fixes apply straight away.">
      <ModToolbar>
        <ModTabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "pending", label: "Waiting", count: counts.pending ?? 0 },
            { key: "approved", label: "Approved", count: counts.approved ?? 0 },
            { key: "rejected", label: "Rejected", count: counts.rejected ?? 0 },
            { key: "edits", label: "Edits & undo", count: null },
          ]}
        />
      </ModToolbar>
      {error && <ModNotice kind="error" onClose={() => setError(null)}>{error}</ModNotice>}
      {!items && <ModLoading />}

      {tab !== "edits" && items && items.length === 0 && <ModEmpty>Nothing here.</ModEmpty>}
      {tab !== "edits" && items?.map((s) => (
        <ModRow
          key={s.id}
          title={<><Link href={`/album/${s.album_id}`}>{s.album_title ?? s.album_id}</Link> <ModTag>{KIND[s.kind] ?? s.kind}</ModTag></>}
          meta={<>
            <span>{describe(s.kind, s.payload, s.other_title, s.track_title)}</span>
            {s.artist_id && <Link href={`/artist/${s.artist_id}`}>{s.artist}</Link>}
            {s.by_name && <span>from {s.by_name}</span>}
            {s.note && <span>“{s.note}”</span>}
            {s.source_url && <a href={s.source_url} target="_blank" rel="noopener noreferrer">source ↗</a>}
            {s.reviewer_note && <span>{s.reviewer_note}</span>}
          </>}
          actions={tab === "pending" ? <>
            <ModButton kind="approve" busy={busy === s.id} onClick={() => act(s, "approve")}>approve</ModButton>
            <ModButton kind="danger" busy={busy === s.id} onClick={() => act(s, "reject")}>reject</ModButton>
          </> : undefined}
        />
      ))}

      {tab === "edits" && edits.length === 0 && items && <ModEmpty>No album edits yet.</ModEmpty>}
      {tab === "edits" && edits.map((e) => (
        <ModRow
          key={e.id}
          title={<><Link href={`/album/${e.album_id}`}>{e.album_title ?? e.album_id}</Link> <ModTag>{KIND[e.kind] ?? e.kind}</ModTag>
            {e.undone_at && <ModTag kind="warn">undone</ModTag>}</>}
          meta={<>
            <span>{describe(e.kind, e.payload, null, null)}</span>
            {e.by_name && <span>by {e.by_name}</span>}
            <span>{new Date(e.done_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </>}
          actions={!e.undone_at ? <ModButton kind="danger" busy={busy === e.id} confirm="Undo this album edit?" onClick={() => undo(e)}>undo</ModButton> : undefined}
        />
      ))}
    </ModPage>
  );
}
