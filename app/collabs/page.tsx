"use client";

// Collab map: who has worked with who. Artists with a page are filled
// circles; guests without one are outlines. Tap anyone to see who they've
// worked with and on which songs; ?artist=<id> starts focused on one artist.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Node = { key: string; artist_id: string | null; name: string; degree: number; songs: number };
type Edge = { a: string; b: string; songs: number; tracks: string[] };
type Pos = Record<string, { x: number; y: number }>;

const W = 1000;
const H = 700;

// A small force layout: nodes push apart, links pull together, everything
// drifts to the middle. Deterministic, so the map looks the same each time.
function layout(nodes: Node[], edges: Edge[]): Pos {
  const pos: Pos = {};
  const n = nodes.length;
  nodes.forEach((nd, i) => {
    const a = (i / Math.max(n, 1)) * Math.PI * 2;
    const r = 220 + (i % 5) * 30;
    pos[nd.key] = { x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r };
  });
  const vel: Record<string, { x: number; y: number }> = {};
  nodes.forEach((nd) => (vel[nd.key] = { x: 0, y: 0 }));
  for (let step = 0; step < 400; step++) {
    const cool = 1 - step / 400;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const p = pos[nodes[i].key], q = pos[nodes[j].key];
        let dx = p.x - q.x, dy = p.y - q.y;
        const d2 = Math.max(dx * dx + dy * dy, 25);
        const f = 2400 / d2;
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
      const f = (d - 90) * 0.02;
      vel[e.a].x += (dx / d) * f; vel[e.a].y += (dy / d) * f;
      vel[e.b].x -= (dx / d) * f; vel[e.b].y -= (dy / d) * f;
    }
    for (const nd of nodes) {
      const p = pos[nd.key], v = vel[nd.key];
      v.x += (W / 2 - p.x) * 0.004; v.y += (H / 2 - p.y) * 0.004;
      p.x += Math.max(-20, Math.min(20, v.x)) * cool;
      p.y += Math.max(-20, Math.min(20, v.y)) * cool;
      p.x = Math.max(30, Math.min(W - 30, p.x));
      p.y = Math.max(30, Math.min(H - 30, p.y));
      v.x *= 0.6; v.y *= 0.6;
    }
  }
  return pos;
}

function radius(nd: Node) {
  return Math.min(6 + Math.sqrt(nd.degree) * 4, 26);
}

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const focus = params.get("artist");
  const [data, setData] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(focus);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");

  useEffect(() => {
    setData(null);
    supabase.rpc("rpc_collab_graph", { p_artist: focus }).then(({ data: d }) => setData((d as { nodes: Node[]; edges: Edge[] }) ?? { nodes: [], edges: [] }));
    setSelected(focus);
  }, [focus]);

  const pos = useMemo(() => (data ? layout(data.nodes, data.edges) : {}), [data]);
  const byKey = useMemo(() => Object.fromEntries((data?.nodes ?? []).map((n) => [n.key, n])), [data]);
  const links = useMemo(
    () => (selected && data ? data.edges.filter((e) => e.a === selected || e.b === selected).sort((x, y) => y.songs - x.songs) : []),
    [selected, data]
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

  const neighbours = new Set(links.flatMap((e) => [e.a, e.b]));
  const sel = selected ? byKey[selected] : null;
  const matches = query.trim().length >= 2
    ? (data?.nodes ?? []).filter((n) => n.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    <div className="wrap" style={{ maxWidth: 1100 }}>
      <button className="back-btn" onClick={() => router.push("/")}>← home</button>
      <h1 className="detail-name page-title">Collab map</h1>
      <div className="detail-meta">
        Who&apos;s worked with who, from shared songs and features. Filled circles have a page here; outlines are guests.
        Tap anyone to see their collaborations.
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input className="search-input" style={{ flex: "1 1 220px" }} placeholder="Find an artist…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {focus && <button className="tab" onClick={() => router.replace("/collabs")}>show everyone</button>}
      </div>
      {matches.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {matches.map((m) => (
            <button key={m.key} className="rating-chip" onClick={() => { setSelected(m.key); setQuery(""); }}>{m.name}</button>
          ))}
        </div>
      )}

      {!data && <div className="empty-state">loading…</div>}
      {data && data.nodes.length === 0 && <div className="empty-state">No collaborations recorded yet.</div>}
      {data && data.nodes.length > 0 && (
        <div className="collab-layout">
          <svg viewBox={`0 0 ${W} ${H}`} className="collab-map" role="img" aria-label="Map of artist collaborations"
            onClick={() => setSelected(null)}>
            {data.edges.map((e) => {
              const p = pos[e.a], q = pos[e.b];
              if (!p || !q) return null;
              const on = selected && (e.a === selected || e.b === selected);
              return (
                <line key={e.a + e.b} x1={p.x} y1={p.y} x2={q.x} y2={q.y}
                  className={`collab-edge ${on ? "on" : selected ? "dim" : ""}`}
                  strokeWidth={Math.min(1 + e.songs * 0.6, 6)} />
              );
            })}
            {data.nodes.map((n) => {
              const p = pos[n.key];
              const on = n.key === selected;
              const near = neighbours.has(n.key);
              const dim = selected && !on && !near;
              const r = radius(n);
              return (
                <g key={n.key} transform={`translate(${p.x},${p.y})`} className={`collab-node ${dim ? "dim" : ""}`}
                  onClick={(ev) => { ev.stopPropagation(); setSelected(n.key); }} style={{ cursor: "pointer" }}>
                  <title>{`${n.name}: ${n.degree} collaborator${n.degree === 1 ? "" : "s"}`}</title>
                  <circle r={r} className={`${n.artist_id ? "has-page" : "guest"} ${on ? "on" : ""}`} />
                  {(n.degree >= 2 || on || near || !!n.artist_id) && (
                    <text y={r + 13} textAnchor="middle" className="collab-label">{n.name}</text>
                  )}
                </g>
              );
            })}
          </svg>

          <div className="collab-side">
            {!sel && <div className="comment-meta">Tap a circle to see who they&apos;ve worked with.</div>}
            {sel && (
              <>
                <div className="review-row-title" style={{ fontSize: "1.05rem" }}>
                  {sel.artist_id ? <Link href={`/artist/${sel.artist_id}`}>{sel.name}</Link> : sel.name}
                </div>
                <div className="comment-meta" style={{ marginBottom: 10 }}>
                  {sel.degree} collaborator{sel.degree === 1 ? "" : "s"} · {sel.songs} song{sel.songs === 1 ? "" : "s"}
                  {sel.artist_id && focus !== sel.artist_id && (
                    <> · <button className="text-link" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit" }}
                      onClick={() => router.replace(`/collabs?artist=${sel.artist_id}`)}>focus</button></>
                  )}
                </div>
                {links.map((e) => {
                  const other = byKey[e.a === sel.key ? e.b : e.a];
                  if (!other) return null;
                  return (
                    <div key={e.a + e.b} className="collab-link">
                      <button className="text-link" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--bone)" }}
                        onClick={() => setSelected(other.key)}>{other.name}</button>
                      <span className="comment-meta"> · {e.songs} song{e.songs === 1 ? "" : "s"}</span>
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
