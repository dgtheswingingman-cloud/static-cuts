"use client";

// Keyboard shortcuts for the review lists, for getting through a backlog
// quickly:  J / K (or ↓ / ↑) move,  Y yes,  N no,  X tick the box.
// Ignored while typing in a box or with Ctrl / Cmd / Alt held.

import { useEffect, useState } from "react";

export function useReviewKeys<T extends { id: string }>(
  rows: T[],
  actions: { yes?: (row: T) => void; no?: (row: T) => void; toggle?: (row: T) => void },
  busy = false,
) {
  const [focus, setFocus] = useState(-1);

  // Keep the highlighted row in range as rows are approved or dismissed.
  useEffect(() => {
    if (focus >= rows.length) setFocus(rows.length - 1);
  }, [rows.length, focus]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const key = e.key.toLowerCase();
      const move = (to: number) => {
        e.preventDefault();
        const i = Math.max(0, Math.min(rows.length - 1, to));
        setFocus(i);
        document.querySelector(`[data-row-id="${CSS.escape(rows[i]?.id ?? "")}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      };
      if (key === "j" || e.key === "ArrowDown") return move(focus + 1);
      if (key === "k" || e.key === "ArrowUp") return move(focus - 1);
      const row = rows[focus];
      if (!row || busy) return;
      if (key === "y" && actions.yes) { e.preventDefault(); actions.yes(row); }
      else if (key === "n" && actions.no) { e.preventDefault(); actions.no(row); }
      else if (key === "x" && actions.toggle) { e.preventDefault(); actions.toggle(row); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, focus, actions, busy]);

  return { focusedId: rows[focus]?.id ?? null, setFocusId: (id: string) => setFocus(rows.findIndex((r) => r.id === id)) };
}
