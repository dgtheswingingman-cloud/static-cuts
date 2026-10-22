"use client";

// Settings: "collect → Liked Songs". Connected per browser.

import { useEffect, useState } from "react";
import { connectLikes, disconnectLikes, likesConnected } from "@/lib/spotifyLikes";
import { SPOTIFY_CLIENT_ID } from "@/lib/spotifyExport";

export default function SpotifySync() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { setOn(likesConnected()); }, []);
  return (
    <>
      <div className="section-label" id="spotify-sync" style={{ scrollMarginTop: 20 }}>Collect → Spotify Liked Songs</div>
      <div className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", maxWidth: 680, marginBottom: 24 }}>
        <div style={{ minWidth: 0 }}>
          <div className="review-row-title">Save songs I collect to my Liked Songs</div>
          <div className="review-row-meta">
            <span>
              When you collect a song that&apos;s on Spotify, it&apos;s added to your Liked Songs too. Un-collecting
              doesn&apos;t remove it. Connected on this device only. Invited testers only for now.
            </span>
          </div>
        </div>
        {on !== null && (
          <button className={`tab ${on ? "active" : ""}`} disabled={!SPOTIFY_CLIENT_ID}
            title={SPOTIFY_CLIENT_ID ? undefined : "Spotify isn't switched on for the site yet"}
            onClick={() => { if (on) { disconnectLikes(); setOn(false); } else connectLikes(); }}>
            {on ? "on" : "off"}
          </button>
        )}
      </div>
    </>
  );
}
