"use client";

// Live: what each background job did in the last hour and what it's on right
// now. Updates every 15 seconds while the page is open (one small request).

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Live = {
  at: string;
  spotify_match: { last_hour: number; linked_last_hour: number; last: { title: string; artist: string; at: string; found: boolean } | null };
  genius_credits: { last_hour: number; last: { title: string; artist: string; at: string } | null };
  covers: { last_hour: number };
  imports: { source: string; artist: string | null; at: string; running: boolean; error: string | null; suggested: number | null }[];
  youtube: { last_hour: number; found_today: number; last: { title: string; artist: string; at: string; found: number } | null };
  guests: { last_hour: number; last: { name: string; state: string; at: string } | null };
  trackers: { title: string; at: string; error: string | null } | null;
  running_now: string[];
  artist_info: { with_photo: number; with_about: number; artists: number };
};

function ago(iso: string | null | undefined) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

const SOURCE: Record<string, string> = { genius: "Genius", lastfm: "Last.fm", spotify: "Spotify", sheet: "tracker" };

export default function LivePanel() {
  const [live, setLive] = useState<Live | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let stop = false;
    async function load() {
      if (document.hidden) return;
      const { data } = await supabase.rpc("admin_live");
      if (!stop && data) setLive(data as Live);
    }
    load();
    const t = setInterval(load, 15000);
    const t2 = setInterval(() => tick((x) => x + 1), 5000);
    return () => { stop = true; clearInterval(t); clearInterval(t2); };
  }, []);

  if (!live) return null;
  const row = (name: string, now: string, hour: string, busy?: boolean) => (
    <div className="review-row live-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }} key={name}>
      <div style={{ minWidth: 0 }}>
        <div className="review-row-title">{busy && <span className="live-dot" />} {name}</div>
        <div className="review-row-meta"><span>{now}</span></div>
      </div>
      <span className="comment-meta">{hour}</span>
    </div>
  );
  const running = new Set(live.running_now);
  const imp = live.imports[0];

  return (
    <>
      <div className="section-label" style={{ marginTop: 0 }}>Live <span className="comment-meta">· updates every 15 seconds</span></div>
      {row("Spotify links",
        live.spotify_match.last ? `last: ${live.spotify_match.last.artist} – ${live.spotify_match.last.title} (${live.spotify_match.last.found ? "found" : "not on Spotify"}), ${ago(live.spotify_match.last.at)}` : "nothing yet",
        `${live.spotify_match.last_hour} checked, ${live.spotify_match.linked_last_hour} found this hour`, running.has("spotify-match"))}
      {row("Genius details",
        live.genius_credits.last ? `last: ${live.genius_credits.last.artist} – ${live.genius_credits.last.title}, ${ago(live.genius_credits.last.at)}` : "nothing yet",
        `${live.genius_credits.last_hour} this hour`, running.has("genius-credits"))}
      {row("Imports",
        imp ? `${SOURCE[imp.source] ?? imp.source}: ${imp.artist ?? "?"} ${imp.running ? "(running now)" : imp.error ? "(failed)" : `(${imp.suggested ?? 0} sent for review)`}, ${ago(imp.at)}` : "none in the last 3 hours",
        `${live.imports.length} in 3 hours`, !!imp?.running)}
      {row("YouTube search",
        live.youtube.last ? `last: ${live.youtube.last.artist} – ${live.youtube.last.title} (${live.youtube.last.found} found), ${ago(live.youtube.last.at)}` : "nothing yet",
        `${live.youtube.last_hour} this hour, ${live.youtube.found_today} links found today`, running.has("youtube-search"))}
      {row("Guest artists",
        live.guests.last ? `last: ${live.guests.last.name} (${live.guests.last.state}), ${ago(live.guests.last.at)}` : "nothing yet",
        `${live.guests.last_hour} this hour`, running.has("guest-artists"))}
      {row("Trackers",
        live.trackers ? `last: ${live.trackers.title}${live.trackers.error ? " (problem)" : ""}, ${ago(live.trackers.at)}` : "none yet",
        "", running.has("sheet-sync"))}
      {row("Artist photos and about",
        `${live.artist_info.with_photo} of ${live.artist_info.artists} have a photo, ${live.artist_info.with_about} an about`,
        `artwork: ${live.covers.last_hour} this hour`, running.has("artist-info"))}
      {live.running_now.length > 0 && (
        <div className="comment-meta" style={{ marginTop: 6 }}>Running right now: {live.running_now.join(", ")}</div>
      )}
    </>
  );
}
