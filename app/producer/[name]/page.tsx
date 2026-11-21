// A producer's page: /producer/<name>. The full page loads in the browser,
// but the server sends the title, link preview and their songs as plain text
// first, so search engines can read them; the browser's list replaces it.

import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { supabase } from "@/lib/supabase";
import ProducerView from "./ProducerView";

// Built on first visit, then kept for a day (see the song page).
export const revalidate = 86400;
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ name: string }> };
type Song = { track_id: string; title: string; artist_id: string; artist: string; status: string; release_date: string | null; album: string | null };

const load = cache(async (name: string) => {
  const { data } = await supabase.rpc("rpc_producer", { p_name: name });
  return (data as Song[] | null) ?? [];
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const name = decodeURIComponent((await params).name);
  const songs = await load(name);
  const artists = [...new Set(songs.map((s) => s.artist))];
  const title = `${name} — produced songs, leaks and unreleased · Static-Cuts//`;
  const description = songs.length
    ? `${songs.length.toLocaleString("en-GB")} songs produced by ${name}${artists.length ? ` for ${artists.slice(0, 3).join(", ")}${artists.length > 3 ? " and more" : ""}` : ""}: released, leaked and unreleased, on Static-Cuts//.`
    : `Songs credited to ${name} on Static-Cuts//.`;
  return {
    title, description,
    alternates: { canonical: `/producer/${encodeURIComponent(name)}` },
    openGraph: { title, description, type: "profile" },
    twitter: { card: "summary", title, description },
  };
}

export default async function ProducerPage({ params }: Props) {
  const name = decodeURIComponent((await params).name);
  const songs = await load(name);
  const list = songs.slice(0, 300);
  return (
    <ProducerView>
      <div className="song-ssr">
        <p>{songs.length.toLocaleString("en-GB")} songs produced by {name}.</p>
        {list.length > 0 && (
          <ul>
            {list.map((s) => (
              <li key={s.track_id}>
                <Link href={`/song/${s.track_id}`}>{s.title}</Link> by <Link href={`/artist/${s.artist_id}`}>{s.artist}</Link>
                {s.status && s.status !== "released" ? ` (${s.status})` : ""}
              </li>
            ))}
          </ul>
        )}
        <p className="empty-state">loading…</p>
      </div>
    </ProducerView>
  );
}
