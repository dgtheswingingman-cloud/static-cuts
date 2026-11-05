// An official album or EP: /album/<Deezer album id>. Loaded in the browser
// (it shows the viewer's own ratings); the title and link preview are set here.

import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";
import AlbumView from "./AlbumView";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { data } = await supabase.rpc("rpc_album", { p_album: id });
  const a = data as { title: string; kind: string; date: string | null; artist: { name: string }; songs: number | null; cover: string | null } | null;
  if (!a) return { title: "Album not found · Static Cuts//" };
  const title = `${a.title} — ${a.artist.name} (${a.kind === "ep" ? "EP" : "album"}) · Static Cuts//`;
  const description = `${a.title} by ${a.artist.name}${a.date ? `, ${a.date.slice(0, 4)}` : ""}${a.songs ? `, ${a.songs} songs` : ""}. Full tracklist, ratings and every version, on Static Cuts//.`;
  return {
    title, description,
    alternates: { canonical: `/album/${id}` },
    openGraph: { title, description, type: "music.album", images: a.cover ? [a.cover] : undefined },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function AlbumPage({ params }: Props) {
  const { id } = await params;
  return <AlbumView id={id} />;
}
