"use client";

// "Play here": Spotify, YouTube and SoundCloud players right on the page,
// so nobody has to leave the site to listen. Other links just open.

import { useState } from "react";

export function embedFor(url: string | null | undefined): { src: string; height: number } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    if (host === "open.spotify.com") {
      const m = u.pathname.match(/\/(track|album|playlist)\/([A-Za-z0-9]+)/);
      return m ? { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: m[1] === "track" ? 152 : 352 } : null;
    }
    if (host === "youtube.com" || host === "youtu.be") {
      const id = host === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v") ?? u.pathname.match(/\/shorts\/([\w-]+)/)?.[1];
      return id ? { src: `https://www.youtube-nocookie.com/embed/${id}`, height: 220 } : null;
    }
    if (host === "soundcloud.com") {
      return { src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ededed&visual=false`, height: 166 };
    }
  } catch {
    return null;
  }
  return null;
}

export default function InlinePlayer({ url, label = "play here" }: { url: string | null | undefined; label?: string }) {
  const [open, setOpen] = useState(false);
  const embed = embedFor(url);
  if (!embed) return null;
  return (
    <>
      <button className={`tab ${open ? "active" : ""}`} onClick={() => setOpen(!open)}>{open ? "close player" : `▶ ${label}`}</button>
      {open && (
        <div className="inline-player">
          <iframe src={embed.src} height={embed.height} loading="lazy" title="Player"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />
        </div>
      )}
    </>
  );
}
