"use client";

// On your own profile: export everything you've collected to a Spotify playlist.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import ExportToSpotify from "../../ExportToSpotify";

export default function ExportCollection({ userId }: { userId: string }) {
  const [urls, setUrls] = useState<(string | null)[] | null>(null);
  useEffect(() => {
    supabase.from("track_ownership").select("tracks(spotify_url)").eq("user_id", userId).limit(5000)
      .then(({ data }) => setUrls(((data ?? []) as { tracks: { spotify_url: string | null } | null }[]).map((r) => r.tracks?.spotify_url ?? null)));
  }, [userId]);
  if (!urls || urls.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
      <ExportToSpotify name="My Static Cuts collection" back={`/profile/${userId}`}
        description="Everything I've collected on Static Cuts// that's on Spotify." urls={urls} />
    </div>
  );
}
