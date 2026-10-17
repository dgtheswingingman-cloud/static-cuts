"use client";

// Identical copies on one artist's page (same title, same status, same
// details, nothing collected, rated or commented, no versions). Tick the ones
// to merge and do them in one go. The kept copy is the one with a link, or
// the oldest.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

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
      if (err) { setBusy(false); alert(err.message); load(); onMerged(); return; }
    }
    setBusy(false);
    load();
    onMerged();
  }

  if (groups === null) return null;
  if (error) return <div className="comment-meta" style={{ marginBottom: 14 }}>Quick merge unavailable: {error}</div>;
  if (groups.length === 0) return null;

  // Group the list by artist for scanning.
  const byArtist: Record<string, IdenticalGroup[]> = {};
  groups.forEach((g) => { (byArtist[g.artist_name] = byArtist[g.artist_name] || []).push(g); });

  return (
    <div style={{ border: "1px solid var(--hair)", borderRadius: 4, padding: "10px 12px", marginBottom: 18 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span className="track-title">Quick merge: {groups.length} identical group{groups.length === 1 ? "" : "s"}</span>
        <button className="tab" onClick={() => setOpen(!open)}>{open ? "hide" : "show"}</button>
      </div>
      <div className="comment-meta" style={{ marginTop: 4 }}>
        Exact same title on one artist&apos;s page, same status and details, and nothing collected, rated or
        commented. Some may still be different versions that were never named apart (a song listed 9 times is
        worth a look first), so tick only the ones you&apos;re happy to merge.
      </div>

      {open && (
        <>
          <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
            <button className="tab" onClick={() => setSelected(new Set(groups.map(keyOf)))}>select all</button>
            <button className="tab" onClick={() => setSelected(new Set())}>select none</button>
            <button className="tab active" disabled={busy || selected.size === 0} onClick={mergeSelected}>
              {busy ? "merging…" : `merge selected (${selected.size})`}
            </button>
          </div>
          {Object.keys(byArtist).map((artistName) => (
            <div key={artistName} style={{ marginBottom: 8 }}>
              <div className="section-label">{artistName}</div>
              {byArtist[artistName].map((g) => (
                <label key={keyOf(g)} className="comment-meta" style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", marginTop: 2 }}>
                  <input type="checkbox" checked={selected.has(keyOf(g))} onChange={() => toggle(g)} />
                  <Link href={`/artist/${g.artist_id}?highlight=${g.track_ids[0]}`} style={{ color: "var(--bone)" }} onClick={(e) => e.stopPropagation()}>
                    {g.title}
                  </Link>
                  <span>× {g.copies}</span>
                </label>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
