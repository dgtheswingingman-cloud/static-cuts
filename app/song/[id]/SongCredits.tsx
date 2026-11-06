"use client";

// Who built this song's page: who added it to the archive (and how), who has
// edited it since (and what they changed), and where its details came from.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Person = { id: string | null; name: string; avatar: string | null };
type Credits = {
  added_at: string | null;
  added_by: (Person & { via: string | null; label: string | null }) | null;
  source: string | null;
  sheet: string | null;
  editors: (Person & { edits: number; last: string; fields: string[] })[];
  details_from: string[];
};

const FIELD: Record<string, string> = {
  spotify_url: "Spotify link", deezer_url: "Deezer link", apple_url: "Apple Music link", youtube_url: "YouTube link",
  soundcloud_url: "SoundCloud link", genius_song_id: "Genius link", cover_url: "cover", release_date: "release date",
  leak_date: "leak date", track_number: "track number", length_sec: "length", release_status: "status",
  featured_artists: "features", parent_track_id: "version link", isrc: "ISRC", is_official: "status",
};
const field = (f: string) => FIELD[f] ?? f.replace(/_url$/, " link").replace(/_/g, " ");
const SOURCE: Record<string, string> = {
  deezer: "Deezer", spotify: "Spotify", apple: "Apple Music", genius: "Genius", lastfm: "Last.fm",
  sheet: "a community tracker", local: "someone's music files", musicbrainz: "MusicBrainz",
};
function how(via: string | null, label: string | null) {
  if (label?.startsWith("Liked songs from Spotify")) return "from their Spotify";
  if (via === "suggestion") return "as a suggestion";
  if (via === "import") return label?.startsWith("Import review") ? "from an import" : "with an import";
  if (via === "tracker") return "from a tracker sheet";
  return null;
}
const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Name({ p }: { p: Person }) {
  const face = p.avatar
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={p.avatar} alt="" className="sc-face" />
    : <span className="sc-face sc-face-blank">{p.name.slice(0, 1).toUpperCase()}</span>;
  return p.id
    ? <Link href={`/profile/${p.id}#contributions`} className="sc-person">{face}{p.name}</Link>
    : <span className="sc-person">{face}{p.name}</span>;
}

export default function SongCredits({ trackId }: { trackId: string }) {
  const [c, setC] = useState<Credits | null>(null);
  useEffect(() => {
    setC(null);
    supabase.rpc("rpc_song_credits", { p_track: trackId }).then(({ data }) => setC((data as Credits | null) ?? null));
  }, [trackId]);
  if (!c) return null;

  const origin = c.added_by ? null : c.sheet ? `the ${c.sheet} tracker` : c.source ? SOURCE[c.source] ?? null : null;

  return (
    <details className="sp-info sc-credits" open>
      <summary>Credits</summary>
      <div className="sc-row">
        <div className="sc-k">Added to the archive</div>
        <div className="sc-v">
          {c.added_by
            ? <><Name p={c.added_by} />{how(c.added_by.via, c.added_by.label) && <span className="sc-dim"> {how(c.added_by.via, c.added_by.label)}</span>}</>
            : origin ? <span>automatically, from {origin}</span> : <span className="sc-dim">before credits were kept</span>}
          {c.added_at && <span className="sc-dim"> · {day(c.added_at)}</span>}
        </div>
      </div>
      {c.editors.length > 0 && (
        <div className="sc-row">
          <div className="sc-k">Edited by</div>
          <div className="sc-v sc-eds">
            {c.editors.map((e, i) => (
              <div key={(e.id ?? e.name) + i} className="sc-ed">
                <Name p={e} />
                <span className="sc-dim">
                  {e.fields.length ? ` ${e.fields.slice(0, 4).map(field).filter((x, k, a) => a.indexOf(x) === k).join(", ")}${e.fields.length > 4 ? "…" : ""}` : ""}
                  {` · ${day(e.last)}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {c.details_from.length > 0 && (
        <div className="sc-row">
          <div className="sc-k">Details from</div>
          <div className="sc-v">{c.details_from.join(" · ")}</div>
        </div>
      )}
      <p className="sc-note">Everyone who adds or fixes a song is credited here and on the <Link href="/contributors" className="text-link">contributors board</Link>, however they did it.</p>
    </details>
  );
}
