// A page for one song: /song/<id>. The page itself is loaded in the browser
// (it shows the viewer's own rating and collection), but the title and
// link preview are filled in here so shared links look right.

import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";
import SongView from "./SongView";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { data } = await supabase.rpc("rpc_song_page", { p_id: id });
  const song = data as {
    track?: { title: string; release_status: string | null; album: string | null; cover_url?: string | null };
    artist?: { name: string };
  } | null;
  if (!song?.track) return { title: "Song not found · Static Cuts//" };
  const title = `${song.track.title} — ${song.artist?.name ?? "Unknown"} · Static Cuts//`;
  const bits = [song.track.release_status, song.track.album].filter(Boolean).join(" · ");
  const description = `${song.track.title} by ${song.artist?.name ?? "unknown"}${bits ? ` (${bits})` : ""}. Versions, status history and comments on Static Cuts//.`;
  const images = song.track.cover_url ? [{ url: song.track.cover_url }] : undefined;
  return {
    title,
    description,
    alternates: { canonical: `/song/${id}` },
    openGraph: { title, description, type: "music.song", images },
    twitter: { card: images ? "summary_large_image" : "summary", title, description, images: images?.map((i) => i.url) },
  };
}

export default async function SongPage({ params }: Props) {
  const { id } = await params;
  return <SongView id={id} />;
}
