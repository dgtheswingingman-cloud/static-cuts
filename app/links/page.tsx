"use client";

// static-cuts.com/links: the link in the bio on Instagram, TikTok and X.
// Today's song of the day, this week's album and on this day up top (what the
// posts are about), then the main ways in.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { thumb } from "@/lib/thumb";
import "../styles/links.css";

type Song = { id: string; title: string; artist: string; status: string; cover: string | null; photo: string | null };
type Aotw = { artist_id: string; artist: string; title: string; cover: string | null; era_key: string | null };
type Otd = { songs?: Song[]; total?: number };

const eraHref = (a: Aotw) => (a.era_key ? `/artist/${a.artist_id}/eras#${encodeURIComponent(a.era_key)}` : `/artist/${a.artist_id}`);

const MORE: [string, string, string][] = [
  ["/search", "Search every song", "Any artist: released, leaked, snippets and versions."],
  ["/radar", "This week's leaks and releases", "What dropped, leaked or got announced."],
  ["/local", "Local Cuts", "Tidy your music folder for Spotify Local Files."],
  ["/discord", "Add the Discord bot", "Daily picks and artist alerts in your server."],
  ["/submit", "Help the archive", "Know a song we're missing? Add it."],
];

export default function LinksPage() {
  const [song, setSong] = useState<Song | null>(null);
  const [otd, setOtd] = useState<Otd | null>(null);
  const [aotw, setAotw] = useState<Aotw | null>(null);
  useEffect(() => {
    supabase.rpc("rpc_social_today").then(({ data }) => {
      const d = data as { song: Song | null; otd: Otd | null } | null;
      setSong(d?.song ?? null); setOtd(d?.otd ?? null);
    });
    supabase.rpc("rpc_album_of_week").then(({ data }) => setAotw((data as Aotw | null) ?? null));
  }, []);
  const img = (u: string | null | undefined) => (u ? <img src={thumb(u, 250)} alt="" /> : <span className="lk-blank">SC//</span>);

  return (
    <div className="lk-page">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-512.png" alt="" className="lk-mark" width={96} height={96} />
      <h1 className="lk-title">STATIC CUTS<span>//</span></h1>
      <p className="lk-lead">Every song, leak and version, kept by fans.</p>

      <div className="lk-today">
        {song && (
          <Link href={`/song/${song.id}`} className="lk-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {img(song.cover ?? song.photo)}
            <span><small>Song of the day</small><b>{song.title}</b><em>{song.artist}</em></span>
          </Link>
        )}
        {aotw && (
          <Link href={eraHref(aotw)} className="lk-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {img(aotw.cover)}
            <span><small>Album of the week</small><b>{aotw.title}</b><em>{aotw.artist}</em></span>
          </Link>
        )}
        {otd?.songs?.length ? (
          <Link href="/on-this-day" className="lk-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {img(otd.songs[0].cover ?? otd.songs[0].photo)}
            <span><small>On this day</small><b>{otd.songs.map((s) => s.title).join(" · ")}</b>
              <em>{otd.total && otd.total > otd.songs.length ? `+ ${(otd.total - otd.songs.length).toLocaleString("en-GB")} more` : "from past years"}</em></span>
          </Link>
        ) : null}
      </div>

      <div className="lk-list">
        {MORE.map(([href, t, s]) => (
          <Link key={href} href={href} className="lk-btn"><b>{t}</b><small>{s}</small></Link>
        ))}
        <Link href="/login?next=/" className="lk-btn lk-join"><b>Make an account</b><small>Follow artists, collect songs, get alerts. Free.</small></Link>
      </div>

      <nav className="lk-social" aria-label="Static Cuts// elsewhere">
        <a href="https://instagram.com/static.cuts.archive" target="_blank" rel="noopener noreferrer">Instagram</a>
        <a href="https://www.tiktok.com/@static.cuts.archive" target="_blank" rel="noopener noreferrer">TikTok</a>
        <a href="https://x.com/StaticCuts" target="_blank" rel="noopener noreferrer">X</a>
      </nav>
    </div>
  );
}
