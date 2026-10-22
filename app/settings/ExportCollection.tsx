"use client";

// Settings: export everything you've collected to a Spotify playlist.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import ExportToSpotify from "../ExportToSpotify";

export default function ExportCollection({ userId }: { userId: string }) {
  const [urls, setUrls] = useState<(string | null)[] | null>(null);
  useEffect(() => {
    supabase.from("track_ownership").select("tracks(spotify_url)").eq("user_id", userId).limit(5000)
      .then(({ data }) => {
        // The joined song can come back as an object or a one-item list.
        const rows = (data ?? []) as unknown as { tracks: { spotify_url: string | null } | { spotify_url: string | null }[] | null }[];
        setUrls(rows.map((r) => (Array.isArray(r.tracks) ? r.tracks[0]?.spotify_url : r.tracks?.spotify_url) ?? null));
      });
  }, [userId]);
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 24 }}>
      {urls && urls.length === 0 && <span className="comment-meta">Nothing collected yet.</span>}
      {urls && urls.length > 0 && <>
      <ExportToSpotify name="My Static Cuts collection" back="/settings#export"
        description="Everything I've collected on Static Cuts// that's on Spotify." urls={urls} /></>}
    </div>
  );
}
