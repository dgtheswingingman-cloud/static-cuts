"use client";

// Admin-only: which Spotify, Genius and Last.fm profile belongs to this
// artist. Imports use these so they pull songs from the right artist when
// names clash. Paste profile links; they're turned into IDs on save.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Profiles = {
  spotify_artist_id: string | null;
  genius_artist_id: string | null;
  lastfm_name: string | null;
};

function searchLinks(name: string) {
  const q = encodeURIComponent(name);
  return {
    spotify: `https://open.spotify.com/search/${q}/artists`,
    genius: `https://genius.com/search?q=${q}`,
    lastfm: `https://www.last.fm/search/artists?q=${q}`,
  };
}

// The "profiles" button lives in the artist page's admin row; this renders
// the panel when it's open. linkedCount reports how many are linked (0-3).
export default function ArtistProfiles({
  artistId,
  artistName,
  open,
  onLinkedCount,
}: {
  artistId: string;
  artistName: string;
  open: boolean;
  onLinkedCount?: (n: number) => void;
}) {
  const [saved, setSaved] = useState<Profiles | null>(null);
  const [spotify, setSpotify] = useState("");
  const [genius, setGenius] = useState("");
  const [lastfm, setLastfm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("artists")
      .select("spotify_artist_id, genius_artist_id, lastfm_name")
      .eq("id", artistId)
      .single();
    const p = (data as Profiles) ?? { spotify_artist_id: null, genius_artist_id: null, lastfm_name: null };
    setSaved(p);
    setSpotify(p.spotify_artist_id ? `https://open.spotify.com/artist/${p.spotify_artist_id}` : "");
    setGenius(p.genius_artist_id ?? "");
    setLastfm(p.lastfm_name ?? "");
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistId]);

  async function save() {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.rpc("admin_set_artist_profiles", {
      p_artist_id: artistId,
      p_spotify: spotify,
      p_genius: genius,
      p_lastfm: lastfm,
    });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setMessage("Saved.");
    load();
  }

  const linked = saved ? [saved.spotify_artist_id && "Spotify", saved.genius_artist_id && "Genius", saved.lastfm_name && "Last.fm"].filter(Boolean) : [];
  const find = searchLinks(artistName);

  useEffect(() => {
    onLinkedCount?.(linked.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked.length]);

  if (!open) return null;

  return (
    <>
      {(
        <div className="comments-panel" style={{ maxWidth: 480, marginBottom: 20 }}>
          <div className="comment-meta" style={{ marginBottom: 10 }}>
            Link this artist to their profiles so imports pull songs from the right artist. Paste the profile
            link from each site (use &quot;find&quot; to search for it). Leave a box empty to unlink.
          </div>
          {([
            ["Spotify", spotify, setSpotify, find.spotify, "https://open.spotify.com/artist/…"],
            ["Genius", genius, setGenius, find.genius, "https://genius.com/artists/…"],
            ["Last.fm", lastfm, setLastfm, find.lastfm, "https://www.last.fm/music/…"],
          ] as const).map(([label, value, set, findUrl, placeholder]) => (
            <div key={label} style={{ marginBottom: 8 }}>
              <div className="section-label" style={{ display: "flex", gap: 8 }}>
                {label}
                <a href={findUrl} target="_blank" rel="noopener noreferrer" className="listen-link" style={{ fontSize: "0.65rem" }}>
                  find ↗
                </a>
              </div>
              <input
                className="search-input"
                style={{ width: "100%" }}
                placeholder={placeholder}
                value={value}
                onChange={(e) => set(e.target.value)}
              />
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="tab active" disabled={busy} onClick={save}>{busy ? "saving…" : "save"}</button>
            {message && <span className="comment-meta">{message}</span>}
          </div>
        </div>
      )}
    </>
  );
}
