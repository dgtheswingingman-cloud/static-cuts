// /artist/<id>/eras: an artist's songs grouped by era. The full page loads in
// the browser, but the server sends the eras and their songs as plain text
// first (and its own title), so search engines can read them. The browser's
// page replaces that text once it has loaded.

import "../../../styles/pages.css";
import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { buildEras, span, type Song } from "@/lib/eras";
import ErasView from "./ErasView";

// Built on first visit, then kept for a day (see the song page).
export const revalidate = 86400;
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };

const load = cache(async (id: string) => {
  const { data, error } = await supabase.rpc("rpc_artist_eras", { p_artist: id });
  const d = data as { artist: { id: string; name: string } | null; songs: Song[] } | null;
  return { artist: d?.artist ?? null, songs: d?.songs ?? [], failed: !!error };
});

// At most this many song links in the plain-text version (big artists have thousands).
const LINKS = 800;
const PER_ERA = 40;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { artist, songs } = await load(id);
  if (!artist) return { title: "Artist not found · Static-Cuts//" };
  const eras = buildEras(songs).filter((e) => e.kind === "album");
  const names = eras.slice(0, 4).map((e) => e.name).join(", ");
  const title = `${artist.name} eras — every album with its leaks and snippets · Static-Cuts//`;
  const description = `${artist.name}'s songs grouped by era${names ? `: ${names}${eras.length > 4 ? " and more" : ""}` : ""}. Each album or project with the unreleased songs, leaks and snippets from that time.`;
  return {
    title,
    description,
    alternates: { canonical: `/artist/${id}/eras` },
    openGraph: { title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ErasPage({ params }: Props) {
  const { id } = await params;
  const { artist, songs, failed } = await load(id);
  // Really not there (not just the database being slow): a proper 404.
  if (!failed && !artist) notFound();
  if (!artist) return <ErasView />;

  const eras = buildEras(songs);
  let left = LINKS;

  return (
    <ErasView>
      <div className="wrap pg-page pg-wide song-ssr">
        <p><Link href={`/artist/${artist.id}`}>← {artist.name}</Link></p>
        <h1>{artist.name} eras</h1>
        <p>Every song grouped by era: each album or project, with the leaks and snippets from that time.</p>
        {eras.map((e) => {
          const shown = e.songs.slice(0, Math.max(0, Math.min(PER_ERA, left)));
          left -= shown.length;
          const when = span(e);
          return (
            <section key={e.key} id={e.key}>
              <h2>{e.name}{when && e.kind === "album" ? ` (${when})` : ""}</h2>
              <p>{e.songs.length} song{e.songs.length === 1 ? "" : "s"}</p>
              {shown.length > 0 && (
                <ul>
                  {shown.map((s) => (
                    <li key={s.id}>
                      <Link href={`/song/${s.id}`}>{s.title}</Link>
                      {s.status && s.status !== "released" ? ` (${s.status})` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        <p className="empty-state">loading…</p>
      </div>
    </ErasView>
  );
}
