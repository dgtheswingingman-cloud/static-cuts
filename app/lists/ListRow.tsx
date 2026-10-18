"use client";

import Link from "next/link";

export type ListRow = {
  id: string; title: string; description: string | null; is_public: boolean; owner_id: string; owner_name: string;
  songs: number; followers: number; updated_at: string; artists: string[] | null; has_track?: boolean;
};

export function ListRowView({ l }: { l: ListRow }) {
  return (
    <div className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
      <div style={{ minWidth: 0 }}>
        <div className="review-row-title"><Link href={`/list/${l.id}`}>{l.title}</Link></div>
        <div className="review-row-meta">
          <Link href={`/profile/${l.owner_id}`}>{l.owner_name}</Link>
          <span>{l.songs} song{l.songs === 1 ? "" : "s"}</span>
          {l.followers > 0 && <span>{l.followers} follower{l.followers === 1 ? "" : "s"}</span>}
          {l.artists && l.artists.length > 0 && <span>{l.artists.join(", ")}</span>}
          {!l.is_public && <span className="feature-tag">private</span>}
        </div>
      </div>
      <span className="comment-meta">{new Date(l.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
    </div>
  );
}

