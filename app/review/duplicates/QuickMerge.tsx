"use client";

// Identical copies on one artist's page (same title, same status, same
// details, nothing collected, rated or commented, no versions). Tick the ones
// to merge and do them in one go. The kept copy is the one with a link, or
// the oldest.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { ModButton, ModNotice, ModRow, ModSection } from "../../components/Mod";

type IdenticalGroup = {
  artist_id: string;
  artist_name: string;
  title: string;
  copies: number;
  track_ids: string[];
};

export default function QuickMerge({ onMerged }: { onMerged: () => void }) {
  const [groups, setGroups] = useState<IdenticalGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const keyOf = (g: IdenticalGroup) => g.track_ids.join(",");

  async function load() {
    const { data, error: err } = await supabase.rpc("find_identical_duplicates", { p_limit: 1000 });
    if (err) { setError(err.message); setGroups([]); return; }
    setError(null);
    setGroups((data as IdenticalGroup[]) ?? []);
    setSelected(new Set());
  }

  useEffect(() => {
    load();
  }, []);

  function toggle(g: IdenticalGroup) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = keyOf(g);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  async function mergeSelected() {
    const chosen = (groups ?? []).filter((g) => selected.has(keyOf(g)));
    if (chosen.length === 0) return;
    const copies = chosen.reduce((n, g) => n + g.copies - 1, 0);
    if (!window.confirm(`Merge ${chosen.length} group${chosen.length === 1 ? "" : "s"} (${copies} extra cop${copies === 1 ? "y" : "ies"})? The old entries redirect to the kept one.`)) return;
    setBusy(true);
    // Small batches keep each database call short.
    for (let i = 0; i < chosen.length; i += 50) {
      const batch = chosen.slice(i, i + 50).map((g) => g.track_ids);
      const { error: err } = await supabase.rpc("admin_quick_merge", { p_groups: batch });
      if (err) { setBusy(false); setError(err.message); onMerged(); return; }
    }
    setBusy(false);
    load();
    onMerged();
  }

  if (groups === null) return null;
  if (error) return <ModNotice kind="error">Quick merge unavailable: {error}</ModNotice>;
  if (groups.length === 0) return null;

  // Group the list by artist for scanning.
  const byArtist: Record<string, IdenticalGroup[]> = {};
  groups.forEach((g) => { (byArtist[g.artist_name] = byArtist[g.artist_name] || []).push(g); });

  return (
    <div className="mod-group" style={{ marginBottom: 18 }}>
      <div className="mod-group-head">
        <span className="mod-row-title">Quick merge: {groups.length} identical group{groups.length === 1 ? "" : "s"}</span>
        <ModButton onClick={() => setOpen(!open)}>{open ? "hide" : "show"}</ModButton>
      </div>
      <div className="comment-meta">
        Exact same title on one artist&apos;s page, same status and details, and nothing collected, rated or
        commented. Some may still be different versions that were never named apart (a song listed 9 times is
        worth a look first), so tick only the ones you&apos;re happy to merge.
      </div>

      {open && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
            <ModButton onClick={() => setSelected(selected.size === groups.length ? new Set() : new Set(groups.map(keyOf)))}>
              {selected.size === groups.length ? "untick all" : `tick all (${groups.length})`}
            </ModButton>
            <ModButton kind="approve" busy={busy} disabled={selected.size === 0} onClick={mergeSelected}>
              {busy ? "merging…" : `merge ticked (${selected.size})`}
            </ModButton>
          </div>
          {Object.keys(byArtist).map((artistName) => (
            <div key={artistName}>
              <ModSection>{artistName}</ModSection>
              {byArtist[artistName].map((g) => (
                <ModRow
                  key={keyOf(g)}
                  check={{ checked: selected.has(keyOf(g)), onChange: () => toggle(g) }}
                  title={<Link href={`/artist/${g.artist_id}?highlight=${g.track_ids[0]}`}>{g.title}</Link>}
                  meta={<span>{g.copies} copies</span>}
                />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
