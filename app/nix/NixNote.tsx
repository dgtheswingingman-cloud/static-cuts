"use client";

// NIX's note on a review item ("NIX: same song: same title and length"),
// from the PC running NIX, with Claude's check of it underneath ("Claude
// disagrees: different (lengths 40 s apart)"). Only suggestions: nothing is
// applied from either.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type NixNoteData = {
  verdict: string | null; note: string | null; model: string | null;
  check?: "agree" | "disagree" | "unsure" | null; check_answer?: string | null; check_note?: string | null;
};

// The notes for the items on screen, keyed by item (reloads when the keys change).
export function useNixNotes(kind: string, keys: string[]) {
  const [notes, setNotes] = useState<Record<string, NixNoteData>>({});
  const sig = keys.join("|");
  useEffect(() => {
    if (!keys.length) return;
    let live = true;
    supabase.rpc("admin_nix_notes", { p_kind: kind, p_keys: keys.slice(0, 500) })
      .then(({ data }) => { if (live && data) setNotes((data as Record<string, NixNoteData>) ?? {}); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, sig]);
  return notes;
}

// How each verdict reads, and whether it leans yes (good) or no (warn).
const SAYS: Record<string, [string, "good" | "warn" | "plain"]> = {
  same: ["same song", "good"], different: ["different songs", "warn"],
  not_song: ["not a song", "good"], placeholder: ["placeholder", "good"], real_song: ["real song, keep", "warn"],
  mixup: ["mix-up: someone else", "good"], fine: ["bio is fine", "warn"],
  mixed: ["mixed: two acts", "plain"],
  unsure: ["unsure", "plain"],
};
const DEEZER: Record<string, [string, "good" | "warn" | "plain"]> = {
  same: ["same artist", "good"], different: ["different artist", "warn"],
};

export function NixNote({ n, deezer }: { n?: NixNoteData; deezer?: boolean }) {
  if (!n?.verdict) return null;
  const [label, tone] = (deezer && DEEZER[n.verdict]) || SAYS[n.verdict] || [n.verdict, "plain"];
  return (
    <div className={`nix-note nix-note-${tone}`} title={n.model ? `NIX on PC (${n.model}). A suggestion only.` : "A suggestion only."}>
      <b>NIX:</b> {label}{n.note ? <span>: {n.note}</span> : null}
      {n.check && (
        <div className={`nix-note-check nix-note-check-${n.check}`}>
          <b>Claude:</b> {n.check === "agree" ? "agrees" : n.check === "unsure" ? "isn't sure" : "disagrees"}
          {n.check === "disagree" && n.check_answer
            ? <>, says {((deezer && DEEZER[n.check_answer]) || SAYS[n.check_answer] || [n.check_answer])[0]}</>
            : null}
          {n.check_note ? <span>: {n.check_note}</span> : null}
        </div>
      )}
    </div>
  );
}
