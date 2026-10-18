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
  const song = data as { track?: { title: string; release_status: string | null; album: string | null }; artist?: { name: string } } | null;
  if (!song?.track) return { title: "Song not found · Static Cuts//" };
  const title = `${song.track.title} — ${song.artist?.name ?? "Unknown"} · Static Cuts//`;
  const bits = [song.track.release_status, song.track.album].filter(Boolean).join(" · ");
  const description = `${song.track.title} by ${song.artist?.name ?? "unknown"}${bits ? ` (${bits})` : ""}. Versions, status history and comments on Static Cuts//.`;
  return { title, description, openGraph: { title, description, type: "music.song" } };
}

export default async function SongPage({ params }: Props) {
  const { id } = await params;
  return <SongView id={id} />;
}
