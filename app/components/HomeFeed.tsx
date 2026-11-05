"use client";

// The top of the homepage: album of the week (with On this day under it),
// latest updates (what just changed in the archive), recently added songs
// and the artists you follow. Weekly numbers and what's coming up are on Radar.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import AlbumOfWeek from "./AlbumOfWeek";
import Strip from "./Strip";
import { thumb } from "@/lib/thumb";

type Group = { kind: "added" | "status"; artist_id: string; artist: string | null; to_status: string | null; count: number; at: string; tracks: { id: string; title: string }[] };
type Added = { id: string; title: string; cover_url: string | null; release_status: string | null; album: string | null; created_at: string; artist_id: string; artists: { name: string } | null };

function ago(at: string) {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(at)) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function Head({ title, href, label = "View all" }: { title: string; href?: string; label?: string }) {
  return (
    <div className="sp-head hf-head">
      <h2>{title}</h2>
      {href && <Link href={href}>{label} →</Link>}
    </div>
  );
}

export default function HomeFeed({ photos, followed, afterAlbum }: { photos: Record<string, string>; followed: string[]; afterAlbum?: ReactNode }) {
  const [updates, setUpdates] = useState<Group[] | null>(null);
  const [added, setAdded] = useState<Added[]>([]);

  useEffect(() => {
    const load = () => supabase.rpc("rpc_whats_new", { p_before: null, p_kind: "all", p_following: false, p_days: 7 }).then(({ data }) => {
      const groups = ((data as { days?: { groups: Group[] }[] } | null)?.days ?? []).flatMap((d) => d.groups);
      setUpdates(groups.slice(0, 9));
    });
    load();
    const t = setInterval(load, 120000);
    supabase.from("tracks").select("id, title, cover_url, release_status, album, created_at, artist_id, artists(name)")
      .is("parent_track_id", null).not("cover_url", "is", null).order("created_at", { ascending: false }).limit(12)
      .then(({ data }) => setAdded((data as unknown as Added[]) ?? []));
    return () => clearInterval(t);
  }, []);

  const followedWithPhotos = followed.filter((id) => photos[id]);

  return (
    <div className="hf">
      <AlbumOfWeek hero />
      {afterAlbum}

      <Head title="Latest updates" href="/new" />
      {updates && updates.length === 0 && <div className="comment-meta">Quiet for now.</div>}
      <Strip className="hf-updates">
        {(updates ?? []).map((g, i) => {
          const st = g.kind === "added" ? "added" : g.to_status ?? "";
          const first = g.tracks[0];
          return (
            <Link key={i} href={g.count === 1 && first ? `/song/${first.id}` : `/artist/${g.artist_id}`} className="hf-update">
              <span className="hf-update-img">
                {photos[g.artist_id]
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={thumb(photos[g.artist_id])} alt="" loading="lazy" />
                  : <span>{(g.artist ?? "?").slice(0, 1)}</span>}
              </span>
              <span className="hf-update-body">
                <span className="hf-update-artist">{g.artist ?? g.artist_id}</span>
                <span className="hf-update-what">
                  {g.kind === "added"
                    ? (g.count === 1 && first ? <>New song &ldquo;{first.title}&rdquo;</> : <>{g.count} new songs</>)
                    : (g.count === 1 && first ? <>&ldquo;{first.title}&rdquo;</> : <>{g.count} songs</>)}
                </span>
                <span className="hf-update-foot">
                  <span className={`feature-tag st st-${st}`}>{g.kind === "added" ? "added" : st}</span>
                  <span className="hf-when">{ago(g.at)}</span>
                </span>
              </span>
            </Link>
          );
        })}
      </Strip>

      {added.length > 0 && (
        <>
          <Head title="Recently added" href="/new" />
          <Strip className="hf-covers">
            {added.map((t) => (
              <Link key={t.id} href={`/song/${t.id}`} className="hf-cover">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb(t.cover_url!)} alt="" loading="lazy" />
                <span className="hf-cover-artist">{t.artists?.name ?? ""}</span>
                <span className="hf-cover-title">{t.title}</span>
                <span className="hf-cover-meta">{[t.release_status, t.album ? "album" : "single"].filter(Boolean).join(" · ")}</span>
              </Link>
            ))}
          </Strip>
        </>
      )}

          {followed.length > 0 && (
        <>
          <Link href="/library" className="hf-sub-head">Followed artists ({followed.length}) →</Link>
          <div className="hf-followed">
            {followedWithPhotos.slice(0, 6).map((id) => (
              <Link key={id} href={`/artist/${id}`} aria-label="Artist">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb(photos[id])} alt="" width={40} height={40} loading="lazy" />
              </Link>
            ))}
            {followed.length > Math.min(6, followedWithPhotos.length) && (
              <a href="/library" className="hf-more">+{followed.length - Math.min(6, followedWithPhotos.length)}</a>
            )}
          </div>
        </>
      )}
    </div>
  );
}
