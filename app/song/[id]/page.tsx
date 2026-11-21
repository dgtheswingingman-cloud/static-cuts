// A page for one song: /song/<id>. The full page is loaded in the browser
// (it shows the viewer's own rating and collection), but the server sends the
// song's facts as plain text first (and the title and link preview), so
// search engines and link previews can read them. The browser's page
// replaces that text once it has loaded.

import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import SongView from "./SongView";

// Each page is built once and kept for a day, so crawlers visiting
// hundreds of thousands of pages don't each cost a fresh build. (Only the
// server's plain-text version is kept; your own collection and ratings
// still load live in the browser.)
export const revalidate = 86400;
// No pages are built ahead of time; each is built on its first visit and
// then kept (without this, Next.js builds the page fresh on every visit).
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };

type Basic = {
  redirect?: string;
  track?: {
    id: string; title: string; release_status: string | null; is_official?: boolean; album: string | null;
    credited_as?: string | null; release_date: string | null; leak_date?: string | null;
    producers: string | null; writers?: string | null; length_sec?: number | null; isrc?: string | null;
  };
  artist?: { id: string; name: string } | null;
  family?: { id: string; title: string; release_status: string | null; is_main: boolean }[];
  appears_on?: { id: string; name: string }[];
};

// Asked once per request, shared by the title and the page.
const load = cache(async (id: string) => {
  const { data, error } = await supabase.rpc("rpc_song_page", { p_id: id });
  return { song: (data as Basic | null) ?? null, failed: !!error };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { song } = await load(id);
  if (!song?.track) return { title: "Song not found · Static-Cuts//" };
  // Worded like people search: "Shoota [V2] — Playboi Carti (unreleased)".
  const status = song.track.release_status && song.track.release_status !== "released" ? song.track.release_status : null;
  const title = `${song.track.title} — ${song.artist?.name ?? "Unknown"}${status ? ` (${status})` : ""} · Static-Cuts//`;
  const versions = Math.max(0, (song.family?.length ?? 0) - 1);
  const bits = [song.track.release_status, song.track.album, versions ? `${versions} other version${versions === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
  const description = `${song.track.title} by ${song.artist?.name ?? "unknown"}${song.track.credited_as ? ` (as ${song.track.credited_as})` : ""}${bits ? ` — ${bits}` : ""}. Every version, its history, credits and where to listen, on Static-Cuts//.`;
  // The picture itself comes from opengraph-image.tsx next to this file.
  return {
    title,
    description,
    alternates: { canonical: `/song/${id}` },
    openGraph: { title, description, type: "music.song" },
    twitter: { card: "summary_large_image", title, description },
  };
}

function day(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function SongPage({ params }: Props) {
  const { id } = await params;
  const { song, failed } = await load(id);
  // Merged into another song: send people (and search engines) there.
  if (song?.redirect && song.redirect !== id) permanentRedirect(`/song/${song.redirect}`);
  // Really not there (not just the database being slow): a proper 404.
  if (!failed && !song?.track) notFound();
  if (!song?.track) return <SongView id={id} />;

  const t = song.track;
  const artist = song.artist;
  const status = t.release_status ?? (t.is_official ? "released" : "unconfirmed");
  const others = (song.family ?? []).filter((v) => v.id !== t.id);
  const facts: [string, string][] = [
    ["Status", status],
    ...(t.album ? [["Album", t.album] as [string, string]] : []),
    ...(t.release_date ? [["Released", day(t.release_date)] as [string, string]] : []),
    ...(t.leak_date ? [["Leaked", day(t.leak_date)] as [string, string]] : []),
    ...(t.producers ? [["Produced by", t.producers] as [string, string]] : []),
    ...(t.writers ? [["Written by", t.writers] as [string, string]] : []),
    ...(t.credited_as ? [["Credited as", t.credited_as] as [string, string]] : []),
  ];
  const ld = {
    "@context": "https://schema.org",
    "@type": "MusicRecording",
    name: t.title,
    url: `https://static-cuts.com/song/${t.id}`,
    ...(artist ? { byArtist: { "@type": "MusicGroup", name: artist.name, url: `https://static-cuts.com/artist/${artist.id}` } } : {}),
    ...(t.album ? { inAlbum: { "@type": "MusicAlbum", name: t.album } } : {}),
    ...(t.release_date ? { datePublished: t.release_date } : {}),
    ...(t.isrc ? { isrcCode: t.isrc } : {}),
    ...(t.length_sec ? { duration: `PT${Math.floor(t.length_sec / 60)}M${t.length_sec % 60}S` } : {}),
  };

  return (
    <SongView id={id}>
      <div className="wrap song-ssr">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
        <h1>{t.title}</h1>
        {artist && <p>by <Link href={`/artist/${artist.id}`}>{artist.name}</Link></p>}
        <dl>
          {facts.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
        {others.length > 0 && (
          <>
            <h2>Other versions ({others.length})</h2>
            <ul>
              {others.slice(0, 50).map((v) => (
                <li key={v.id}><Link href={`/song/${v.id}`}>{v.title}</Link>{v.release_status ? ` (${v.release_status})` : ""}</li>
              ))}
            </ul>
          </>
        )}
        {(song.appears_on ?? []).length > 0 && (
          <p>Also features: {(song.appears_on ?? []).map((a, i) => (
            <span key={a.id}>{i > 0 && ", "}<Link href={`/artist/${a.id}`}>{a.name}</Link></span>
          ))}</p>
        )}
        <p className="empty-state">loading…</p>
      </div>
    </SongView>
  );
}
