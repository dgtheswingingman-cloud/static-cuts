"use client";

// Every genre in the archive. Genres come from Last.fm's tags for each artist
// plus the tags people add and vote on artist pages. The top ten get cards
// with a photo of their most-followed artist.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Genre = { slug: string; tag: string; artists: number };
type Mode = "popular" | "az" | "niche";
const LETTERS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const first = (t: string) => (/^[a-z]/i.test(t) ? t[0].toUpperCase() : "#");

export default function GenresPage() {
  const [genres, setGenres] = useState<Genre[] | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("popular");
  const [letter, setLetter] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "rows">("grid");
  const [shown, setShown] = useState(120);

  useEffect(() => {
    supabase.rpc("rpc_genres").then(({ data }) => {
      const g = (data as Genre[]) ?? [];
      setGenres(g);
      const top = g.slice(0, 10).map((x) => x.slug);
      if (top.length) supabase.rpc("rpc_genre_photos", { p_slugs: top }).then(({ data: p }) => setPhotos((p as Record<string, string>) ?? {}));
    });
  }, []);

  const top = (genres ?? []).slice(0, 10);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let l = (genres ?? []).filter((g) => (!needle || g.tag.toLowerCase().includes(needle)) && (!letter || first(g.tag) === letter));
    if (mode === "az") l = [...l].sort((a, b) => a.tag.localeCompare(b.tag));
    if (mode === "niche") l = l.filter((g) => g.artists <= 5).sort((a, b) => b.artists - a.artists || a.tag.localeCompare(b.tag));
    return l;
  }, [genres, q, mode, letter]);

  return (
    <div className="wrap gn-page">
      <header className="gn-head">
        <h1 className="ls-title gn-title">GENRES<span>//</span></h1>
        <div className="gn-lead">
          <strong>Browse the archive by genre.</strong>
          <span>Every genre in the archive{genres ? `, ${genres.length.toLocaleString("en-GB")} of them` : ""}, from the big styles to underground micro-genres. They come from Last.fm and the tags people add on artist pages.</span>
        </div>
      </header>

      <div className="sr-box gn-search">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input placeholder="Find a genre… (e.g. “drill”, “lo-fi”, “ambient”)" value={q} onChange={(e) => { setQ(e.target.value); setShown(120); }} aria-label="Find a genre" />
        {q && <button aria-label="Clear" onClick={() => setQ("")}>✕</button>}
      </div>

      <nav className="rd-chips gn-modes" aria-label="Order">
        {([["popular", "Popular"], ["az", "A–Z"], ["niche", "Niche"]] as [Mode, string][]).map(([k, label]) => (
          <button key={k} className={mode === k ? "on" : undefined} aria-pressed={mode === k} onClick={() => { setMode(k); setShown(120); }}>{label}</button>
        ))}
      </nav>

      <div className="gn-az">
        <span className="gn-az-label">Browse A–Z <em>//</em></span>
        <div className="gn-letters">
          {LETTERS.map((l) => (
            <button key={l} className={letter === l ? "on" : undefined} aria-pressed={letter === l} onClick={() => { setLetter(letter === l ? null : l); setShown(120); }}>{l}</button>
          ))}
        </div>
      </div>

      {!q && !letter && mode === "popular" && top.length > 0 && (
        <>
          <div className="gn-sec"><h2><em>///</em> Top genres</h2><span>The biggest genres in the archive.</span></div>
          <div className="gn-top">
            {top.map((g, i) => (
              <Link key={g.slug} href={`/genre/${g.slug}`} className={`gn-card ${i === 0 ? "first" : ""}`}
                style={photos[g.slug] ? ({ "--gn-img": `url("${photos[g.slug]}")` } as CSSProperties) : undefined}>
                <span className="gn-rank">#{i + 1}</span>
                <span className="gn-card-name">{g.tag}</span>
                <span className="gn-card-n">{g.artists.toLocaleString("en-GB")} artists</span>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="gn-sec">
        <h2><em>///</em> {letter ? `Genres: ${letter}` : mode === "niche" ? "Niche genres" : "All genres"}</h2>
        <span>{genres ? `${list.length.toLocaleString("en-GB")} genre${list.length === 1 ? "" : "s"}` : ""}{mode === "niche" ? " with 5 artists or fewer" : ""}</span>
        <div className="gn-views">
          <button className={view === "grid" ? "on" : undefined} aria-label="Grid" aria-pressed={view === "grid"} onClick={() => setView("grid")}>▦</button>
          <button className={view === "rows" ? "on" : undefined} aria-label="List" aria-pressed={view === "rows"} onClick={() => setView("rows")}>☰</button>
        </div>
      </div>

      {genres === null && <div className="empty-state">loading genres…</div>}
      {genres && list.length === 0 && <div className="empty-state">No genres found.</div>}
      <div className={view === "grid" ? "gn-pills" : "gn-rows"}>
        {list.slice(0, shown).map((g, i) => (
          <Link key={g.slug} href={`/genre/${g.slug}`} className={`gn-pill ${i === 0 && mode === "popular" && !q && !letter ? "first" : ""}`}>
            <span>{g.tag}</span>
            <em>{g.artists.toLocaleString("en-GB")}</em>
          </Link>
        ))}
      </div>
      {list.length > shown && (
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <button className="tab" onClick={() => setShown(shown + 240)}>Show more ({(list.length - shown).toLocaleString("en-GB")})</button>
        </div>
      )}
    </div>
  );
}
