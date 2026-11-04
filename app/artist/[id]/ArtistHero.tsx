"use client";

// The top of an artist page: their photos sliding behind (or the one photo
// on the right) fading into black and static, an ARTIST tag, the name in big glitch type, their genres, and the
// numbers (passed in as children). The page's colour comes from the photo.

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import HeroCollage from "../../components/HeroCollage";
import { deepCss, swatch, type Rgb } from "@/lib/swatch";

export default function ArtistHero({ artistId, name, aliases, genres = [], onColour, children }: {
  artistId: string; name: string; aliases: string[]; genres?: string[]; onColour?: (rgb: Rgb | null) => void; children?: ReactNode;
}) {
  const [img, setImg] = useState<string | null>(null);
  const [rgb, setRgb] = useState<Rgb | null>(null);
  // Their photo pool: three or more and the banner becomes sliding rows of
  // them (like the homepage and profiles); fewer and it's the one photo.
  const [pool, setPool] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    setImg(null); setRgb(null); setPool([]); onColour?.(null);
    supabase.from("artist_photos").select("url").eq("artist_id", artistId).order("created_at").limit(40).then(({ data }) => {
      if (alive) setPool(((data ?? []) as { url: string }[]).map((r) => r.url));
    });
    supabase.from("artists").select("image_url").eq("id", artistId).maybeSingle().then(({ data }) => {
      const url = (data as { image_url: string | null } | null)?.image_url ?? null;
      if (!alive) return;
      setImg(url);
      swatch(url).then((c) => { if (alive) { setRgb(c); onColour?.(c); } });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistId]);

  const style = (rgb ? { "--hero-deep": deepCss(rgb, 0.85) } : {}) as CSSProperties;

  const photos = [...new Set([...(img ? [img] : []), ...pool])];
  const collage = photos.length >= 3;

  return (
    <header className={`artist-hero ah2 ${img || collage ? "has-img" : ""} ${collage ? "ah2-has-collage" : ""}`} style={style}>
      {collage && <HeroCollage images={photos} className="pf-collage ah2-collage" />}
      {!collage && img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt={name} className="ah2-img" />
      )}
      <div className="artist-hero-inner ah2-inner">
        <span className="ah2-tag">Artist</span>
        <h1 className="detail-name artist-hero-name">{name}</h1>
        {genres.length > 0 && <div className="ah2-genres">{genres.join(" / ")}</div>}
        {aliases.length > 0 && <div className="artist-hero-aka">also known as {aliases.join(", ")}</div>}
        {children}
      </div>
    </header>
  );
}
