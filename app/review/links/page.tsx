"use client";
import "../../styles/review-links.css";

// Found links: possible listen links the search jobs found for songs
// (mostly YouTube uploads). NIX reads each one next to the song, Claude
// checks it and the final say settles disagreements. Piles by the answer
// that stands: right link, wrong (another version or song), unsure, and not
// looked at yet. "Use" puts the link on the song (undoable); "remove" drops
// the found link (the song isn't touched).

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";
import { ModPage, ModToolbar, ModTabs, ModRow, ModButton, ModTag, ModBulkBar, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

type Pile = "match" | "wrong" | "unsure" | "waiting";
type Item = {
  id: string; url: string; link_title: string | null; source_domain: string | null; link_kind: string | null;
  track_id: string; title: string; release_status: string | null; current_url: string | null; artist_id: string | null; artist: string | null;
  verdict: string | null; note: string | null; check_verdict: string | null; check_answer: string | null; check_note: string | null;
  final_side: string | null; final_answer: string | null; final_note: string | null; settled: string;
};
type Data = { piles: Record<Pile, number>; items: Item[] };

const SAYS: Record<string, string> = { match: "the right link", wrong_version: "another version", wrong_song: "a different song", unsure: "can't tell" };

export default function FoundLinksPage() {
  const { loading: authLoading } = useAuth();
  const canModerate = useIsModerator();
  const [pile, setPile] = useState<Pile>("match");
  const [d, setD] = useState<Data | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load(p: Pile = pile) {
    const { data, error: err } = await supabase.rpc("admin_nix_links", { p_pile: p, p_limit: 300 });
    if (err) { setError(err.message); return; }
    setD(data as Data);
  }
  useEffect(() => { if (canModerate) { setD(null); setTicked(new Set()); load(pile); } }, [canModerate, pile]);

  async function use(ids: string[]) {
    if (!ids.length) return;
    setBusy(true);
    let n = 0;
    for (const id of ids) {
      const { error: err } = await supabase.rpc("admin_use_link_candidate", { p_candidate: id });
      if (err) { setError(err.message); break; }
      n++;
    }
    setBusy(false);
    setDone(`${n} link${n === 1 ? "" : "s"} put on their songs (undo from the undo history).`);
    setTicked(new Set());
    load();
  }
  async function remove(ids: string[]) {
    if (!ids.length) return;
    setBusy(true);
    const { data, error: err } = await supabase.rpc("admin_remove_link_candidates", { p_ids: ids });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setDone(`${data} found link${data === 1 ? "" : "s"} removed.`);
    setTicked(new Set());
    load();
  }
  const toggle = (id: string, on: boolean) => setTicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;
  const items = d?.items ?? [];
  const count = (p: Pile) => (d ? d.piles?.[p] ?? 0 : null);

  return (
    <ModPage
      title="Found links"
      intro={<>
        Possible listen links the search jobs found for songs. NIX compares each link&apos;s title with the song,
        Claude checks it, and when they disagree a more careful pass has the final say. Play one before using it if
        you&apos;re not sure. Using a link puts it on the song as its main link (undo from the <UndoHistoryLink />);
        removing one only drops the found link. <Link href="/control?tab=nix" className="text-link">NIX</Link>
      </>}
    >
      <ModToolbar
        sticky
        right={items.length > 0 && (
          <button className="mod-link" onClick={() => setTicked(ticked.size === items.length ? new Set() : new Set(items.map((i) => i.id)))}>
            {ticked.size === items.length ? "untick all" : "tick all"}
          </button>
        )}
      >
        <ModTabs<Pile>
          value={pile}
          onChange={setPile}
          tabs={[
            { key: "match", label: "Right link", count: count("match") },
            { key: "wrong", label: "Wrong version or song", count: count("wrong") },
            { key: "unsure", label: "Unsure", count: count("unsure") },
            { key: "waiting", label: "Not looked at yet", count: count("waiting") },
          ]}
        />
      </ModToolbar>
      {error && <ModNotice kind="error" onClose={() => setError(null)}>{error}</ModNotice>}
      {done && <ModNotice kind="done" onClose={() => setDone(null)}>{done}</ModNotice>}
      <ModBulkBar count={ticked.size} onClear={() => setTicked(new Set())}>
        {pile !== "wrong" && <ModButton kind="approve" busy={busy} onClick={() => use([...ticked])}>use</ModButton>}
        <ModButton busy={busy} onClick={() => remove([...ticked])}>remove</ModButton>
      </ModBulkBar>

      {!d && <ModLoading />}
      {d && items.length === 0 && <ModEmpty>{pile === "waiting" ? "NIX has looked at every found link." : "Nothing in this pile yet. NIX and Claude are still working through them."}</ModEmpty>}
      {items.map((i) => (
        <ModRow
          key={i.id}
          check={{ checked: ticked.has(i.id), onChange: (v) => toggle(i.id, v) }}
          title={<>
            <Link href={`/song/${i.track_id}`}>{i.title}</Link>
            {i.release_status && <ModTag>{i.release_status}</ModTag>}
            {i.current_url && <ModTag kind="warn">has a link: using replaces it</ModTag>}
          </>}
          meta={<>
            {i.artist && <Link href={`/artist/${i.artist_id}`}>{i.artist}</Link>}
            <a className="rl-link" href={i.url} target="_blank" rel="noopener noreferrer">
              {i.source_domain ?? "link"}{i.link_kind ? ` (${i.link_kind})` : ""}: {i.link_title ?? i.url}
            </a>
            {i.verdict && <span className="rl-say">NIX: {SAYS[i.verdict] ?? i.verdict}{i.note ? ` (${i.note})` : ""}</span>}
            {i.final_side && i.final_side !== "unsure" ? (
              <span className={`rl-say rl-say-${i.final_side === "nix" ? "agree" : "disagree"}`}>
                Final say: {i.final_side === "nix" ? "NIX was right" : SAYS[i.final_answer ?? ""] ?? i.final_answer}{i.final_note ? ` (${i.final_note})` : ""}
              </span>
            ) : i.check_verdict && (
              <span className={`rl-say rl-say-${i.check_verdict}`}>
                Claude {i.check_verdict === "agree" ? "agrees" : i.check_verdict === "disagree" ? `says ${SAYS[i.check_answer ?? ""] ?? i.check_answer ?? "otherwise"}` : "isn't sure"}
                {i.check_note ? ` (${i.check_note})` : ""}
              </span>
            )}
          </>}
          actions={<>
            {i.settled !== "wrong_version" && i.settled !== "wrong_song" && <ModButton kind="approve" busy={busy} onClick={() => use([i.id])}>use</ModButton>}
            <ModButton busy={busy} onClick={() => remove([i.id])}>remove</ModButton>
          </>}
        />
      ))}
    </ModPage>
  );
}
