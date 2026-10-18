"use client";

// "Export to Spotify" button: makes a private playlist of the songs that
// have Spotify links (unreleased songs can't go on Spotify).

import { useState } from "react";
import { SPOTIFY_CLIENT_ID, startSpotifyExport, trackUri } from "@/lib/spotifyExport";

export default function ExportToSpotify({ name, description, urls, back }: {
  name: string; description: string; urls: (string | null | undefined)[]; back: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const uris = urls.map(trackUri).filter((u): u is string => !!u);

  function go() {
    if (!SPOTIFY_CLIENT_ID) { setNote("Spotify export isn't switched on yet."); return; }
    if (uris.length === 0) { setNote("None of these songs have a Spotify link yet."); return; }
    startSpotifyExport({ name, description, uris, back });
  }

  return (
    <>
      <button className="tab" onClick={go} title={`${uris.length} of ${urls.length} songs are on Spotify`}>
        export to Spotify ({uris.length})
      </button>
      {note && <span className="comment-meta" style={{ alignSelf: "center" }}>{note}</span>}
    </>
  );
}
