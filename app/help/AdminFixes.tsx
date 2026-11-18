"use client";

// Help Wanted in admin mode: fill the gap on the spot instead of suggesting
// it. Each box saves straight to the song and tells the list it's done.

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import AlbumAutocomplete from "../components/AlbumAutocomplete";
import DateDropdownPicker from "../components/DateDropdownPicker";

// Released song missing a release date and/or album: a box for each missing one.
export function AdminInfoFill({ trackId, artistId, missing, onDone }: {
  trackId: string; artistId: string; missing: string[]; onDone: (msg: string) => void;
}) {
  const [date, setDate] = useState("");
  const [album, setAlbum] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needDate = missing.includes("release date");
  const needAlbum = missing.includes("album");

  async function save() {
    if (!date && !album.trim()) return;
    setBusy(true); setError(null);
    const { error: err } = await supabase.rpc("admin_help_fill", {
      p_track_id: trackId, p_release_date: date || null, p_album: album.trim() || null,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onDone([date && "date", album.trim() && "album"].filter(Boolean).join(" and ") + " saved");
  }

  return (
    <div className="hw-fill">
      {needDate && (
        <label className="hw-fill-field"><small>Release date</small>
          <DateDropdownPicker value={date} onChange={setDate} idPrefix={`hf-date-${trackId}`} />
        </label>
      )}
      {needAlbum && (
        <label className="hw-fill-field"><small>Album</small>
          <AlbumAutocomplete value={album} onChange={setAlbum} artistId={artistId} idPrefix={`hf-album-${trackId}`} />
        </label>
      )}
      <button className="ms-say hw-act" disabled={busy || (!date && !album.trim())} onClick={save}>{busy ? "Saving…" : "Save//"}</button>
      {error && <span className="sb-error">{error}</span>}
    </div>
  );
}

// Leak or snippet with no artwork: paste the picture's link.
export function AdminCoverFill({ trackId, onDone }: { trackId: string; onDone: (msg: string) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!url.trim()) return;
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.rpc("admin_help_cover", { p_track_id: trackId, p_image_url: url.trim() });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onDone(data === "has_cover" ? "already has a cover" : "cover added, shows in a couple of minutes");
  }

  return (
    <div className="hw-fill">
      <label className="hw-fill-field hw-fill-wide"><small>Link to the picture</small>
        <input className="st-input" inputMode="url" placeholder="https://…/cover.jpg" value={url}
          onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
      </label>
      <button className="ms-say hw-act" disabled={busy || !url.trim()} onClick={save}>{busy ? "Adding…" : "Add//"}</button>
      {error && <span className="sb-error">{error}</span>}
    </div>
  );
}
