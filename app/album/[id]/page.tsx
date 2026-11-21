// An official album or EP: /album/<Deezer album id>. The full page loads in
// the browser (it shows the viewer's own ratings), but the server sends the
// album's facts and tracklist as plain text first, so search engines can read
// them; the browser's page replaces that text once it has loaded.

import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import AlbumView from "./AlbumView";

// Built on first visit, then kept for a day (see the song page).
export const revalidate = 86400;
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };
type Album = {
  title: string; kind: string; date: string | null; cover: string | null; label: string | null; songs: number | null; length: number | null;
  artist: { id: string; name: string };
  tracks: { disk: number | null; position: number | null; title: string; duration: number | null; track_id: string | null; site_title: string | null; status: string | null }[];
};

const load = cache(async (id: string) => {
  const { data, error } = await supabase.rpc("rpc_album", { p_album: id });
  return { a: (data as Album | null) ?? null, failed: !!error };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { a } = await load(id);
  if (!a) return { title: "Album not found · Static-Cuts//" };
  const title = `${a.title} — ${a.artist.name} (${a.kind === "ep" ? "EP" : "album"}) · Static-Cuts//`;
  const description = `${a.title} by ${a.artist.name}${a.date ? `, ${a.date.slice(0, 4)}` : ""}${a.songs ? `, ${a.songs} songs` : ""}. Full tracklist, ratings and every version, on Static-Cuts//.`;
  return {
    title, description,
    alternates: { canonical: `/album/${id}` },
    openGraph: { title, description, type: "music.album", images: a.cover ? [a.cover] : undefined },
    twitter: { card: "summary_large_image", title, description },
  };
}

const mmss = (s: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

export default async function AlbumPage({ params }: Props) {
  const { id } = await params;
  const { a, failed } = await load(id);
  if (!failed && !a) notFound();
  if (!a) return <AlbumView id={id} />;
  const kind = a.kind === "ep" ? "EP" : "Album";
  const ld = {
    "@context": "https://schema.org",
    "@type": "MusicAlbum",
    name: a.title,
    url: `https://static-cuts.com/album/${id}`,
    byArtist: { "@type": "MusicGroup", name: a.artist.name, url: `https://static-cuts.com/artist/${a.artist.id}` },
    ...(a.cover ? { image: a.cover } : {}),
    ...(a.date ? { datePublished: a.date } : {}),
    numTracks: a.tracks.length,
    track: a.tracks.map((t) => ({
      "@type": "MusicRecording", name: t.title,
      ...(t.track_id ? { url: `https://static-cuts.com/song/${t.track_id}` } : {}),
      ...(t.duration ? { duration: `PT${Math.floor(t.duration / 60)}M${t.duration % 60}S` } : {}),
    })),
  };
  return (
    <AlbumView id={id}>
      <div className="wrap al-page song-ssr">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
        <h1>{a.title}</h1>
        <p>{kind} by <Link href={`/artist/${a.artist.id}`}>{a.artist.name}</Link>{a.date ? `, ${a.date.slice(0, 4)}` : ""}{a.label ? ` · ${a.label}` : ""}</p>
        <h2>Tracklist ({a.tracks.length})</h2>
        <ol>
          {a.tracks.map((t, i) => (
            <li key={i}>
              {t.track_id ? <Link href={`/song/${t.track_id}`}>{t.title}</Link> : t.title}
              {t.duration ? ` · ${mmss(t.duration)}` : ""}
            </li>
          ))}
        </ol>
        <p className="empty-state">loading…</p>
      </div>
    </AlbumView>
  );
}
