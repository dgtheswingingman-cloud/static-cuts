"use client";

// A sideways row (covers, artists, updates) with ‹ › arrows to page through
// it. Arrows only show when there's more to see that way; swiping still works.

import { useEffect, useRef, useState, type ReactNode } from "react";

export default function Strip({ className = "", children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  function check() {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    // Only update when something changed (otherwise it re-renders forever).
    setEdges((p) => (p.left === left && p.right === right ? p : { left, right }));
  }
  // Re-check when the row resizes or its contents change (covers loading in).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    check();
    const ro = new ResizeObserver(() => check());
    ro.observe(el);
    const mo = new MutationObserver(() => check());
    mo.observe(el, { childList: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);

  const go = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: "smooth" });

  return (
    <div className="strip-wrap">
      {edges.left && <button className="strip-arrow strip-left" aria-label="Scroll back" onClick={() => go(-1)}>‹</button>}
      <div ref={ref} className={`hf-strip ${className}`} onScroll={check}>{children}</div>
      {edges.right && <button className="strip-arrow strip-right" aria-label="Scroll on" onClick={() => go(1)}>›</button>}
    </div>
  );
}
