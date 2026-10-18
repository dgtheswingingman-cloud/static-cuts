"use client";

// Collab map: who has worked with who. Artists with a page are filled
// circles; guests without one are outlines (hidden unless switched on, so the
// map stays readable). Drag to move around, scroll or use + / − to zoom, tap
// anyone to see who they've worked with; ?artist=<id> starts focused on one
// artist.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Node = { key: string; artist_id: string | null; name: string; degree: number; songs: number };
type Edge = { a: string; b: string; songs: number; tracks: string[] };
type Pos = Record<string, { x: number; y: number }>;
type View = { x: number; y: number; w: number; h: number };

// A force layout: nodes push apart, links pull together, everything drifts to
// the middle. Not boxed in (boxing in piled nodes up along the edges); the
// view is fitted around the result instead. Deterministic, so the map looks
// the same each time.
function layout(nodes: Node[], edges: Edge[]): Pos {
  const pos: Pos = {};
  const n = nodes.length;
  const spread = 120 + Math.sqrt(n) * 40;
  nodes.forEach((nd, i) => {
    const a = i * 2.399963; // golden angle: an even spiral to start from
    const r = spread * Math.sqrt((i + 0.5) / Math.max(n, 1));
    pos[nd.key] = { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
  const vel: Record<string, { x: number; y: number }> = {};
  nodes.forEach((nd) => (vel[nd.key] = { x: 0, y: 0 }));
  const steps = n > 250 ? 260 : 360;
  for (let step = 0; step < steps; step++) {
    const cool = 1 - step / steps;
    for (let i = 0; i < n; i++) {
      const pi = pos[nodes[i].key];
      for (let j = i + 1; j < n; j++) {
        const pj = pos[nodes[j].key];
        let dx = pi.x - pj.x, dy = pi.y - pj.y;
        const d2 = Math.max(dx * dx + dy * dy, 30);
        if (d2 > 160000) continue; // far apart: no push
        const f = 2600 / d2;
        const d = Math.sqrt(d2);
        dx /= d; dy /= d;
        vel[nodes[i].key].x += dx * f; vel[nodes[i].key].y += dy * f;
        vel[nodes[j].key].x -= dx * f; vel[nodes[j].key].y -= dy * f;
      }
    }
    for (const e of edges) {
      const p = pos[e.a], q = pos[e.b];
      if (!p || !q) continue;
      const dx = q.x - p.x, dy = q.y - p.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = (d - 70) * 0.025 * Math.min(1 + e.songs * 0.15, 2);
      vel[e.a].x += (dx / d) * f; vel[e.a].y += (dy / d) * f;
      vel[e.b].x -= (dx / d) * f; vel[e.b].y -= (dy / d) * f;
    }
    for (const nd of nodes) {
      const p = pos[nd.key], v = vel[nd.key];
      v.x -= p.x * 0.006; v.y -= p.y * 0.006;
      p.x += Math.max(-24, Math.min(24, v.x)) * cool;
      p.y += Math.max(-24, Math.min(24, v.y)) * cool;
      v.x *= 0.55; v.y *= 0.55;
    }
  }
  return pos;
}

function radius(nd: Node) {
  return Math.min(5 + Math.sqrt(nd.degree) * 3.6, 24);
}

// The whole map with a margin.
function fit(nodes: Node[], pos: Pos): View {
  if (nodes.length === 0) return { x: -500, y: -350, w: 1000, h: 700 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const nd of nodes) {
    const p = pos[nd.key];
    if (!p) continue;
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  const m = 60;
  let w = x1 - x0 + m * 2, h = y1 - y0 + m * 2;
  // Keep a landscape-ish shape so the map fills the box.
  const ratio = 10 / 7;
  if (w / h < ratio) { const nw = h * ratio; x0 -= (nw - w) / 2; w = nw; } else { const nh = w / ratio; y0 -= (nh - h) / 2; h = nh; }
  return { x: x0 - m, y: y0 - m, w, h };
}

// Which names to write: the busiest artists first, skipping any label that
// would overlap one already placed. The selected artist and their
// collaborators are always labelled.
function pickLabels(nodes: Node[], pos: Pos, view: View, must: Set<string>): Set<string> {
  const scale = view.w / 1000; // label size in map units at this zoom
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const out = new Set<string>();
  const order = [...nodes].sort((a, b) => Number(must.has(b.key)) - Number(must.has(a.key)) || b.degree - a.degree || b.songs - a.songs);
  for (const nd of order) {
    const p = pos[nd.key];
    if (!p) continue;
    if (p.x < view.x || p.x > view.x + view.w || p.y < view.y || p.y > view.y + view.h) continue;
    const w = nd.name.length * 6.2 * scale, h = 12 * scale;
    const y = p.y + radius(nd) + 4 * scale;
    const box = { x0: p.x - w / 2, y0: y, x1: p.x + w / 2, y1: y + h };
    const clash = placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0);
    if (clash && !must.has(nd.key)) continue;
    placed.push(box);
    out.add(nd.key);
    if (out.size > 140) break;
  }
  return out;
}

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const focus = params.get("artist");
  const [data, setData] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(focus);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [showGuests, setShowGuests] = useState(false);
  const [minSongs, setMinSongs] = useState(1);
  const [view, setView] = useState<View | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);

  useEffect(() => {
    setData(null);
    supabase.rpc("rpc_collab_graph", { p_artist: focus }).then(({ data: d }) => setData((d as { nodes: Node[]; edges: Edge[] }) ?? { nodes: [], edges: [] }));
    setSelected(focus);
    // Focused on one artist: their guests are part of the story.
    setShowGuests(!!focus);
  }, [focus]);

  // What's on the map after the filters. Edges need both ends shown; nodes
  // with no edges left are dropped (unless selected).
  const shownData = useMemo(() => {
    if (!data) return null;
    const keep = new Set(data.nodes.filter((n) => showGuests || n.artist_id).map((n) => n.key));
    const edges = data.edges.filter((e) => e.songs >= minSongs && keep.has(e.a) && keep.has(e.b));
    const linked = new Set(edges.flatMap((e) => [e.a, e.b]));
    const deg: Record<string, number> = {};
    edges.forEach((e) => { deg[e.a] = (deg[e.a] ?? 0) + 1; deg[e.b] = (deg[e.b] ?? 0) + 1; });
    const nodes = data.nodes
      .filter((n) => keep.has(n.key) && linked.has(n.key))
      .map((n) => ({ ...n, degree: deg[n.key] ?? 0 }));
    return { nodes, edges };
  }, [data, showGuests, minSongs]);

  const pos = useMemo(() => (shownData ? layout(shownData.nodes, shownData.edges) : {}), [shownData]);
  const home = useMemo(() => (shownData ? fit(shownData.nodes, pos) : null), [shownData, pos]);
  useEffect(() => { setView(home); }, [home]);

  const byKey = useMemo(() => Object.fromEntries((data?.nodes ?? []).map((n) => [n.key, n])), [data]);
  const links = useMemo(
    () => (selected && data ? data.edges.filter((e) => e.a === selected || e.b === selected).sort((x, y) => y.songs - x.songs) : []),
    [selected, data]
  );
  const neighbours = useMemo(() => new Set(links.flatMap((e) => [e.a, e.b])), [links]);
  const labels = useMemo(
    () => (shownData && view ? pickLabels(shownData.nodes, pos, view, selected ? neighbours : new Set()) : new Set<string>()),
    [shownData, pos, view, selected, neighbours]
  );

  // Song titles for the selected artist's collaborations.
  useEffect(() => {
    const ids = links.flatMap((e) => e.tracks).filter((id) => !titles[id]);
    if (ids.length === 0) return;
    supabase.from("tracks").select("id, title").in("id", ids.slice(0, 200)).then(({ data: rows }) => {
      setTitles((prev) => ({ ...prev, ...Object.fromEntries((rows ?? []).map((r) => [r.id, r.title])) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links]);

  // Zoom around a point (map units), keeping that point under the pointer.
  function zoom(factor: number, cx?: number, cy?: number) {
    setView((v) => {
      if (!v || !home) return v;
      const w = Math.min(Math.max(v.w * factor, home.w / 12), home.w * 1.6);
      const h = w * (v.h / v.w);
      const px = cx ?? v.x + v.w / 2, py = cy ?? v.y + v.h / 2;
      return { x: px - ((px - v.x) * w) / v.w, y: py - ((py - v.y) * h) / v.h, w, h };
    });
  }
  function toMap(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg || !view) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return { x: view.x + ((clientX - r.left) / r.width) * view.w, y: view.y + ((clientY - r.top) / r.height) * view.h };
  }
  // Centre on an artist and zoom in a little.
  function goTo(key: string) {
    setSelected(key);
    const p = pos[key];
    if (p && home) {
      const w = home.w / 2.2, h = home.h / 2.2;
      setView({ x: p.x - w / 2, y: p.y - h / 2, w, h });
    }
  }

  // Wheel zoom (needs a non-passive listener to stop the page scrolling).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const p = toMap(e.clientX, e.clientY);
      zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  });

  const sel = selected ? byKey[selected] : null;
  const matches = query.trim().length >= 2
    ? (shownData?.nodes ?? []).filter((n) => n.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : [];
  const guestCount = (data?.nodes ?? []).filter((n) => !n.artist_id).length;
  const scale = view ? view.w / 1000 : 1;

  return (
    <div className="wrap" style={{ maxWidth: 1100 }}>
      <button className="back-btn" onClick={() => router.push("/")}>← home</button>
      <h1 className="detail-name page-title">Collab map</h1>
      <div className="detail-meta">
        Who&apos;s worked with who, from shared songs and features. Drag to move, scroll or use + / − to zoom, tap anyone to see
        their collaborations.
      </div>

      <div className="collab-controls">
        <input className="search-input" placeholder="Find an artist…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="collab-toggles">
          <button className={`tab ${showGuests ? "active" : ""}`} onClick={() => setShowGuests(!showGuests)}
            title="Artists without a page here, only mentioned on songs">
            {showGuests ? "✓ " : ""}guests{guestCount ? ` (${guestCount})` : ""}
          </button>
          <select className="sort-select" value={minSongs} onChange={(e) => setMinSongs(Number(e.target.value))} aria-label="Minimum songs together">
            <option value={1}>any collab</option>
            <option value={2}>2+ songs together</option>
            <option value={3}>3+ songs together</option>
            <option value={5}>5+ songs together</option>
          </select>
          {focus && <button className="tab" onClick={() => router.replace("/collabs")}>show everyone</button>}
        </div>
      </div>
      {matches.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {matches.map((m) => (
            <button key={m.key} className="rating-chip" onClick={() => { goTo(m.key); setQuery(""); }}>{m.name}</button>
          ))}
        </div>
      )}

      {!data && <div className="empty-state">loading…</div>}
      {shownData && shownData.nodes.length === 0 && <div className="empty-state">No collaborations to show with these filters.</div>}
      {shownData && shownData.nodes.length > 0 && view && (
        <div className="collab-layout">
          <div className="collab-stage">
            <svg ref={svgRef} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className="collab-map" role="img"
              aria-label="Map of artist collaborations"
              onPointerDown={(e) => {
                (e.currentTarget as Element).setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY, view, moved: false };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                const svg = svgRef.current;
                if (!d || !svg) return;
                const r = svg.getBoundingClientRect();
                const dx = ((e.clientX - d.x) / r.width) * d.view.w, dy = ((e.clientY - d.y) / r.height) * d.view.h;
                if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
                if (d.moved) setView({ ...d.view, x: d.view.x - dx, y: d.view.y - dy });
              }}
              onPointerUp={(e) => {
                const d = drag.current;
                drag.current = null;
                if (d && !d.moved) {
                  // A tap: the nearest circle under the pointer, or clear.
                  const p = toMap(e.clientX, e.clientY);
                  let best: string | null = null, bestD = Infinity;
                  for (const n of shownData.nodes) {
                    const q = pos[n.key];
                    if (!q) continue;
                    const dist = Math.hypot(q.x - p.x, q.y - p.y);
                    if (dist < Math.max(radius(n), 10 * scale) + 4 * scale && dist < bestD) { best = n.key; bestD = dist; }
                  }
                  setSelected(best);
                }
              }}>
              {shownData.edges.map((e) => {
                const p = pos[e.a], q = pos[e.b];
                if (!p || !q) return null;
                const on = selected && (e.a === selected || e.b === selected);
                return (
                  <line key={e.a + "|" + e.b} x1={p.x} y1={p.y} x2={q.x} y2={q.y}
                    className={`collab-edge ${on ? "on" : selected ? "dim" : ""}`}
                    strokeWidth={Math.min(0.8 + e.songs * 0.5, 5)} />
                );
              })}
              {shownData.nodes.map((n) => {
                const p = pos[n.key];
                if (!p) return null;
                const on = n.key === selected;
                const near = neighbours.has(n.key);
                const dim = selected && !on && !near;
                const r = radius(n);
                return (
                  <g key={n.key} transform={`translate(${p.x},${p.y})`} className={`collab-node ${dim ? "dim" : ""}`}>
                    <title>{`${n.name}: ${n.degree} collaborator${n.degree === 1 ? "" : "s"}`}</title>
                    <circle r={r} className={`${n.artist_id ? "has-page" : "guest"} ${on ? "on" : ""}`} />
                    {labels.has(n.key) && (
                      <text y={r + 11 * scale} textAnchor="middle" className="collab-label" style={{ fontSize: `${11 * scale}px` }}>{n.name}</text>
                    )}
                  </g>
                );
              })}
            </svg>
            <div className="collab-zoom">
              <button className="rating-chip" aria-label="Zoom in" onClick={() => zoom(1 / 1.4)}>+</button>
              <button className="rating-chip" aria-label="Zoom out" onClick={() => zoom(1.4)}>−</button>
              <button className="rating-chip" aria-label="Show the whole map" onClick={() => setView(home)}>fit</button>
            </div>
            <div className="collab-legend comment-meta">
              <span><span className="collab-dot has-page" /> has a page</span>
              {showGuests && <span><span className="collab-dot guest" /> guest</span>}
              <span>bigger circle = more collaborators · thicker line = more songs together</span>
            </div>
          </div>

          <div className="collab-side">
            {!sel && (
              <div className="comment-meta">
                Tap a circle to see who they&apos;ve worked with.
                {shownData && <> Showing {shownData.nodes.length} artists and {shownData.edges.length} collaborations.</>}
              </div>
            )}
            {sel && (
              <>
                <div className="review-row-title" style={{ fontSize: "1.05rem" }}>
                  {sel.artist_id ? <Link href={`/artist/${sel.artist_id}`}>{sel.name}</Link> : sel.name}
                </div>
                <div className="comment-meta" style={{ marginBottom: 10 }}>
                  {links.length} collaborator{links.length === 1 ? "" : "s"} · {sel.songs} song{sel.songs === 1 ? "" : "s"}
                  {!sel.artist_id && <> · guest</>}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {sel.artist_id && <Link href={`/artist/${sel.artist_id}`} className="rating-chip">open page</Link>}
                  {sel.artist_id && focus !== sel.artist_id && (
                    <button className="rating-chip" onClick={() => router.replace(`/collabs?artist=${sel.artist_id}`)}>only their collabs</button>
                  )}
                  <button className="rating-chip" onClick={() => goTo(sel.key)}>centre</button>
                </div>
                {links.map((e) => {
                  const other = byKey[e.a === sel.key ? e.b : e.a];
                  if (!other) return null;
                  return (
                    <div key={e.a + "|" + e.b} className="collab-link">
                      <button className="text-link collab-link-name" onClick={() => goTo(other.key)}>{other.name}</button>
                      <span className="comment-meta"> · {e.songs} song{e.songs === 1 ? "" : "s"}{!other.artist_id ? " · guest" : ""}</span>
                      <div className="feed-tracks">
                        {e.tracks.map((id) => (
                          <Link key={id} href={`/song/${id}`} className="feed-track">{titles[id] ?? "…"}</Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CollabsPage() {
  return (
    <Suspense fallback={<div className="wrap"><div className="empty-state">loading…</div></div>}>
      <Inner />
    </Suspense>
  );
}
