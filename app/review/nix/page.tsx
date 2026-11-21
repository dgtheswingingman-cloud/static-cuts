"use client";
import "../../styles/nix-suggest.css";

// NIX suggestions: what NIX (on the owner's PC, free) proposes after reading
// the archive: facts from song notes, eras for unreleased songs, sub-versions
// it thinks were linked wrongly, and cleaned-up titles. Nothing changes until
// someone accepts; accepted ones go in as one undoable batch.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";
import { ModPage, ModToolbar, ModTabs, ModRow, ModButton, ModTag, ModBulkBar, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

type Kind = "notes" | "eras" | "audit" | "titles";
type Item = {
  id: number; track_id: string; title: string; artist_id: string; artist: string | null; status: string | null;
  field: string; current: string | null; suggested: string; note: string | null; model: string | null; sure: string | null;
};
type Data = { counts: Record<string, number>; left: Record<string, number>; items: Item[] };

const FIELD: Record<string, string> = {
  leak_date: "Leak date", producers: "Producers", featured_artists: "Featuring", aliases: "Also known as",
  album: "Era", title: "Title", parent: "Version of",
};
const ABOUT: Record<Kind, string> = {
  notes: "Facts NIX found written in a song's notes, for fields that are empty. Only what the notes actually say.",
  eras: "Unreleased songs with no era: the era NIX thinks they belong to, picked only from the artist's existing eras.",
  audit: "Sub-versions Claude linked automatically that NIX thinks are a different song. Accepting unlinks it from that main song.",
  titles: "Titles with leftovers ([CDQ], (prod. X), .mp3): the clean title, with the old one kept as another name.",
};

export default function NixSuggestionsPage() {
  const { loading: authLoading } = useAuth();
  const canModerate = useIsModerator();
  const [kind, setKind] = useState<Kind>("titles");
  const [d, setD] = useState<Data | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load(k: Kind = kind) {
    const { data, error: err } = await supabase.rpc("admin_nix_suggestions", { p_kind: k, p_limit: 300 });
    if (err) { setError(err.message); return; }
    setD(data as Data);
  }
  useEffect(() => { if (canModerate) { setD(null); setTicked(new Set()); load(kind); } }, [canModerate, kind]);

  async function decide(ids: number[], accept: boolean) {
    if (!ids.length) return;
    setBusy(true);
    const { data, error: err } = await supabase.rpc("admin_nix_suggestions_decide", { p_ids: ids, p_accept: accept });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setDone(accept ? `${data} change${data === 1 ? "" : "s"} made (undo from the undo history).` : `${data} dismissed.`);
    setTicked(new Set());
    load();
  }
  const toggle = (id: number, on: boolean) => setTicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;
  const items = d?.items ?? [];
  const count = (k: Kind) => d?.counts?.[k] ?? 0;

  return (
    <ModPage
      title="NIX suggestions"
      intro={<>
        What NIX proposes after reading the archive on the owner&apos;s PC, surest first. Your accepts and dismissals
        teach it: recent ones go into its next prompts. Nothing changes until you accept;
        accepted ones go in as one batch you can undo from the <UndoHistoryLink />. NIX keeps working through the
        archive while the PC is on, so these lists keep growing. <Link href="/nix" className="text-link">NIX</Link>
      </>}
    >
      <ModToolbar
        sticky
        right={items.length > 0 && (<>
          {items.some((i) => i.sure === "high") && (
            <button className="mod-link" onClick={() => setTicked(new Set(items.filter((i) => i.sure === "high").map((i) => i.id)))}>
              tick the sure ones
            </button>
          )}
          <button className="mod-link" onClick={() => setTicked(ticked.size === items.length ? new Set() : new Set(items.map((i) => i.id)))}>
            {ticked.size === items.length ? "untick all" : "tick all"}
          </button>
        </>)}
      >
        <ModTabs<Kind>
          value={kind}
          onChange={setKind}
          tabs={[
            { key: "titles", label: "Titles", count: d ? count("titles") : null },
            { key: "audit", label: "Version audit", count: d ? count("audit") : null },
            { key: "notes", label: "From notes", count: d ? count("notes") : null },
            { key: "eras", label: "Eras", count: d ? count("eras") : null },
          ]}
        />
      </ModToolbar>
      <p className="nix-sug-about">
        {ABOUT[kind]}
        {d && (d.left?.[kind] ?? 0) > 0 && <> NIX still has {(d.left[kind]).toLocaleString("en-GB")} to look at.</>}
      </p>
      {error && <ModNotice kind="error" onClose={() => setError(null)}>{error}</ModNotice>}
      {done && <ModNotice kind="done" onClose={() => setDone(null)}>{done}</ModNotice>}
      <ModBulkBar count={ticked.size} onClear={() => setTicked(new Set())}>
        <ModButton kind="approve" busy={busy} onClick={() => decide([...ticked], true)}>accept</ModButton>
        <ModButton busy={busy} onClick={() => decide([...ticked], false)}>dismiss</ModButton>
      </ModBulkBar>

      {!d && <ModLoading />}
      {d && items.length === 0 && <ModEmpty>Nothing waiting here yet. NIX adds to this list as it works.</ModEmpty>}
      {items.map((i) => (
        <ModRow
          key={i.id}
          check={{ checked: ticked.has(i.id), onChange: (v) => toggle(i.id, v) }}
          title={<>
            <Link href={`/song/${i.track_id}`}>{i.title}</Link>
            {i.status && <ModTag>{i.status}</ModTag>}
            {i.sure && <ModTag kind={i.sure === "high" ? "good" : i.sure === "low" ? "warn" : undefined}>{i.sure === "high" ? "NIX is sure" : i.sure === "low" ? "NIX unsure" : "fairly sure"}</ModTag>}
          </>}
          meta={<>
            {i.artist && <Link href={`/artist/${i.artist_id}`}>{i.artist}</Link>}
            <span className="nix-sug-change">
              <b>{FIELD[i.field] ?? i.field}:</b>{" "}
              {i.field === "parent"
                ? <>unlink from &ldquo;{i.current ?? "?"}&rdquo;</>
                : <>{i.current ? <s>{i.current}</s> : <em>empty</em>} → <strong>{i.suggested}</strong></>}
            </span>
            {i.note && <span className="nix-sug-note">NIX: {i.note}</span>}
          </>}
          actions={<>
            <ModButton kind="approve" busy={busy} onClick={() => decide([i.id], true)}>accept</ModButton>
            <ModButton busy={busy} onClick={() => decide([i.id], false)}>dismiss</ModButton>
          </>}
        />
      ))}
    </ModPage>
  );
}
