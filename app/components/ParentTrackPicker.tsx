"use client";

import { useState } from "react";

// Search box for choosing which main track something is a sub-version of.
// Clearing the box makes it a main track again. Used by the artist page's
// add-track and edit-track forms.

export default function ParentTrackPicker({
  tracks,
  value,
  onChange,
  excludeId,
  maxHeight = 220,
}: {
  tracks: { id: string; title: string }[];
  value: string;
  onChange: (parentTrackId: string) => void;
  // The track being edited, which can't be its own parent.
  excludeId?: string;
  maxHeight?: number;
}) {
  const [search, setSearch] = useState(() => tracks.find((t) => t.id === value)?.title ?? "");
  const [open, setOpen] = useState(false);

  const q = search.trim().toLowerCase();
  const matches = q
    ? tracks.filter((t) => t.id !== excludeId && t.title.toLowerCase().includes(q)).slice(0, 8)
    : [];

  return (
    <div style={{ position: "relative" }}>
      <input
        className="search-input"
        style={{ width: "100%", marginBottom: 4 }}
        placeholder="Type to search main tracks…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
          if (!e.target.value) onChange("");
        }}
        onFocus={() => setOpen(true)}
      />
      {open && q.length > 0 && (
        <div className="autosuggest-dropdown" style={{ position: "absolute", zIndex: 5, width: "100%", maxHeight, overflowY: "auto", padding: "6px 4px" }}>
          {matches.map((t) => (
            <div
              key={t.id}
              className="comment-item"
              style={{ cursor: "pointer", padding: "8px 6px" }}
              onClick={() => {
                onChange(t.id);
                setSearch(t.title);
                setOpen(false);
              }}
            >
              <span className="comment-body" style={{ fontSize: "0.82rem" }}>{t.title}</span>
            </div>
          ))}
          {matches.length === 0 && <div className="comments-count">No matches.</div>}
        </div>
      )}
    </div>
  );
}
