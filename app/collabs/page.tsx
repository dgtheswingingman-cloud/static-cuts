"use client";

// Collab map: who has worked with who.
//   Circle (default): one artist in the middle, the people they've worked
//     with around them (thicker line = more songs together). Tap anyone to
//     move them to the middle. On phones it's a list first.
//   Whole scene: everyone at once, drawn on a canvas so it stays quick as
//     the archive grows; the layout is worked out in the background.
//   Path: how two artists connect, step by step, with the songs that link
//     each step.
// ?artist=<key> opens on one artist (artist id, or guest:<name>).

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Node = { key: string; artist_id: string | null; name: string; degree: number; songs: number };
type Edge = { a: string; b: string; songs: number; tracks: string[] };
type Mode = "circle" | "scene" | "path";

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

function Scene({ nodes, edges, onPick }: { nodes: Node[]; edges: Edge[]; onPick: (key: string) => void }) {
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
    const near = new Set<number>();
    if (hover !== null) edges.forEach((e) => { const a = index[e.a], b = index[e.b]; if (a === hover) near.add(b); if (b === hover) near.add(a); });
    ctx.lineCap = "round";
    for (const e of edges) {
      const a = index[e.a], b = index[e.b];
      const on = hover !== null && (a === hover || b === hover);
      ctx.strokeStyle = on ? bone : hair;
      ctx.globalAlpha = hover === null ? 0.5 : on ? 1 : 0.08;
      ctx.lineWidth = Math.min(0.6 + e.songs * 0.35, 4);
      ctx.beginPath(); ctx.moveTo(sx(pos.x[a]), sy(pos.y[a])); ctx.lineTo(sx(pos.x[b]), sy(pos.y[b])); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const r = (n: Node) => Math.min(3 + Math.sqrt(n.degree) * 2.4, 18) * Math.max(0.6, Math.min(view.scale * 1.6, 1.6));
    nodes.forEach((n, i) => {
      const dim = hover !== null && i !== hover && !near.has(i);
      ctx.globalAlpha = dim ? 0.2 : 1;
      ctx.beginPath(); ctx.arc(sx(pos.x[i]), sy(pos.y[i]), r(n), 0, Math.PI * 2);
      if (n.artist_id) { ctx.fillStyle = bone; ctx.fill(); } else { ctx.strokeStyle = smoke; ctx.lineWidth = 1.2; ctx.stroke(); }
    });
    // Names: the busiest artists first, skipping ones that would overlap.
    ctx.font = `11px ui-monospace, monospace`;
    ctx.textAlign = "center";
    const placed: number[][] = [];
    const order = nodes.map((_, i) => i).sort((a, b) => Number(b === hover || near.has(b)) - Number(a === hover || near.has(a)) || nodes[b].degree - nodes[a].degree);
    let count = 0;
    for (const i of order) {
      const x = sx(pos.x[i]), y = sy(pos.y[i]) + r(nodes[i]) + 11;
      if (x < 0 || x > W || y < 0 || y > H) continue;
      const w = ctx.measureText(nodes[i].name).width;
      const box = [x - w / 2, y - 10, x + w / 2, y + 2];
      const must = i === hover || near.has(i);
      if (!must && placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      ctx.globalAlpha = hover !== null && !must ? 0.3 : 1;
      ctx.fillStyle = must ? bone : smoke;
      ctx.fillText(nodes[i].name, x, y);
      if (++count > 160) break;
    }
    ctx.globalAlpha = 1;
  }, [pos, view, hover, nodes, edges, index]);

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
    <div className="collab-stage">
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

function Circle({ center, ring, outer, byKey, onPick }: {
  center: Node; ring: { node: Node; songs: number }[]; outer: { node: Node; parent: string }[];
  byKey: Record<string, Node>; onPick: (key: string) => void;
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
            <circle r={rad} className={r.node.artist_id ? "has-page" : "guest"} />
            {(showAllNames || i < 36) && (
              <text x={right ? rad + 5 : -rad - 5} y={4} textAnchor={right ? "start" : "end"} className="collab-label">{r.node.name}</text>
            )}
          </g>
        );
      })}
      <g className="collab-node">
        <circle r={24} className={`${center.artist_id ? "has-page" : "guest"} on`} />
        <text y={44} textAnchor="middle" className="collab-label collab-center-label">{center.name}</text>
      </g>
    </svg>
  );
}

// ------------------------------------------------------------------- page

function ArtistSearch({ nodes, placeholder, onPick }: { nodes: Node[]; placeholder: string; onPick: (key: string) => void }) {
  const [q, setQ] = useState("");
  const matches = q.trim().length >= 2
    ? nodes.filter((n) => n.name.toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => Number(!!b.artist_id) - Number(!!a.artist_id) || b.degree - a.degree).slice(0, 8)
    : [];
  return (
    <div style={{ flex: "1 1 220px" }}>
      <input className="search-input" style={{ width: "100%" }} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {matches.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {matches.map((m) => (
            <button key={m.key} className="rating-chip" onClick={() => { onPick(m.key); setQ(""); }}>{m.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const centerKey = params.get("artist");
  const mode: Mode = (params.get("view") as Mode) || "circle";
  const [data, setData] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [showGuests, setShowGuests] = useState(true);
  const [minSongs, setMinSongs] = useState(1);
  const [friends, setFriends] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [showMapOnPhone, setShowMapOnPhone] = useState(false);
  const [scenePick, setScenePick] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("rpc_collab_graph", { p_artist: null })
      .then(({ data: d }) => setData((d as { nodes: Node[]; edges: Edge[] }) ?? { nodes: [], edges: [] }));
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

  // Song titles for what's on screen.
  const wantTitles = useMemo(() => {
    if (mode === "path" && path && path.length > 1) return path.slice(1).flatMap((k, i) => edgeOf(path[i], k)?.tracks ?? []);
    return ringLinks.slice(0, 40).flatMap((l) => l.edge.tracks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, path, ringLinks]);
  useEffect(() => {
    const ids = wantTitles.filter((id) => !titles[id]);
    if (ids.length === 0) return;
    supabase.from("tracks").select("id, title").in("id", ids.slice(0, 200)).then(({ data: rows }) => {
      setTitles((prev) => ({ ...prev, ...Object.fromEntries((rows ?? []).map((r) => [r.id, r.title])) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantTitles]);

  const hubs = useMemo(() => (filtered ? [...filtered.nodes].filter((n) => n.artist_id).sort((a, b) => b.degree - a.degree).slice(0, 16) : []), [filtered]);
  const songsLine = (ids: string[]) => (
    <div className="feed-tracks">
      {ids.map((id) => <Link key={id} href={`/song/${id}`} className="feed-track">{titles[id] ?? "…"}</Link>)}
    </div>
  );

  return (
    <div className="wrap" style={{ maxWidth: 1100 }}>
      <h1 className="detail-name page-title">Collab map</h1>
      <div className="detail-meta">Who&apos;s worked with who, from shared songs and features.</div>

      <div className="tabs" style={{ margin: "12px 0" }}>
        <button className={`tab ${mode === "circle" ? "active" : ""}`} onClick={() => go({ view: "circle" })}>one artist</button>
        <button className={`tab ${mode === "scene" ? "active" : ""}`} onClick={() => go({ view: "scene" })}>whole scene</button>
        <button className={`tab ${mode === "path" ? "active" : ""}`} onClick={() => go({ view: "path" })}>how are they connected?</button>
      </div>

      <div className="collab-controls">
        {filtered && mode !== "path" && (
          <ArtistSearch nodes={filtered.nodes} placeholder="Find an artist…" onPick={(k) => go({ artist: k, view: "circle" })} />
        )}
        <div className="collab-toggles">
          <button className={`tab ${showGuests ? "active" : ""}`} onClick={() => setShowGuests(!showGuests)}
            title="Artists without a page here, only mentioned on songs">{showGuests ? "✓ " : ""}guests</button>
          <select className="sort-select" value={minSongs} onChange={(e) => setMinSongs(Number(e.target.value))} aria-label="Minimum songs together">
            <option value={1}>any collab</option>
            <option value={2}>2+ songs together</option>
            <option value={3}>3+ songs together</option>
            <option value={5}>5+ songs together</option>
          </select>
          {mode === "circle" && center && (
            <button className={`tab ${friends ? "active" : ""}`} onClick={() => setFriends(!friends)}>{friends ? "✓ " : ""}their collaborators too</button>
          )}
        </div>
      </div>

      {!filtered && <div className="empty-state">loading…</div>}

      {/* ------------------------------------------------------------ circle */}
      {filtered && mode === "circle" && !center && (
        <>
          <div className="section-label">Start with someone</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {hubs.map((h) => <button key={h.key} className="rating-chip" onClick={() => go({ artist: h.key })}>{h.name} · {h.degree}</button>)}
          </div>
          <div className="comment-meta" style={{ marginTop: 10 }}>
            {filtered.nodes.length.toLocaleString("en-GB")} artists, {filtered.edges.length.toLocaleString("en-GB")} collaborations.
          </div>
        </>
      )}
      {filtered && mode === "circle" && centerKey && !center && (
        <div className="empty-state">That artist has no collaborations yet.</div>
      )}
      {filtered && mode === "circle" && center && (
        <div className="collab-layout">
          <div className={`collab-stage ${showMapOnPhone ? "" : "phone-hide"}`}>
            {ringLinks.length === 0
              ? <div className="empty-state">No collaborations with these filters.</div>
              : <Circle center={center} ring={ringLinks.map((l) => ({ node: byKey[l.other], songs: l.edge.songs })).filter((r) => r.node)}
                  outer={outer} byKey={byKey} onPick={(k) => go({ artist: k })} />}
            <div className="collab-legend comment-meta">
              <span><span className="collab-dot has-page" /> has a page</span>
              <span><span className="collab-dot guest" /> guest</span>
              <span>bigger circle, thicker line = more songs together · tap anyone to move them to the middle</span>
            </div>
          </div>
          <div className="collab-side">
            <div className="review-row-title" style={{ fontSize: "1.05rem" }}>
              {center.artist_id ? <Link href={`/artist/${center.artist_id}`}>{center.name}</Link> : center.name}
            </div>
            <div className="comment-meta" style={{ marginBottom: 10 }}>
              Worked with {ringLinks.length} {ringLinks.length === 1 ? "person" : "people"}
              {!center.artist_id && <> · guest (no page yet)</>}
            </div>
            <button className="rating-chip phone-only" style={{ marginBottom: 10 }} onClick={() => setShowMapOnPhone(!showMapOnPhone)}>
              {showMapOnPhone ? "hide the map" : "show the map"}
            </button>
            {ringLinks.map((l) => {
              const other = byKey[l.other];
              if (!other) return null;
              return (
                <div key={l.other} className="collab-link">
                  <button className="text-link collab-link-name" onClick={() => go({ artist: l.other })}>{other.name}</button>
                  <span className="comment-meta"> · {l.edge.songs} song{l.edge.songs === 1 ? "" : "s"}{!other.artist_id ? " · guest" : ""}</span>
                  {songsLine(l.edge.tracks)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- scene */}
      {filtered && mode === "scene" && (
        <div className="collab-layout">
          <Scene nodes={filtered.nodes} edges={filtered.edges} onPick={setScenePick} />
          <div className="collab-side">
            {!scenePick && (
              <div className="comment-meta">
                Everyone at once: {filtered.nodes.length.toLocaleString("en-GB")} artists. Drag to move, scroll or use + / − to
                zoom, tap anyone to see who they are.
              </div>
            )}
            {scenePick && byKey[scenePick] && (
              <>
                <div className="review-row-title" style={{ fontSize: "1.05rem" }}>{byKey[scenePick].name}</div>
                <div className="comment-meta" style={{ marginBottom: 10 }}>
                  Worked with {filtered.adj.get(scenePick)?.length ?? 0} {(filtered.adj.get(scenePick)?.length ?? 0) === 1 ? "person" : "people"}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button className="rating-chip" onClick={() => go({ artist: scenePick, view: "circle" })}>see their circle</button>
                  {byKey[scenePick].artist_id && <Link href={`/artist/${byKey[scenePick].artist_id}`} className="rating-chip">open page</Link>}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------- path */}
      {filtered && mode === "path" && (
        <>
          <div className="collab-controls" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 220px" }}>
              <div className="comment-meta" style={{ marginBottom: 4 }}>From {from && byKey[from] ? <b>{byKey[from].name}</b> : "…"}</div>
              <ArtistSearch nodes={filtered.nodes} placeholder="First artist…" onPick={setFrom} />
            </div>
            <div style={{ flex: "1 1 220px" }}>
              <div className="comment-meta" style={{ marginBottom: 4 }}>To {to && byKey[to] ? <b>{byKey[to].name}</b> : "…"}</div>
              <ArtistSearch nodes={filtered.nodes} placeholder="Second artist…" onPick={setTo} />
            </div>
          </div>
          {path && path.length === 0 && <div className="empty-state">No connection between them yet (with these filters).</div>}
          {path && path.length > 1 && (
            <div className="comments-panel">
              <div className="section-label" style={{ margin: "0 0 8px" }}>
                {path.length - 1} step{path.length === 2 ? "" : "s"} apart
              </div>
              {path.map((k, i) => (
                <div key={k} style={{ marginBottom: 8 }}>
                  <button className="text-link collab-link-name" onClick={() => go({ artist: k, view: "circle" })}>{byKey[k]?.name ?? k}</button>
                  {i < path.length - 1 && (() => {
                    const e = edgeOf(k, path[i + 1]);
                    return e ? (
                      <div style={{ paddingLeft: 14, borderLeft: "1px solid var(--hair)", margin: "4px 0 0 4px" }}>
                        <span className="comment-meta">{e.songs} song{e.songs === 1 ? "" : "s"} together with {byKey[path[i + 1]]?.name}</span>
                        {songsLine(e.tracks)}
                      </div>
                    ) : null;
                  })()}
                </div>
              ))}
            </div>
          )}
        </>
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
