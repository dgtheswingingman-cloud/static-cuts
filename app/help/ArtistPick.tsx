"use client";

// Help Wanted: narrow every job to one artist you know. Type a name, pick
// from the matches; ✕ goes back to all artists.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type PickedArtist = { id: string; name: string };

export default function ArtistPick({ value, onChange }: { value: PickedArtist | null; onChange: (a: PickedArtist | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedArtist[]>([]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      supabase.from("artists").select("id, name").ilike("name", `%${term.replace(/[%_]/g, "")}%`).order("name").limit(8)
        .then(({ data }) => {
          const rows = (data ?? []) as PickedArtist[];
          // Exact and starts-with matches first, so "Ye" finds Ye before "Yeat".
          const low = term.toLowerCase();
          const rank = (n: string) => (n.toLowerCase() === low ? 0 : n.toLowerCase().startsWith(low) ? 1 : 2);
          setResults(rows.sort((a, b) => rank(a.name) - rank(b.name)));
        });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (value) return (
    <div className="hw-artist-pick on">
      <span>Jobs for <b>{value.name}</b></span>
      <button className="hw-artist-clear" onClick={() => onChange(null)} aria-label="Show all artists">✕ all artists</button>
    </div>
  );

  return (
    <div className="hw-artist-pick">
      <input className="st-input" placeholder="Pick an artist you know…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find an artist" />
      {results.length > 0 && (
        <div className="hw-artist-results" role="listbox">
          {results.map((a) => (
            <button key={a.id} role="option" aria-selected={false} onClick={() => { onChange(a); setQ(""); setResults([]); }}>{a.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}
