"use client";

// Settings: "collect → Liked Songs". Connected per browser.

import { useEffect, useState } from "react";
import { connectLikes, disconnectLikes, likesConnected } from "@/lib/spotifyLikes";
import { SPOTIFY_CLIENT_ID } from "@/lib/spotifyExport";
import Switch from "./Switch";

export default function SpotifySync() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { setOn(likesConnected()); }, []);
  return (
    <div className="st-conn" id="spotify-sync">
      <span className="st-logo st-spotify" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="30" height="30"><circle cx="12" cy="12" r="12" fill="#1DB954" /><path d="M6.5 9.3c3.6-1.1 7.8-.8 11 1M7.2 12.3c3-.9 6.4-.6 9 .9M7.8 15.1c2.4-.6 5-.4 7 .8" stroke="#070707" strokeWidth="1.6" strokeLinecap="round" fill="none" /></svg>
      </span>
      <span className="st-conn-text">
        <strong>Spotify</strong>
        <span>{on ? "Connected on this device" : "Not connected on this device"}</span>
      </span>
      {on && <span className="st-ok">Connected ✓</span>}
      <div className="st-sub">
        <span className="st-row-text">
          <span>Collect → add to Liked Songs</span>
          <small>When you collect a song that&apos;s on Spotify it&apos;s added to your Liked Songs too. Invited testers only for now.</small>
        </span>
        {on !== null && (
          <Switch on={on} label="Collect adds to Liked Songs" disabled={!SPOTIFY_CLIENT_ID}
            onChange={() => { if (on) { disconnectLikes(); setOn(false); } else connectLikes(); }} />
        )}
      </div>
    </div>
  );
}
