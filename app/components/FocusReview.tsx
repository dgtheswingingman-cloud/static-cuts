"use client";

// Focus mode for the review lists: one item at a time, full screen, with
// big buttons. Made for clearing a backlog on a phone: swipe right for yes,
// left for no, or tap the buttons. On a keyboard: Y (or →) yes, N (or ←)
// no, S skip, Esc to leave.

import { ReactNode, useEffect, useRef, useState } from "react";

export default function FocusReview<T extends { id: string }>({
  rows, render, onYes, onNo, yesLabel, noLabel, onClose, busy, note,
}: {
  rows: T[];
  render: (row: T) => ReactNode;
  onYes: (row: T) => void;
  onNo: (row: T) => void;
  yesLabel: string;
  noLabel: string;
  onClose: () => void;
  busy: boolean;
  note?: string;
}) {
  // Skipped items go to the back of this session's line.
  const [skipped, setSkipped] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [drag, setDrag] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);

  const queue = [...rows.filter((r) => !skipped.includes(r.id)), ...skipped.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as T[]];
  const row = queue[0];

  function yes() { if (row && !busy) { setHistory((h) => [...h, row.id]); onYes(row); } }
  function no() { if (row && !busy) { setHistory((h) => [...h, row.id]); onNo(row); } }
  function skip() { if (row) setSkipped((s) => [...s.filter((x) => x !== row.id), row.id]); }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const act = k === "escape" ? onClose
        : k === "y" || e.key === "ArrowRight" ? yes
        : k === "n" || e.key === "ArrowLeft" ? no
        : k === "s" || e.key === "ArrowDown" ? skip : null;
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      act();
    }
    // Capture first so the list's own shortcuts don't also fire.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // No scrolling the page behind.
  useEffect(() => {
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = old; };
  }, []);

  return (
    <div className="focus-review" role="dialog" aria-modal="true" aria-label="Focus mode">
      <div className="focus-review-top">
        <span className="comment-meta">{rows.length} left{history.length ? ` · ${history.length} done` : ""}</span>
        <button className="tab" onClick={onClose}>close</button>
      </div>
      {row ? (
        <>
          <div
            className="focus-review-card"
            style={{ transform: drag ? `translateX(${drag}px) rotate(${drag / 30}deg)` : undefined }}
            data-lean={drag > 60 ? "yes" : drag < -60 ? "no" : undefined}
            onTouchStart={(e) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
            onTouchMove={(e) => {
              if (!start.current) return;
              const dx = e.touches[0].clientX - start.current.x;
              const dy = e.touches[0].clientY - start.current.y;
              if (Math.abs(dx) > Math.abs(dy)) setDrag(dx);
            }}
            onTouchEnd={() => {
              if (drag > 90) yes(); else if (drag < -90) no();
              setDrag(0);
              start.current = null;
            }}
          >
            {render(row)}
          </div>
          <div className="focus-review-buttons">
            <button className="focus-btn no" disabled={busy} onClick={no}>{noLabel}</button>
            <button className="focus-btn skip" onClick={skip}>skip</button>
            <button className="focus-btn yes" disabled={busy} onClick={yes}>{yesLabel}</button>
          </div>
          <div className="comment-meta focus-review-hint">
            Swipe right to {yesLabel}, left to {noLabel}. Keys: Y / N / S, Esc to close.{note ? ` ${note}` : ""}
          </div>
        </>
      ) : (
        <div className="empty-state" style={{ marginTop: 60 }}>
          All done here.
          <div style={{ marginTop: 16 }}><button className="tab active" onClick={onClose}>back to the list</button></div>
        </div>
      )}
    </div>
  );
}
