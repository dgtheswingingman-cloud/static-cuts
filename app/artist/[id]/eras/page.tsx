"use client";

// /artist/[id]/eras: the Eras view on its own page (old links and shares).
// The artist page has the same thing as its Eras tab.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Song } from "@/lib/eras";
import ArtistEras from "../ArtistEras";

export default function ErasPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [artist, setArtist] = useState<{ id: string; name: string } | null>(null);
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("rpc_artist_eras", { p_artist: id }).then(({ data }) => {
      const d = data as { artist: { id: string; name: string } | null; songs: Song[] } | null;
      setArtist(d?.artist ?? null);
      setSongs(d?.songs ?? []);
    });
    if (window.location.hash) setFocus(decodeURIComponent(window.location.hash.slice(1)));
  }, [id]);

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push(`/artist/${id}`)}>← {artist?.name ?? "artist"}</button>
      <h1 className="detail-name page-title">{artist ? `${artist.name}: eras` : "Eras"}</h1>
      <ArtistEras songs={songs} focus={focus} />
    </div>
  );
}
