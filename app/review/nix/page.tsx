"use client";
import "../../styles/nix-suggest.css";

// NIX suggestions: what NIX (on the owner's PC, free) proposes after reading
// the archive: facts from song notes, eras for unreleased songs, sub-versions
// it thinks were linked wrongly, and cleaned-up titles. Nothing changes until
// someone accepts; accepted ones go in as one undoable batch.
// Claude checks every suggestion (nix-check) and the list is split by what it
// thought: agrees, disagrees, unsure, not checked yet.

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
  check: "agree" | "corrected" | "disagree" | "unsure" | null; check_answer: string | null; check_note: string | null;
  corrected: string | null; final_side: "nix" | "checker" | "neither" | "unsure" | null; final_note: string | null;
};
type Pile = "agree" | "corrected" | "disagree" | "unsure" | "unchecked";
type Data = { counts: Record<string, number>; left: Record<string, number>; piles: Record<Pile, number>; items: Item[] };
const PILES: { key: Pile; label: string }[] = [
  { key: "agree", label: "Claude agrees" }, { key: "corrected", label: "Claude corrected" }, { key: "disagree", label: "Claude disagrees" },
  { key: "unsure", label: "Claude unsure" }, { key: "unchecked", label: "Not checked yet" },
];

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
  const [pile, setPile] = useState<Pile>("agree");
  const [d, setD] = useState<Data | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load(k: Kind = kind, p: Pile = pile) {
    const { data, error: err } = await supabase.rpc("admin_nix_suggestions", { p_kind: k, p_limit: 300, p_pile: p });
    if (err) { setError(err.message); return; }
    setD(data as Data);
  }
  useEffect(() => { if (canModerate) { setD(null); setTicked(new Set()); load(kind, pile); } }, [canModerate, kind, pile]);

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
        What NIX proposes after reading the archive on the owner&apos;s PC, surest first. Claude checks every one
        and sorts them by whether it agrees. Your accepts and dismissals, and Claude&apos;s disagreements,
        teach NIX: recent ones go into its next prompts. Nothing changes until you accept;
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
      <div className="nix-sug-piles" role="tablist">
        {PILES.map((p) => (
          <button key={p.key} role="tab" aria-selected={pile === p.key}
            className={`nix-sug-pile nix-sug-pile-${p.key}${pile === p.key ? " is-on" : ""}`} onClick={() => setPile(p.key)}>
            {p.label}{d?.piles ? <span>{(d.piles[p.key] ?? 0).toLocaleString("en-GB")}</span> : null}
          </button>
        ))}
      </div>
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
      {d && items.length === 0 && <ModEmpty>{pile === "unchecked" || (d.piles?.unchecked ?? 0) === 0
        ? "Nothing waiting here yet. NIX adds to this list as it works."
        : "Nothing in this pile yet. Claude is still checking the rest."}</ModEmpty>}
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
                : i.corrected
                ? <>{i.current ? <s>{i.current}</s> : <em>empty</em>} → <s>{i.suggested}</s> <strong>{i.corrected}</strong></>
                : <>{i.current ? <s>{i.current}</s> : <em>empty</em>} → <strong>{i.suggested}</strong></>}
            </span>
            {i.note && <span className="nix-sug-note">NIX: {i.note}</span>}
            {i.final_side && i.final_side !== "unsure" ? (
              // The final say on a disagreement replaces the first check.
              <span className={`nix-sug-check nix-sug-check-${i.final_side === "nix" ? "agree" : "disagree"}`}>
                Final say: {i.final_side === "nix" ? "NIX was right" : i.corrected ? `should be “${i.corrected}”` : "NIX was wrong"}
                {i.final_note ? <> ({i.final_note})</> : null}
              </span>
            ) : i.check && (
              <span className={`nix-sug-check nix-sug-check-${i.check}`}>
                Claude {i.check === "agree" ? "agrees" : i.check === "disagree" ? "disagrees" : "isn't sure"}
                {i.check === "disagree" && i.check_answer ? <>: {i.check_answer}</> : null}
                {i.check_note ? <> ({i.check_note})</> : null}
                {i.check === "disagree" && i.final_side === "unsure" ? " · final say couldn't tell" : null}
              </span>
            )}
          </>}
          actions={<>
            <ModButton kind="approve" busy={busy} onClick={() => decide([i.id], true)}>{i.corrected ? "accept corrected" : "accept"}</ModButton>
            <ModButton busy={busy} onClick={() => decide([i.id], false)}>dismiss</ModButton>
          </>}
        />
      ))}
    </ModPage>
  );
}
