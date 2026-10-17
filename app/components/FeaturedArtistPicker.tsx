"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Tag picker for featured artists: search existing artists by name, pick
// them as removable tags, or create a new artist when nothing matches.
// Used by the artist page's add-track and edit-track forms.

export type ArtistTag = { id: string; name: string };

export default function FeaturedArtistPicker({
  tags,
  onChange,
  excludeIds = [],
  placeholder = "Search artists to add…",
}: {
  tags: ArtistTag[];
  onChange: (tags: ArtistTag[]) => void;
  // Artists that can't be featured here (e.g. the page's own artist, or the
  // track's main artist).
  excludeIds?: (string | null | undefined)[];
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ArtistTag[]>([]);
  const excluded = excludeIds.filter(Boolean).join(",");

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setResults([]); return; }
    const skip = new Set([...excluded.split(",").filter(Boolean), ...tags.map((t) => t.id)]);
    const handle = setTimeout(async () => {
      const { data } = await supabase.from("artists").select("id, name").ilike("name", `%${q}%`).limit(12);
      setResults((data ?? []).filter((a) => !skip.has(a.id)).slice(0, 8));
    }, 300);
    return () => clearTimeout(handle);
  }, [search, excluded, tags]);

  function add(a: ArtistTag) {
    onChange([...tags, a]);
    setSearch("");
    setResults([]);
  }

  function remove(artistId: string) {
    onChange(tags.filter((a) => a.id !== artistId));
  }

  async function createAndAdd() {
    const name = search.trim();
    if (!name) return;
    const { data: newId, error: err } = await supabase.rpc("admin_create_artist", { p_name: name });
    if (err || !newId) { alert(err?.message ?? "Couldn't create artist."); return; }
    add({ id: newId as string, name });
  }

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        {tags.map((a) => (
          <span key={a.id} className="feature-tag" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {a.name}
            <span style={{ cursor: "pointer", opacity: 0.7 }} onClick={() => remove(a.id)}>✕</span>
          </span>
        ))}
      </div>
      <div style={{ position: "relative" }}>
        <input
          className="search-input"
          style={{ width: "100%" }}
          placeholder={placeholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search.trim().length >= 2 && (
          <div className="autosuggest-dropdown" style={{ position: "absolute", zIndex: 5, width: "100%", maxHeight: 180, overflowY: "auto", padding: "6px 4px" }}>
            {results.map((a) => (
              <div key={a.id} className="comment-item" style={{ cursor: "pointer", padding: "8px 6px" }} onClick={() => add(a)}>
                <span className="comment-body" style={{ fontSize: "0.82rem" }}>{a.name}</span>
              </div>
            ))}
            {results.length === 0 && (
              <div className="comment-item" style={{ cursor: "pointer", padding: "8px 6px" }} onClick={createAndAdd}>
                <span className="comment-body" style={{ fontSize: "0.82rem" }}>+ create artist &quot;{search.trim()}&quot;</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
