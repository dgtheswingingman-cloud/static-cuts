"use client";

// One genre: its artists sliding behind the title, the genres that often go
// with it, and every artist in it (the ones it fits best first), with a
// filter and sort.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeroCollage from "../../components/HeroCollage";

type GenreInfo = {
  slug: string; tag: string;
  artists: { id: string; name: string; image_url: string | null; songs: number }[];
  related: { slug: string; tag: string; n: number }[];
};

export default function GenrePage() {
  const params = useParams();
  const slug = params.slug as string;
  const [info, setInfo] = useState<GenreInfo | null | undefined>(undefined);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"fit" | "songs" | "az">("fit");
  const [shown, setShown] = useState(60);
  useEffect(() => {
    supabase.rpc("rpc_genre", { p_slug: slug }).then(({ data }) => setInfo((data as GenreInfo) ?? null));
  }, [slug]);

  const artists = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let l = (info?.artists ?? []).filter((a) => !needle || a.name.toLowerCase().includes(needle));
    if (sort === "songs") l = [...l].sort((a, b) => b.songs - a.songs);
    if (sort === "az") l = [...l].sort((a, b) => a.name.localeCompare(b.name));
    return l;
  }, [info, q, sort]);

  if (info === undefined) return <div className="wrap"><div className="empty-state">loading…</div></div>;
  if (info === null) {
    return (
      <div className="wrap">
        <h1 className="detail-name page-title">Genre not found</h1>
        <Link href="/genres" className="text-link">All genres</Link>
      </div>
    );
  }

  const photos = info.artists.map((a) => a.image_url).filter(Boolean).slice(0, 30) as string[];
  const songs = info.artists.reduce((t, a) => t + a.songs, 0);

  return (
    <div className="wrap gn-page">
      <header className={`lb-hero gn-hero ${photos.length >= 3 ? "has-collage" : ""}`}>
        {photos.length >= 3 && <HeroCollage images={photos} className="pf-collage ah2-collage" />}
        <div className="lb-hero-inner">
          <div className="ls-crumb"><Link href="/genres">Genres</Link> / <span>{info.tag}</span></div>
          <span className="ah2-tag gn-tag">Genre//</span>
          <h1 className="ls-title gn-title gn-one">{info.tag}<span>//</span></h1>
          <div className="gn-stats">
            <span><strong>{info.artists.length.toLocaleString("en-GB")}</strong> artists</span>
            <span><strong>{songs.toLocaleString("en-GB")}</strong> songs logged</span>
          </div>
        </div>
      </header>

      {info.related.length > 0 && (
        <>
          <div className="gn-sec"><h2><em>///</em> Goes with</h2><span>Genres these artists often share.</span></div>
          <div className="gn-pills gn-related">
            {info.related.map((r) => (
              <Link key={r.slug} href={`/genre/${r.slug}`} className="gn-pill">
                <span>{r.tag}</span><em>{r.n.toLocaleString("en-GB")}</em>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="gn-sec">
        <h2><em>///</em> Artists</h2>
        <span>{artists.length.toLocaleString("en-GB")} {q ? "matching" : "in the archive"}</span>
      </div>
      <div className="lb-artist-tools">
        <input className="sr-select lb-filter" placeholder={`Filter ${info.tag} artists…`} value={q} onChange={(e) => { setQ(e.target.value); setShown(60); }} aria-label="Filter artists" />
        <select className="sr-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="fit">Sort: best fit</option>
          <option value="songs">Sort: most songs</option>
          <option value="az">Sort: A–Z</option>
        </select>
      </div>
      {artists.length === 0 && <div className="empty-state">No artists match.</div>}
      <div className="lb-artists">
        {artists.slice(0, shown).map((a) => (
          <Link key={a.id} href={`/artist/${a.id}`} className="lb-artist" style={a.image_url ? ({ "--img": `url("${a.image_url}")` } as CSSProperties) : undefined}>
            <span className="lb-artist-name">{a.name}</span>
            <span className="lb-artist-meta">{a.songs.toLocaleString("en-GB")} songs logged</span>
          </Link>
        ))}
      </div>
      {artists.length > shown && (
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <button className="tab" onClick={() => setShown(shown + 120)}>Show more ({(artists.length - shown).toLocaleString("en-GB")})</button>
        </div>
      )}
    </div>
  );
}
