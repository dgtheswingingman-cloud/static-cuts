"use client";
import "../styles/collabs.css";

// Collab map: who has worked with who.
//   Circle (default): one artist in the middle, the people they've worked
//     with around them (thicker line = more songs together). Tap anyone to
//     move them to the middle. On phones it's a list first.
//   Whole scene: everyone at once, drawn on a canvas so it stays quick as
//     the archive grows; the layout is worked out in the background.
//   Path: how two artists connect, step by step, with the songs that link
//     each step.
// ?artist=<key> opens on one artist (artist id, or guest:<name>).

import type React from "react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { thumb } from "@/lib/thumb";

type Node = { key: string; artist_id: string | null; name: string; degree: number; songs: number };
type Edge = { a: string; b: string; songs: number; tracks: string[] };
type Mode = "circle" | "scene" | "path" | "pairs";

// ------------------------------------------------------------- whole scene

// The force layout runs in a background worker so the page never freezes.
// Pushing apart only looks at nearby artists (a grid of squares), which keeps
// it quick with thousands of artists.
const WORKER = `
self.onmessage = (ev) => {
  const { n, edges, weights } = ev.data;
  const x = new Float32Array(n), y = new Float32Array(n), vx = new Float32Array(n), vy = new Float32Array(n);
  const spread = 120 + Math.sqrt(n) * 40;
  for (let i = 0; i < n; i++) { const a = i * 2.399963, r = spread * Math.sqrt((i + 0.5) / n); x[i] = Math.cos(a) * r; y[i] = Math.sin(a) * r; }
  const CELL = 200, steps = n > 1500 ? 220 : 300;
  for (let s = 0; s < steps; s++) {
    const cool = 1 - s / steps;
    const grid = new Map();
    for (let i = 0; i < n; i++) {
      const k = Math.floor(x[i] / CELL) + ',' + Math.floor(y[i] / CELL);
      let c = grid.get(k); if (!c) { c = []; grid.set(k, c); } c.push(i);
    }
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(x[i] / CELL), cy = Math.floor(y[i] / CELL);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const c = grid.get(gx + ',' + gy); if (!c) continue;
        for (const j of c) {
          if (j <= i) continue;
          let dx = x[i] - x[j], dy = y[i] - y[j];
          const d2 = Math.max(dx * dx + dy * dy, 30);
          if (d2 > CELL * CELL) continue;
          const f = 2600 / d2, d = Math.sqrt(d2); dx /= d; dy /= d;
          vx[i] += dx * f; vy[i] += dy * f; vx[j] -= dx * f; vy[j] -= dy * f;
        }
      }
    }
    for (let e = 0; e < edges.length; e += 2) {
      const a = edges[e], b = edges[e + 1];
      const dx = x[b] - x[a], dy = y[b] - y[a], d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = (d - 70) * 0.025 * Math.min(1 + weights[e / 2] * 0.15, 2);
      vx[a] += dx / d * f; vy[a] += dy / d * f; vx[b] -= dx / d * f; vy[b] -= dy / d * f;
    }
    for (let i = 0; i < n; i++) {
      vx[i] -= x[i] * 0.006; vy[i] -= y[i] * 0.006;
      x[i] += Math.max(-24, Math.min(24, vx[i])) * cool; y[i] += Math.max(-24, Math.min(24, vy[i])) * cool;
      vx[i] *= 0.55; vy[i] *= 0.55;
    }
  }
  self.postMessage({ x, y }, [x.buffer, y.buffer]);
};`;

function Scene({ nodes, edges, onPick, colour, focus, picked }: {
  nodes: Node[]; edges: Edge[]; onPick: (key: string) => void;
  colour: (n: Node) => string | null; focus: Set<string> | null; picked: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pos, setPos] = useState<{ x: Float32Array; y: Float32Array } | null>(null);
  const [view, setView] = useState<{ cx: number; cy: number; scale: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const index = useMemo(() => Object.fromEntries(nodes.map((n, i) => [n.key, i])), [nodes]);

  // Work out the layout in the background.
  useEffect(() => {
    setPos(null);
    if (nodes.length === 0) return;
    const url = URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" }));
    const w = new Worker(url);
    const flat = new Int32Array(edges.length * 2);
    const weights = new Float32Array(edges.length);
    edges.forEach((e, i) => { flat[i * 2] = index[e.a]; flat[i * 2 + 1] = index[e.b]; weights[i] = e.songs; });
    w.onmessage = (ev) => {
      const p = ev.data as { x: Float32Array; y: Float32Array };
      setPos(p);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < p.x.length; i++) { x0 = Math.min(x0, p.x[i]); x1 = Math.max(x1, p.x[i]); y0 = Math.min(y0, p.y[i]); y1 = Math.max(y1, p.y[i]); }
      const c = canvasRef.current;
      const width = c?.clientWidth ?? 1000, height = c?.clientHeight ?? 700;
      setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale: Math.min(width / (x1 - x0 + 120), height / (y1 - y0 + 120)) });
      w.terminate();
      URL.revokeObjectURL(url);
    };
    w.postMessage({ n: nodes.length, edges: flat, weights });
    return () => { w.terminate(); URL.revokeObjectURL(url); };
  }, [nodes, edges, index]);

  // Draw.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !pos || !view) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(document.documentElement);
    const bone = css.getPropertyValue("--bone").trim() || "#eee";
    const smoke = css.getPropertyValue("--smoke").trim() || "#888";
    const hair = css.getPropertyValue("--hair-strong").trim() || "#444";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const sx = (x: number) => (x - view.cx) * view.scale + W / 2;
    const sy = (y: number) => (y - view.cy) * view.scale + H / 2;
    const pin = picked != null && index[picked] !== undefined ? index[picked] : null;
    const hv = hover ?? pin;
    const inFocus = (i: number) => !focus || focus.has(nodes[i].key);
    const near = new Set<number>();
    if (hv !== null) edges.forEach((e) => { const a = index[e.a], b = index[e.b]; if (a === hv) near.add(b); if (b === hv) near.add(a); });
    ctx.lineCap = "round";
    for (const e of edges) {
      const a = index[e.a], b = index[e.b];
      const on = hv !== null && (a === hv || b === hv);
      const both = inFocus(a) && inFocus(b);
      ctx.strokeStyle = on ? bone : both && focus ? (colour(nodes[a]) ?? hair) : hair;
      ctx.globalAlpha = hv !== null ? (on ? 1 : 0.06) : focus ? (both ? 0.6 : 0.04) : 0.45;
      ctx.lineWidth = Math.min(0.6 + e.songs * 0.35, 4);
      ctx.beginPath(); ctx.moveTo(sx(pos.x[a]), sy(pos.y[a])); ctx.lineTo(sx(pos.x[b]), sy(pos.y[b])); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const r = (n: Node) => Math.min(3 + Math.sqrt(n.degree) * 2.4, 18) * Math.max(0.6, Math.min(view.scale * 1.6, 1.6));
    nodes.forEach((n, i) => {
      const dim = hv !== null ? i !== hv && !near.has(i) : !inFocus(i);
      ctx.globalAlpha = dim ? (hv !== null ? 0.2 : 0.1) : 1;
      ctx.beginPath(); ctx.arc(sx(pos.x[i]), sy(pos.y[i]), r(n), 0, Math.PI * 2);
      const tint = colour(n);
      if (n.artist_id) {
        if (tint && !dim) { ctx.shadowColor = tint; ctx.shadowBlur = 10; }
        ctx.fillStyle = tint ?? bone; ctx.fill(); ctx.shadowBlur = 0;
      } else { ctx.strokeStyle = tint ?? smoke; ctx.lineWidth = 1.2; ctx.stroke(); }
      if (i === hv) { ctx.strokeStyle = bone; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(sx(pos.x[i]), sy(pos.y[i]), r(n) + 4, 0, Math.PI * 2); ctx.stroke(); }
    });
    // Names: the busiest artists first, skipping ones that would overlap.
    ctx.font = `11px ui-monospace, monospace`;
    ctx.textAlign = "center";
    const placed: number[][] = [];
    const order = nodes.map((_, i) => i).filter((i) => hv !== null || inFocus(i)).sort((a, b) => Number(b === hv || near.has(b)) - Number(a === hv || near.has(a)) || nodes[b].degree - nodes[a].degree);
    let count = 0;
    for (const i of order) {
      const x = sx(pos.x[i]), y = sy(pos.y[i]) + r(nodes[i]) + 11;
      if (x < 0 || x > W || y < 0 || y > H) continue;
      const w = ctx.measureText(nodes[i].name).width;
      const box = [x - w / 2, y - 10, x + w / 2, y + 2];
      const must = i === hv || near.has(i);
      if (!must && placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      ctx.globalAlpha = hv !== null && !must ? 0.3 : 1;
      ctx.fillStyle = must ? bone : smoke;
      ctx.fillText(nodes[i].name, x, y);
      if (++count > 160) break;
    }
    ctx.globalAlpha = 1;
  }, [pos, view, hover, nodes, edges, index, colour, focus, picked]);

  function nearest(clientX: number, clientY: number) {
    const c = canvasRef.current;
    if (!c || !pos || !view) return null;
    const rect = c.getBoundingClientRect();
    const mx = (clientX - rect.left - rect.width / 2) / view.scale + view.cx;
    const my = (clientY - rect.top - rect.height / 2) / view.scale + view.cy;
    let best: number | null = null, bestD = 14 / view.scale;
    for (let i = 0; i < nodes.length; i++) {
      const d = Math.hypot(pos.x[i] - mx, pos.y[i] - my);
      if (d < bestD) { best = i; bestD = d; }
    }
    return best;
  }
  function zoom(f: number) { setView((v) => (v ? { ...v, scale: Math.max(0.05, Math.min(v.scale * f, 8)) } : v)); }

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1 / 1.15 : 1.15); };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="collab-stage cm-stage">
      {!pos && <div className="collab-working comment-meta">Laying out {nodes.length.toLocaleString("en-GB")} artists…</div>}
      <canvas ref={canvasRef} className="collab-canvas"
        onPointerDown={(e) => {
          if (!view) return;
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) { setHover(nearest(e.clientX, e.clientY)); return; }
          if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
          if (d.moved) setView((v) => (v ? { ...v, cx: d.cx - (e.clientX - d.x) / v.scale, cy: d.cy - (e.clientY - d.y) / v.scale } : v));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) {
            const i = nearest(e.clientX, e.clientY);
            if (i !== null) { setHover(i); onPick(nodes[i].key); }
          }
        }} />
      <div className="collab-zoom">
        <button className="rating-chip" aria-label="Zoom in" onClick={() => zoom(1.4)}>+</button>
        <button className="rating-chip" aria-label="Zoom out" onClick={() => zoom(1 / 1.4)}>−</button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- circle

function Circle({ center, ring, outer, byKey, onPick, colour }: {
  center: Node; ring: { node: Node; songs: number }[]; outer: { node: Node; parent: string }[];
  byKey: Record<string, Node>; onPick: (key: string) => void; colour: (n: Node) => string | null;
}) {
  const R1 = ring.length > 24 ? 250 : 210, R2 = 320;
  const angle: Record<string, number> = {};
  ring.forEach((r, i) => { angle[r.node.key] = (i / Math.max(ring.length, 1)) * Math.PI * 2 - Math.PI / 2; });
  // Outer ring: grouped behind the person who links them.
  const outerPos = outer.map((o, i) => {
    const base = angle[o.parent] ?? 0;
    const siblings = outer.filter((x) => x.parent === o.parent);
    const k = siblings.indexOf(o);
    const spreadA = Math.min(0.5, (Math.PI * 2) / Math.max(ring.length, 1) * 0.9);
    const a = base + (siblings.length > 1 ? (k / (siblings.length - 1) - 0.5) * spreadA : 0);
    return { ...o, x: Math.cos(a) * R2, y: Math.sin(a) * R2, i };
  });
  const maxSongs = Math.max(1, ...ring.map((r) => r.songs));
  const showAllNames = ring.length <= 36;
  return (
    <svg viewBox="-500 -380 1000 760" className="collab-map" role="img" aria-label={`Who ${center.name} has worked with`}>
      {outerPos.map((o) => {
        const a = angle[o.parent] ?? 0;
        return <line key={"o" + o.node.key + o.parent} x1={Math.cos(a) * R1} y1={Math.sin(a) * R1} x2={o.x} y2={o.y} className="collab-edge dim" strokeWidth={1} />;
      })}
      {ring.map((r) => {
        const a = angle[r.node.key];
        return <line key={"l" + r.node.key} x1={0} y1={0} x2={Math.cos(a) * R1} y2={Math.sin(a) * R1} className="collab-edge"
          strokeWidth={0.8 + (r.songs / maxSongs) * 5} />;
      })}
      {outerPos.map((o) => (
        <g key={"n" + o.node.key + o.parent} transform={`translate(${o.x},${o.y})`} className="collab-node dim" onClick={() => onPick(o.node.key)} style={{ cursor: "pointer" }}>
          <title>{`${o.node.name} (through ${byKey[o.parent]?.name ?? ""})`}</title>
          <circle r={4} className={o.node.artist_id ? "has-page" : "guest"} />
        </g>
      ))}
      {ring.map((r, i) => {
        const a = angle[r.node.key];
        const x = Math.cos(a) * R1, y = Math.sin(a) * R1;
        const rad = Math.min(5 + Math.sqrt(r.songs) * 2.6, 16);
        const right = Math.cos(a) >= 0;
        return (
          <g key={"r" + r.node.key} transform={`translate(${x},${y})`} className="collab-node" onClick={() => onPick(r.node.key)} style={{ cursor: "pointer" }}>
            <title>{`${r.node.name}: ${r.songs} song${r.songs === 1 ? "" : "s"} together`}</title>
            <circle r={rad} className={r.node.artist_id ? "has-page" : "guest"}
              style={colour(r.node) ? (r.node.artist_id ? { fill: colour(r.node)! } : { stroke: colour(r.node)! }) : undefined} />
            {(showAllNames || i < 36) && (
              <text x={right ? rad + 5 : -rad - 5} y={4} textAnchor={right ? "start" : "end"} className="collab-label">{r.node.name}</text>
            )}
          </g>
        );
      })}
      <g className="collab-node">
        <circle r={24} className={`${center.artist_id ? "has-page" : "guest"} on`} style={colour(center) && center.artist_id ? { fill: colour(center)! } : undefined} />
        <text y={44} textAnchor="middle" className="collab-label collab-center-label">{center.name}</text>
      </g>
    </svg>
  );
}

// ------------------------------------------------------------------- page

// ------------------------------------------------------------------- page

// Colours for the biggest scenes (genre tags). Anything smaller stays white.
const SCENE_COLOURS = ["#FF3355", "#22D3EE", "#8B7CF6", "#22C55E", "#F5B841", "#F472B6", "#60A5FA", "#FB923C", "#A3E635", "#E879F9"];
type Recent = { id: string; title: string; cover_url: string | null; d: string; a: string; b: string };

function ArtistSearch({ nodes, placeholder, onPick }: { nodes: Node[]; placeholder: string; onPick: (key: string) => void }) {
  const [q, setQ] = useState("");
  const matches = q.trim().length >= 2
    ? nodes.filter((n) => n.name.toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => Number(!!b.artist_id) - Number(!!a.artist_id) || b.degree - a.degree).slice(0, 8)
    : [];
  return (
    <div className="cm-search">
      <input className="search-input" type="search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {matches.length > 0 && (
        <div className="cm-matches">
          {matches.map((m) => (
            <button key={m.key} onClick={() => { onPick(m.key); setQ(""); }}>
              <b>{m.name}</b><span>{m.degree} collab{m.degree === 1 ? "" : "s"}{m.artist_id ? "" : " · guest"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Panel({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="cm-panel">
      <div className="cm-panel-head"><h2>{title}</h2>{right}</div>
      {children}
    </section>
  );
}

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const centerKey = params.get("artist");
  const mode: Mode = (params.get("view") as Mode) || "circle";
  const [data, setData] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [extras, setExtras] = useState<{ genres: Record<string, string>; recent: Recent[] } | null>(null);
  const [showGuests, setShowGuests] = useState(true);
  const [minSongs, setMinSongs] = useState(1);
  const [genre, setGenre] = useState("");
  const [friends, setFriends] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [showMapOnPhone, setShowMapOnPhone] = useState(false);
  const [scenePick, setScenePick] = useState<string | null>(null);
  const [pair, setPair] = useState<[string, string] | null>(null);
  const [pairQ, setPairQ] = useState("");
  const [pairLimit, setPairLimit] = useState(40);

  useEffect(() => {
    supabase.rpc("rpc_collab_graph_cached")
      .then(({ data: d }) => setData((d as { nodes: Node[]; edges: Edge[] }) ?? { nodes: [], edges: [] }));
    supabase.rpc("rpc_collab_extras")
      .then(({ data: d }) => setExtras((d as { genres: Record<string, string>; recent: Recent[] }) ?? { genres: {}, recent: [] }));
  }, []);

  function go(next: { artist?: string | null; view?: Mode }) {
    const p = new URLSearchParams();
    const artist = next.artist === undefined ? centerKey : next.artist;
    const view = next.view ?? mode;
    if (artist) p.set("artist", artist);
    if (view !== "circle") p.set("view", view);
    router.replace(`/collabs${p.toString() ? `?${p}` : ""}`, { scroll: false });
  }

  // After the filters: who's in, and who they've worked with.
  const filtered = useMemo(() => {
    if (!data) return null;
    const keep = new Set(data.nodes.filter((n) => showGuests || n.artist_id).map((n) => n.key));
    const edges = data.edges.filter((e) => e.songs >= minSongs && keep.has(e.a) && keep.has(e.b));
    const adj = new Map<string, { other: string; edge: Edge }[]>();
    for (const e of edges) {
      if (!adj.has(e.a)) adj.set(e.a, []);
      if (!adj.has(e.b)) adj.set(e.b, []);
      adj.get(e.a)!.push({ other: e.b, edge: e });
      adj.get(e.b)!.push({ other: e.a, edge: e });
    }
    const deg: Record<string, number> = {};
    adj.forEach((v, k) => { deg[k] = v.length; });
    const nodes = data.nodes.filter((n) => adj.has(n.key)).map((n) => ({ ...n, degree: deg[n.key] ?? 0 }));
    return { nodes, edges, adj };
  }, [data, showGuests, minSongs]);
  const byKey = useMemo(() => Object.fromEntries((data?.nodes ?? []).map((n) => [n.key, n])), [data]);

  // Scenes: each artist's main genre tag, from the genre pages. Guests have none.
  const genreOf = (k: string) => extras?.genres[k] ?? null;
  const scenes = useMemo(() => {
    if (!filtered || !extras) return [];
    const n: Record<string, number> = {};
    filtered.nodes.forEach((x) => { const g = x.artist_id ? extras.genres[x.artist_id] : null; if (g) n[g] = (n[g] ?? 0) + 1; });
    return Object.entries(n).sort((a, b) => b[1] - a[1]);
  }, [filtered, extras]);
  const sceneColour = useMemo(() => Object.fromEntries(scenes.slice(0, SCENE_COLOURS.length).map(([g], i) => [g, SCENE_COLOURS[i]])), [scenes]);
  const colour = useMemo(() => (n: Node) => {
    const g = n.artist_id ? extras?.genres[n.artist_id] : null;
    return g ? sceneColour[g] ?? null : null;
  }, [extras, sceneColour]);
  // Picking a scene highlights its artists and the guests they work with.
  const focus = useMemo(() => {
    if (!genre || !filtered || !extras) return null;
    const f = new Set<string>();
    filtered.nodes.forEach((n) => { if (n.artist_id && extras.genres[n.artist_id] === genre) f.add(n.key); });
    [...f].forEach((k) => (filtered.adj.get(k) ?? []).forEach((l) => { if (!byKey[l.other]?.artist_id) f.add(l.other); }));
    return f;
  }, [genre, filtered, extras, byKey]);

  const center = centerKey ? byKey[centerKey] ?? null : null;
  const ringLinks = useMemo(
    () => (center && filtered ? [...(filtered.adj.get(center.key) ?? [])].sort((a, b) => b.edge.songs - a.edge.songs) : []),
    [center, filtered]
  );
  const outer = useMemo(() => {
    if (!friends || !center || !filtered) return [];
    const inRing = new Set([center.key, ...ringLinks.map((l) => l.other)]);
    const out: { node: Node; parent: string }[] = [];
    const seen = new Set<string>();
    for (const l of ringLinks) {
      for (const l2 of [...(filtered.adj.get(l.other) ?? [])].sort((a, b) => b.edge.songs - a.edge.songs).slice(0, 6)) {
        if (inRing.has(l2.other) || seen.has(l2.other) || !byKey[l2.other]) continue;
        seen.add(l2.other);
        out.push({ node: byKey[l2.other], parent: l.other });
        if (out.length >= 140) return out;
      }
    }
    return out;
  }, [friends, center, filtered, ringLinks, byKey]);

  // How two artists connect: the shortest chain of collaborations.
  const path = useMemo(() => {
    if (mode !== "path" || !from || !to || !filtered) return null;
    if (from === to) return [from];
    const prev = new Map<string, string>([[from, ""]]);
    const queue = [from];
    while (queue.length) {
      const k = queue.shift()!;
      for (const l of filtered.adj.get(k) ?? []) {
        if (prev.has(l.other)) continue;
        prev.set(l.other, k);
        if (l.other === to) {
          const chain = [to];
          let c = k;
          while (c) { chain.unshift(c); c = prev.get(c) ?? ""; }
          return chain;
        }
        queue.push(l.other);
      }
    }
    return [];
  }, [mode, from, to, filtered]);
  const edgeOf = (a: string, b: string) => filtered?.adj.get(a)?.find((l) => l.other === b)?.edge;

  const inScene = (k: string) => !focus || focus.has(k);
  // Pairings: the pairs with the most songs together.
  const pairs = useMemo(() => {
    if (!filtered) return [];
    const q = pairQ.trim().toLowerCase();
    return [...filtered.edges]
      .filter((e) => (!focus || (focus.has(e.a) && focus.has(e.b))) &&
        (!q || (byKey[e.a]?.name ?? "").toLowerCase().includes(q) || (byKey[e.b]?.name ?? "").toLowerCase().includes(q)))
      .sort((a, b) => b.songs - a.songs);
  }, [filtered, focus, pairQ, byKey]);
  const hot = pairs.slice(0, 6);
  // Bridge artists: the ones whose collaborators come from the most scenes.
  const bridges = useMemo(() => {
    if (!filtered || !extras) return [];
    return filtered.nodes.filter((n) => n.artist_id && inScene(n.key)).map((n) => {
      const gs = new Set<string>();
      (filtered.adj.get(n.key) ?? []).forEach((l) => { const g = genreOf(l.other); if (g) gs.add(g); });
      return { n, scenes: gs.size, list: [...gs] };
    }).filter((b) => b.scenes >= 3).sort((a, b) => b.scenes - a.scenes || b.n.degree - a.n.degree).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, extras, focus]);
  const recent = useMemo(() => (extras?.recent ?? []).filter((r) => byKey[r.a] && byKey[r.b] && (!focus || focus.has(r.a) || focus.has(r.b))).slice(0, 6), [extras, byKey, focus]);
  const pairEdge = pair ? edgeOf(pair[0], pair[1]) : undefined;

  // Song titles for what's on screen.
  const wantTitles = useMemo(() => {
    const out: string[] = [...(pairEdge?.tracks ?? [])];
    if (mode === "path" && path && path.length > 1) out.push(...path.slice(1).flatMap((k, i) => edgeOf(path[i], k)?.tracks ?? []));
    else if (mode === "pairs") out.push(...pairs.slice(0, pairLimit).flatMap((e) => e.tracks.slice(0, 4)));
    else out.push(...ringLinks.slice(0, 40).flatMap((l) => l.edge.tracks));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, path, ringLinks, pairs, pairLimit, pairEdge]);
  useEffect(() => {
    const ids = [...new Set(wantTitles.filter((id) => !titles[id]))];
    if (ids.length === 0) return;
    supabase.from("tracks").select("id, title").in("id", ids.slice(0, 200)).then(({ data: rows }) => {
      setTitles((prev) => ({ ...prev, ...Object.fromEntries((rows ?? []).map((r) => [r.id, r.title])) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantTitles]);

  const hubs = useMemo(() => (filtered ? [...filtered.nodes].filter((n) => n.artist_id && inScene(n.key)).sort((a, b) => b.degree - a.degree).slice(0, 18) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, focus]);
  const songsLine = (ids: string[]) => (
    <div className="feed-tracks">
      {ids.map((id) => <Link key={id} href={`/song/${id}`} className="feed-track">{titles[id] ?? "…"}</Link>)}
    </div>
  );
  const name = (k: string) => byKey[k]?.name ?? k.replace(/^guest:/, "");
  const Dot = ({ k }: { k: string }) => {
    const n = byKey[k];
    const c = n ? colour(n) : null;
    return <span className={`cm-dot${n?.artist_id ? "" : " guest"}`} style={c ? { background: n?.artist_id ? c : undefined, borderColor: c } : undefined} />;
  };
  const Who = ({ k }: { k: string }) => (
    <button className="cm-who" onClick={() => go({ artist: k, view: "circle" })}><Dot k={k} />{name(k)}</button>
  );

  // ----- side panels
  const selected = mode === "scene" ? scenePick : mode === "circle" ? center?.key ?? null : null;
  const side = (
    <aside className="cm-side">
      {pair && pairEdge && (
        <Panel title="Selected connection" right={<button className="mod-link" onClick={() => setPair(null)} aria-label="Close">✕</button>}>
          <div className="cm-pair-big">
            <Who k={pair[0]} /><span className="cm-x">×</span><Who k={pair[1]} />
          </div>
          <div className="comment-meta">{pairEdge.songs} song{pairEdge.songs === 1 ? "" : "s"} together</div>
          {songsLine(pairEdge.tracks)}
          <div className="cm-actions">
            <button className="st-btn" onClick={() => { setFrom(pair[0]); setTo(pair[1]); }}>Use in paths</button>
          </div>
        </Panel>
      )}
      {selected && byKey[selected] && (
        <Panel title="Selected artist">
          <div className="cm-pair-big"><Who k={selected} /></div>
          <div className="comment-meta">
            Worked with {filtered?.adj.get(selected)?.length ?? 0} {(filtered?.adj.get(selected)?.length ?? 0) === 1 ? "person" : "people"}
            {genreOf(selected) && <> · <button className="mod-link" onClick={() => setGenre(genreOf(selected)!)}>{genreOf(selected)}</button></>}
            {!byKey[selected].artist_id && <> · guest (no page yet)</>}
          </div>
          <div className="cm-actions">
            {mode !== "circle" && <button className="st-btn" onClick={() => go({ artist: selected, view: "circle" })}>See their circle</button>}
            {byKey[selected].artist_id && <Link href={`/artist/${byKey[selected].artist_id}`} className="st-btn">Artist page →</Link>}
          </div>
        </Panel>
      )}
      <Panel title="Hot connections">
        {hot.length === 0 && <div className="comment-meta">Nothing with these filters.</div>}
        {hot.map((e) => (
          <button key={e.a + e.b} className={`cm-row${pair && pair[0] === e.a && pair[1] === e.b ? " on" : ""}`} onClick={() => setPair([e.a, e.b])}>
            <span className="cm-row-names"><Dot k={e.a} />{name(e.a)} <span className="cm-x">×</span> <Dot k={e.b} />{name(e.b)}</span>
            <span className="cm-num">{e.songs}</span>
          </button>
        ))}
      </Panel>
      <Panel title="Scenes" right={genre ? <button className="mod-link" onClick={() => setGenre("")}>show all</button> : undefined}>
        <div className="comment-meta cm-note">From artists&apos; genre tags. Tap one to light it up.</div>
        {!extras && <div className="comment-meta">loading…</div>}
        <div className="cm-scenes">
          {scenes.slice(0, 12).map(([g, n]) => (
            <button key={g} className={`cm-scene${genre === g ? " on" : ""}`} onClick={() => setGenre(genre === g ? "" : g)}
              style={{ "--sc": sceneColour[g] ?? "var(--smoke)" } as React.CSSProperties}>
              <span className="cm-scene-dot" />{g}<span className="cm-num">{n}</span>
            </button>
          ))}
        </div>
      </Panel>
      {bridges.length > 0 && (
        <Panel title="Bridge artists">
          <div className="comment-meta cm-note">Their collaborators come from the most different scenes.</div>
          {bridges.map((b) => (
            <button key={b.n.key} className="cm-row" onClick={() => go({ artist: b.n.key, view: "circle" })}>
              <span className="cm-row-names"><Dot k={b.n.key} />{b.n.name}</span>
              <span className="cm-scene-dots">{b.list.slice(0, 6).map((g) => <span key={g} title={g} style={{ background: sceneColour[g] ?? "var(--smoke)" }} />)}</span>
              <span className="cm-num">{b.scenes} scenes</span>
            </button>
          ))}
        </Panel>
      )}
      {recent.length > 0 && (
        <Panel title="Recent collabs">
          {recent.map((r) => (
            <Link key={r.id} href={`/song/${r.id}`} className="cm-recent">
              {r.cover_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={thumb(r.cover_url)} alt="" loading="lazy" />
                : <span className="cm-recent-blank" />}
              <span className="cm-recent-text">
                <b>{r.title}</b>
                <span>{name(r.a)} × {name(r.b)}</span>
              </span>
              <span className="cm-num">{new Date(r.d).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
            </Link>
          ))}
        </Panel>
      )}
    </aside>
  );

  const tabs: [Mode, string][] = [["circle", "One artist"], ["scene", "Scene"], ["path", "Paths"], ["pairs", "Pairings"]];

  return (
    <div className="wrap cm-page">
      <h1 className="detail-name page-title cm-title">Collab map</h1>
      <p className="cm-lead">Who&apos;s worked with who, from shared songs and features.</p>
      {filtered && (
        <div className="cm-stats">
          <span><b>{filtered.nodes.length.toLocaleString("en-GB")}</b> artists</span>
          <span><b>{filtered.edges.length.toLocaleString("en-GB")}</b> collaborations</span>
          {scenes.length > 0 && <span><b>{scenes.length.toLocaleString("en-GB")}</b> scenes</span>}
        </div>
      )}

      <div className="st-seg cm-tabs" role="tablist">
        {tabs.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={mode === t} className={mode === t ? "on" : undefined} onClick={() => go({ view: t })}>{label}</button>
        ))}
      </div>

      <div className="cm-bar">
        {filtered && (mode === "circle" || mode === "scene") && (
          <ArtistSearch nodes={filtered.nodes} placeholder="Find an artist…"
            onPick={(k) => { if (mode === "scene") setScenePick(k); else go({ artist: k }); }} />
        )}
        {mode === "pairs" && (
          <div className="cm-search"><input className="search-input" type="search" placeholder="Find a pairing by artist…" value={pairQ} onChange={(e) => { setPairQ(e.target.value); setPairLimit(40); }} /></div>
        )}
        {mode === "path" && <div className="cm-search cm-hint comment-meta">Pick two artists below to see how they connect.</div>}
        <div className="cm-filters">
          <button className={`cm-toggle${showGuests ? " on" : ""}`} onClick={() => setShowGuests(!showGuests)}
            title="Artists without a page here, only mentioned on songs">{showGuests ? "✓ " : ""}Guests</button>
          <select className="sort-select" value={minSongs} onChange={(e) => setMinSongs(Number(e.target.value))} aria-label="Minimum songs together">
            <option value={1}>Any collab</option>
            <option value={2}>2+ songs together</option>
            <option value={3}>3+ songs together</option>
            <option value={5}>5+ songs together</option>
          </select>
          <select className="sort-select" value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Scene">
            <option value="">All scenes</option>
            {scenes.map(([g, n]) => <option key={g} value={g}>{g} ({n})</option>)}
          </select>
          {mode === "circle" && center && (
            <button className={`cm-toggle${friends ? " on" : ""}`} onClick={() => setFriends(!friends)}>{friends ? "✓ " : ""}Their collaborators too</button>
          )}
        </div>
      </div>

      {!filtered && <div className="empty-state">loading…</div>}

      {filtered && (
        <div className="cm-layout">
          <div className="cm-main">
            {/* ------------------------------------------------------------ circle */}
            {mode === "circle" && !center && (
              <section className="cm-panel">
                <div className="cm-panel-head"><h2>Start with someone</h2></div>
                <div className="cm-hubs">
                  {hubs.map((h) => (
                    <button key={h.key} className="cm-hub" onClick={() => go({ artist: h.key })}>
                      <Dot k={h.key} /><b>{h.name}</b><span className="cm-num">{h.degree}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {mode === "circle" && centerKey && !center && <div className="empty-state">That artist has no collaborations yet.</div>}
            {mode === "circle" && center && (
              <>
                <div className={`cm-stage ${showMapOnPhone ? "" : "phone-hide"}`}>
                  {ringLinks.length === 0
                    ? <div className="empty-state">No collaborations with these filters.</div>
                    : <Circle center={center} ring={ringLinks.map((l) => ({ node: byKey[l.other], songs: l.edge.songs })).filter((r) => r.node)}
                        outer={outer} byKey={byKey} onPick={(k) => go({ artist: k })} colour={colour} />}
                  <div className="collab-legend comment-meta cm-legend">
                    <span><span className="collab-dot has-page" /> has a page</span>
                    <span><span className="collab-dot guest" /> guest</span>
                    <span>colour = scene · bigger circle, thicker line = more songs together · tap anyone to move them to the middle</span>
                  </div>
                </div>
                <button className="st-btn phone-only cm-phone-map" onClick={() => setShowMapOnPhone(!showMapOnPhone)}>
                  {showMapOnPhone ? "Hide the map" : "Show the map"}
                </button>
                <section className="cm-panel">
                  <div className="cm-panel-head"><h2>Worked with</h2><span className="cm-num">{ringLinks.length}</span></div>
                  <div className="cm-list">
                    {ringLinks.map((l) => byKey[l.other] && (
                      <div key={l.other} className="cm-link">
                        <div className="cm-link-top">
                          <Who k={l.other} />
                          <span className="comment-meta">{l.edge.songs} song{l.edge.songs === 1 ? "" : "s"}{!byKey[l.other].artist_id ? " · guest" : ""}</span>
                        </div>
                        {songsLine(l.edge.tracks)}
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}

            {/* ------------------------------------------------------------- scene */}
            {mode === "scene" && (
              <>
                <Scene nodes={filtered.nodes} edges={filtered.edges} onPick={setScenePick} colour={colour} focus={focus} picked={scenePick} />
                <div className="collab-legend comment-meta cm-legend">
                  {scenes.slice(0, SCENE_COLOURS.length).map(([g]) => (
                    <button key={g} className={`cm-key${genre === g ? " on" : ""}`} onClick={() => setGenre(genre === g ? "" : g)}>
                      <span className="collab-dot" style={{ background: sceneColour[g] }} />{g}
                    </button>
                  ))}
                  <span>drag to move · scroll or + / − to zoom · tap anyone</span>
                </div>
              </>
            )}

            {/* -------------------------------------------------------------- path */}
            {mode === "path" && (
              <section className="cm-panel">
                <div className="cm-path-pick">
                  <div>
                    <div className="cm-label">From {from && byKey[from] ? <b>{byKey[from].name}</b> : ""}</div>
                    <ArtistSearch nodes={filtered.nodes} placeholder="First artist…" onPick={setFrom} />
                  </div>
                  <span className="cm-path-arrow" aria-hidden>→</span>
                  <div>
                    <div className="cm-label">To {to && byKey[to] ? <b>{byKey[to].name}</b> : ""}</div>
                    <ArtistSearch nodes={filtered.nodes} placeholder="Second artist…" onPick={setTo} />
                  </div>
                </div>
                {path && path.length === 0 && <div className="empty-state">No connection between them yet (with these filters).</div>}
                {path && path.length > 1 && (
                  <>
                    <div className="cm-path-chain">
                      {path.map((k, i) => (
                        <span key={k} className="cm-path-step">
                          <Who k={k} />{i < path.length - 1 && <span className="cm-path-arrow" aria-hidden>→</span>}
                        </span>
                      ))}
                    </div>
                    <div className="cm-label">{path.length - 1} step{path.length === 2 ? "" : "s"} apart</div>
                    <div className="cm-path">
                      {path.slice(0, -1).map((k, i) => {
                        const e = edgeOf(k, path[i + 1]);
                        return e ? (
                          <div key={k} className="cm-path-link">
                            <div className="cm-link-top"><span>{name(k)} <span className="cm-x">×</span> {name(path[i + 1])}</span>
                              <span className="comment-meta">{e.songs} song{e.songs === 1 ? "" : "s"}</span></div>
                            {songsLine(e.tracks)}
                          </div>
                        ) : null;
                      })}
                    </div>
                  </>
                )}
              </section>
            )}

            {/* ------------------------------------------------------------ pairings */}
            {mode === "pairs" && (
              <section className="cm-panel">
                <div className="cm-panel-head"><h2>Most songs together</h2><span className="cm-num">{pairs.length.toLocaleString("en-GB")} pairs</span></div>
                {pairs.length === 0 && <div className="comment-meta">No pairings with these filters.</div>}
                <div className="cm-list">
                  {pairs.slice(0, pairLimit).map((e, i) => (
                    <div key={e.a + e.b} className={`cm-link cm-pairing${pair && pair[0] === e.a && pair[1] === e.b ? " on" : ""}`}>
                      <span className="cm-rank">{i + 1}</span>
                      <div className="cm-pairing-main">
                        <div className="cm-link-top">
                          <span><Who k={e.a} /> <span className="cm-x">×</span> <Who k={e.b} /></span>
                          <button className="cm-count" onClick={() => setPair([e.a, e.b])}>{e.songs} song{e.songs === 1 ? "" : "s"}</button>
                        </div>
                        {songsLine(e.tracks.slice(0, 4))}
                        {e.tracks.length > 4 && <button className="mod-link" onClick={() => setPair([e.a, e.b])}>+{e.tracks.length - 4} more</button>}
                      </div>
                    </div>
                  ))}
                </div>
                {pairs.length > pairLimit && <button className="st-btn cm-more" onClick={() => setPairLimit(pairLimit + 40)}>Show more</button>}
              </section>
            )}
          </div>
          {side}
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
