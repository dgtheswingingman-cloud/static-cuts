"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Track = {
  id: string;
  title: string;
  spotify_url: string | null;
  role: string | null;
};
type Artist = { id: string; name: string; status: string | null };

export default function ArtistPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [artist, setArtist] = useState<Artist | null>(null);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "main" | "feature">("all");

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
            .select("id, title, spotify_url, role")
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

  const filtered =
    tracks?.filter((t) => {
      if (filter === "all") return true;
      if (filter === "main") return t.role !== "feature";
      return t.role === "feature";
    }) ?? null;

  const confirmedCount = tracks?.filter((t) => t.spotify_url).length ?? 0;

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
            <button
              className={`tab ${filter === "all" ? "active" : ""}`}
              onClick={() => setFilter("all")}
            >
              all
            </button>
            <button
              className={`tab ${filter === "main" ? "active" : ""}`}
              onClick={() => setFilter("main")}
            >
              main
            </button>
            <button
              className={`tab ${filter === "feature" ? "active" : ""}`}
              onClick={() => setFilter("feature")}
            >
              features
            </button>
          </div>

          {!tracks && <div className="empty-state">loading tracklist…</div>}

          {filtered && (
            <div>
              {filtered.map((t) => (
                <div key={t.id} className="track-row">
                  <div className="sigil" />
                  <span className="track-title">{t.title}</span>
                  {t.role === "feature" && <span className="feature-tag">feature</span>}
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
                        `${artist.name} ${t.title}`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      search
                    </a>
                  )}
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="empty-state">Nothing here yet.</div>
              )}
            </div>
          )}

          <div className="note">
            Collected-track marking isn&apos;t wired up in this rebuild yet — it comes
            back once accounts are in place, so it can sync across devices instead of
            living in one browser.
          </div>
        </>
      )}
    </div>
  );
}
