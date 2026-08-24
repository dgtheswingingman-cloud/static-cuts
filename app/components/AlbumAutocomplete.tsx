"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Autocomplete for the Album field -- suggests album names already used
// by this same artist, so "Whole Lotta Red" doesn't end up spelled three
// different ways across different tracks. Still a free-text input, not a
// strict picker -- typing a genuinely new album name works fine too.

export default function AlbumAutocomplete({
  value,
  onChange,
  artistId,
  idPrefix,
}: {
  value: string;
  onChange: (value: string) => void;
  artistId: string | null;
  idPrefix: string;
}) {
  const [results, setResults] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = value.trim();
    if (!artistId || q.length < 1) { setResults([]); return; }
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from("tracks")
        .select("album")
        .eq("artist_id", artistId)
        .not("album", "is", null)
        .ilike("album", `%${q}%`)
        .limit(30);
      const unique = Array.from(new Set((data ?? []).map((r: any) => r.album as string).filter(Boolean)));
      setResults(unique.slice(0, 8));
    }, 250);
    return () => clearTimeout(handle);
  }, [value, artistId]);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        className="search-input"
        style={{ width: "100%" }}
        id={`${idPrefix}-album`}
        name={`${idPrefix}-album`}
        aria-label="Album"
        placeholder="Album"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && value.trim().length >= 1 && results.length > 0 && (
        <div className="autosuggest-dropdown" style={{ position: "absolute", zIndex: 5, width: "100%", maxHeight: 180, overflowY: "auto", padding: "6px 4px" }}>
          {results.map((album) => (
            <div
              key={album}
              className="comment-item"
              style={{ cursor: "pointer", padding: "8px 6px" }}
              onMouseDown={() => { onChange(album); setOpen(false); }}
            >
              <span className="comment-body" style={{ fontSize: "0.82rem" }}>{album}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
