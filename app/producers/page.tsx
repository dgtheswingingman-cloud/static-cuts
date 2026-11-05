"use client";

// Producers: everyone credited with producing songs in the archive. The top
// ten get cards with their photo (if they're an artist here too) or the
// artist they've made the most songs for.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Row = { name: string; songs: number; artists: number };
type Mode = "popular" | "az";
const LETTERS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const first = (t: string) => (/^[a-z]/i.test(t) ? t[0].toUpperCase() : "#");
const n0 = (x: number) => x.toLocaleString("en-GB");

export default function ProducersPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [all, setAll] = useState<Row[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Mode>("popular");
  const [letter, setLetter] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "rows">("grid");
  const [shown, setShown] = useState(140);

  // Search as you type (the server matches names); the full list loads once.
  useEffect(() => {
    const t = setTimeout(() => {
      supabase.rpc("rpc_producers", { p_query: q.trim() || null, p_limit: q.trim() ? 300 : 2000 }).then(({ data }) => {
        const r = (data as Row[]) ?? [];
        setRows(r);
        if (!q.trim()) setAll(r);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // A photo for each top-ten card: the artist they've produced most for.
  useEffect(() => {
    const top = all.slice(0, 10);
    if (!top.length) return;
    // Producers who are artists too get their own photo; the rest get the
    // artist they've produced most for.
    const own = supabase.rpc("rpc_producer_photos", { p_names: top.map((p) => p.name) }).then(({ data }) => (data as Record<string, string>) ?? {});
    Promise.all(top.map((p) => supabase.rpc("rpc_producer", { p_name: p.name }).then(({ data }) => {
      const counts = new Map<string, number>();
      for (const s of (data as { artist_id: string }[]) ?? []) counts.set(s.artist_id, (counts.get(s.artist_id) ?? 0) + 1);
      return [p.name, [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null] as const;
    }))).then(async (pairs) => {
      const ids = pairs.map(([, id]) => id).filter(Boolean) as string[];
      const { data } = await supabase.from("artists").select("id, image_url").in("id", ids);
      const img = new Map(((data ?? []) as { id: string; image_url: string | null }[]).map((a) => [a.id, a.image_url]));
      const m: Record<string, string> = {};
      for (const [name, id] of pairs) { const u = id ? img.get(id) : null; if (u) m[name] = u; }
      setPhotos({ ...m, ...(await own) });
    });
  }, [all]);

  const top = all.slice(0, 10);
  const list = useMemo(() => {
    let l = (rows ?? []).filter((r) => !letter || first(r.name) === letter);
    if (mode === "az") l = [...l].sort((a, b) => a.name.localeCompare(b.name));
    return l;
  }, [rows, mode, letter]);

  return (
    <div className="wrap gn-page">
      <header className="gn-head">
        <h1 className="ls-title gn-title">PRODUCERS<span>//</span></h1>
        <div className="gn-lead">
          <strong>Browse the archive by producer.</strong>
          <span>Everyone credited with the beats{all.length ? `, ${n0(all.length)} producers` : ""}. Credits fill in over time from Genius and community sheets.</span>
        </div>
      </header>

      <div className="sr-box gn-search">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input placeholder="Find a producer… (e.g. “F1LTHY”, “Pierre Bourne”)" value={q} onChange={(e) => { setQ(e.target.value); setShown(140); }} aria-label="Find a producer" />
        {q && <button aria-label="Clear" onClick={() => setQ("")}>✕</button>}
      </div>

      <div className="gn-az pr-bar">
        <nav className="rd-chips gn-modes" aria-label="Order">
          {([["popular", "Popular"], ["az", "A–Z"]] as [Mode, string][]).map(([k, label]) => (
            <button key={k} className={mode === k ? "on" : undefined} aria-pressed={mode === k} onClick={() => setMode(k)}>{label}</button>
          ))}
        </nav>
        <span className="gn-az-label">Browse A–Z <em>//</em></span>
        <div className="gn-letters">
          {LETTERS.map((l) => (
            <button key={l} className={letter === l ? "on" : undefined} aria-pressed={letter === l} onClick={() => { setLetter(letter === l ? null : l); setShown(140); }}>{l}</button>
          ))}
        </div>
      </div>

      {!q && !letter && mode === "popular" && top.length > 0 && (
        <>
          <div className="gn-sec"><h2><em>///</em> Top producers</h2><span>The most credited producers in the archive.</span></div>
          <div className="gn-top">
            {top.map((p, i) => (
              <Link key={p.name} href={`/producer/${encodeURIComponent(p.name)}`} className={`gn-card ${i === 0 ? "first" : ""}`}
                style={photos[p.name] ? ({ "--gn-img": `url("${photos[p.name]}")` } as CSSProperties) : undefined}>
                <span className="gn-rank">#{i + 1}</span>
                <span className="gn-card-name">{p.name}</span>
                <span className="gn-card-n">{n0(p.songs)} songs · {n0(p.artists)} artists</span>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="gn-sec">
        <h2><em>///</em> {letter ? `Producers: ${letter}` : q ? "Results" : "All producers"}</h2>
        <span>{rows ? `${n0(list.length)} producer${list.length === 1 ? "" : "s"}` : ""}</span>
        <div className="gn-views">
          <button className={view === "grid" ? "on" : undefined} aria-label="Grid" aria-pressed={view === "grid"} onClick={() => setView("grid")}>▦</button>
          <button className={view === "rows" ? "on" : undefined} aria-label="List" aria-pressed={view === "rows"} onClick={() => setView("rows")}>☰</button>
        </div>
      </div>
      {!rows && <div className="empty-state">loading…</div>}
      {rows && list.length === 0 && <div className="empty-state">{q ? "No producer by that name yet." : "No producer credits yet."}</div>}
      <div className={view === "grid" ? "gn-pills" : "gn-rows"}>
        {list.slice(0, shown).map((r, i) => (
          <Link key={r.name} href={`/producer/${encodeURIComponent(r.name)}`} className={`gn-pill ${i === 0 && mode === "popular" && !q && !letter ? "first" : ""}`}
            title={`${n0(r.songs)} songs · ${n0(r.artists)} artists`}>
            <span>{r.name}</span>
            <em>{n0(r.songs)}</em>
          </Link>
        ))}
      </div>
      {list.length > shown && (
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <button className="tab" onClick={() => setShown(shown + 280)}>Show more ({n0(list.length - shown)})</button>
        </div>
      )}
    </div>
  );
}
