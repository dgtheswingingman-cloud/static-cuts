"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Track = {
  id: string;
  title: string;
  spotify_url: string | null;
  parent_track_id: string | null;
  track_type: string;
  is_featured: boolean;
  is_official: boolean;
  has_audio: boolean;
};
type Artist = { id: string; name: string; status: string | null };
type FilterKey = "all" | "main" | "featured" | "official" | "unreleased";

function trackPasses(t: Track, filter: FilterKey) {
  if (filter === "all") return true;
  if (filter === "main") return !t.is_featured;
  if (filter === "featured") return t.is_featured;
  if (filter === "official") return t.is_official;
  if (filter === "unreleased") return !t.is_official;
  return true;
}

export default function ArtistPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [artist, setArtist] = useState<Artist | null>(null);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    async function load() {
      try {
        const { data: artistRow, error: artistErr } = await supabase
          .from("artists")
          .select("id, name, status")
          .eq("id", id)
          .single();
        if (artistErr) throw artistErr;
        setArtist(artistRow);

        const PAGE_SIZE = 1000;
        let all: Track[] = [];
        let from = 0;
        while (true) {
          const { data: page, error: trackErr } = await supabase
            .from("tracks")
            .select(
              "id, title, spotify_url, parent_track_id, track_type, is_featured, is_official, has_audio"
            )
            .eq("artist_id", id)
            .range(from, from + PAGE_SIZE - 1);
          if (trackErr) throw trackErr;
          all = all.concat(page ?? []);
          if (!page || page.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }
        all.sort((a, b) => a.title.localeCompare(b.title));
        setTracks(all);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    }
    load();
  }, [id]);

  // Only top-level tracks show in the main list; sub-entries render nested
  // underneath their parent.
  const mainTracks = tracks?.filter((t) => !t.parent_track_id) ?? [];
  const subsByParent: Record<string, Track[]> = {};
  (tracks ?? []).forEach((t) => {
    if (t.parent_track_id) {
      (subsByParent[t.parent_track_id] = subsByParent[t.parent_track_id] || []).push(t);
    }
  });

  const filteredMain = mainTracks.filter((t) => trackPasses(t, filter));
  const confirmedCount = tracks?.filter((t) => t.spotify_url).length ?? 0;

  function trackRow(t: Track, isSub: boolean) {
    return (
      <div key={t.id} style={{ marginLeft: isSub ? 30 : 0 }}>
        <div className="track-row">
          <div className="sigil" />
          <span className="track-title">{t.title}</span>
          {t.is_featured && <span className="feature-tag">featured</span>}
          {t.is_official ? (
            <span className="feature-tag">official</span>
          ) : (
            <span className="feature-tag">unreleased</span>
          )}
          {!t.has_audio && <span className="feature-tag">no audio</span>}
          {t.spotify_url ? (
            <a
              className="listen-link"
              href={t.spotify_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              spotify
            </a>
          ) : (
            <a
              className="listen-link"
              href={`https://open.spotify.com/search/${encodeURIComponent(
                `${artist?.name ?? ""} ${t.title}`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              search
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>
        ← back to archive
      </button>

      {error && (
        <div className="empty-state" style={{ borderColor: "#a33", marginTop: 18 }}>
          Couldn&apos;t load this artist: <b>{error}</b>
        </div>
      )}

      {!error && artist && (
        <>
          <h1 className="detail-name">{artist.name}</h1>
          <div className="detail-meta">
            {tracks?.length ?? 0} tracks logged · {confirmedCount} confirmed on Spotify
          </div>

          <div className="tabs">
            {(["all", "main", "featured", "official", "unreleased"] as FilterKey[]).map((f) => (
              <button
                key={f}
                className={`tab ${filter === f ? "active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>

          {!tracks && <div className="empty-state">loading tracklist…</div>}

          {tracks && (
            <div>
              {filteredMain.map((t) => (
                <div key={t.id}>
                  {trackRow(t, false)}
                  {(subsByParent[t.id] ?? [])
                    .filter((s) => trackPasses(s, filter))
                    .map((s) => trackRow(s, true))}
                </div>
              ))}
              {filteredMain.length === 0 && (
                <div className="empty-state">Nothing here yet.</div>
              )}
            </div>
          )}

          <div className="note">
            <b>Overlapping filters</b> now match the real design: a track can be both{" "}
            <b>Featured</b> and <b>Official</b> at once, not locked into one category. Sub-entries
            (demos, alt versions) nest under their main track once submissions start adding them
            — none exist yet since this is a fresh migration. Collected-track marking and ratings
            still come with accounts, next.
          </div>
        </>
      )}
    </div>
  );
}
