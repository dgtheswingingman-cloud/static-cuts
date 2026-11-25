"use client";

// Help Wanted's fill-in boxes, right on each row. Admins (in admin mode) save
// straight to the song; everyone else sends a suggestion that a moderator
// checks. Either way the row says it's done and the list moves on.

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import AlbumAutocomplete from "../components/AlbumAutocomplete";
import DateDropdownPicker from "../components/DateDropdownPicker";

// "admin": goes straight on. Otherwise the signed-in user's id, for the suggestion.
type Who = "admin" | { userId: string };

// Released song missing a release date and/or album: a box for each missing one.
export function InfoFill({ who, trackId, artistId, missing, onDone }: {
  who: Who; trackId: string; artistId: string; missing: string[]; onDone: (msg: string) => void;
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
    const { error: err } = who === "admin"
      ? await supabase.rpc("admin_help_fill", { p_track_id: trackId, p_release_date: date || null, p_album: album.trim() || null })
      // Only the fields filled in go in the suggestion, so approving it
      // changes just those (see approve_submission).
      : await supabase.from("submissions").insert({
          type: "correction", artist_id: artistId, submitted_by: who.userId,
          payload: { track_id: trackId, ...(date ? { release_date: date } : {}), ...(album.trim() ? { album: album.trim() } : {}), via: "help_wanted" },
        });
    setBusy(false);
    if (err) { setError(err.message); return; }
    const what = [date && "date", album.trim() && "album"].filter(Boolean).join(" and ");
    onDone(who === "admin" ? `${what} saved` : `${what} sent for review. Thanks!`);
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
      <button className="ms-say hw-act" disabled={busy || (!date && !album.trim())} onClick={save}>
        {busy ? "Saving…" : who === "admin" ? "Save//" : "Send//"}
      </button>
      {error && <span className="sb-error">{error}</span>}
    </div>
  );
}

// Leak or snippet missing a leak date and/or era: a box for each missing one.
// Suggestions go in as a correction a moderator checks (approve_submission).
export function LeakFill({ who, trackId, artistId, missing, onDone }: {
  who: Who; trackId: string; artistId: string; missing: string[]; onDone: (msg: string) => void;
}) {
  const [date, setDate] = useState("");
  const [era, setEra] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needDate = missing.includes("leak date");
  const needEra = missing.includes("era");

  async function save() {
    if (!date && !era.trim()) return;
    setBusy(true); setError(null);
    const { error: err } = who === "admin"
      ? await supabase.rpc("admin_help_leak", { p_track_id: trackId, p_leak_date: date || null, p_album: era.trim() || null })
      : await supabase.from("submissions").insert({
          type: "correction", artist_id: artistId, submitted_by: who.userId,
          payload: { track_id: trackId, ...(date ? { leak_date: date } : {}), ...(era.trim() ? { album: era.trim() } : {}), via: "help_wanted" },
        });
    setBusy(false);
    if (err) { setError(err.message); return; }
    const what = [date && "leak date", era.trim() && "era"].filter(Boolean).join(" and ");
    onDone(who === "admin" ? `${what} saved` : `${what} sent for review. Thanks!`);
  }

  return (
    <div className="hw-fill">
      {needDate && (
        <label className="hw-fill-field"><small>Leak date</small>
          <DateDropdownPicker value={date} onChange={setDate} idPrefix={`lf-date-${trackId}`} />
        </label>
      )}
      {needEra && (
        <label className="hw-fill-field"><small>Era</small>
          <AlbumAutocomplete value={era} onChange={setEra} artistId={artistId} idPrefix={`lf-era-${trackId}`} />
        </label>
      )}
      <button className="ms-say hw-act" disabled={busy || (!date && !era.trim())} onClick={save}>
        {busy ? "Saving…" : who === "admin" ? "Save//" : "Send//"}
      </button>
      {error && <span className="sb-error">{error}</span>}
    </div>
  );
}

// Leak or snippet with no artwork: paste the picture's link. Suggestions also
// need the page it was found on, so a moderator can check it.
export function CoverFill({ who, trackId, onDone }: { who: Who; trackId: string; onDone: (msg: string) => void }) {
  const [url, setUrl] = useState("");
  const [page, setPage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = who === "admin";
  const ready = url.trim() && (admin || page.trim());

  async function save() {
    if (!ready) return;
    setBusy(true); setError(null);
    const { data, error: err } = admin
      ? await supabase.rpc("admin_help_cover", { p_track_id: trackId, p_image_url: url.trim() })
      : await supabase.rpc("rpc_suggest_cover", { p: { track_id: trackId, image_url: url.trim(), source_url: page.trim(), notes: "From Help Wanted" } });
    setBusy(false);
    if (err) { setError(err.message); return; }
    const result = admin ? data : (data as { result?: string } | null)?.result;
    onDone(result === "has_cover" ? "already has a cover"
      : result === "duplicate" ? "someone already sent that one"
      : admin ? "cover added, shows in a couple of minutes" : "cover sent for review. Thanks!");
  }

  return (
    <div className="hw-fill">
      <label className="hw-fill-field hw-fill-wide"><small>Link to the picture</small>
        <input className="st-input" inputMode="url" placeholder="https://…/cover.jpg" value={url}
          onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
      </label>
      {!admin && (
        <label className="hw-fill-field hw-fill-wide"><small>Page you found it on</small>
          <input className="st-input" inputMode="url" placeholder="https://…" value={page}
            onChange={(e) => setPage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        </label>
      )}
      <button className="ms-say hw-act" disabled={busy || !ready} onClick={save}>{busy ? "Sending…" : admin ? "Add//" : "Send//"}</button>
      {error && <span className="sb-error">{error}</span>}
    </div>
  );
}
