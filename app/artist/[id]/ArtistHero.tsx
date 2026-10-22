"use client";

// The top of an artist page: their photo blown up behind their name, in
// the page's own colour (taken from the photo). Pages without a photo get a
// plain dark header.

import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { deepCss, swatch, type Rgb } from "@/lib/swatch";

export default function ArtistHero({ artistId, name, aliases, onColour }: {
  artistId: string; name: string; aliases: string[]; onColour?: (rgb: Rgb | null) => void;
}) {
  const [img, setImg] = useState<string | null>(null);
  const [rgb, setRgb] = useState<Rgb | null>(null);

  useEffect(() => {
    let alive = true;
    setImg(null); setRgb(null); onColour?.(null);
    supabase.from("artists").select("image_url").eq("id", artistId).maybeSingle().then(({ data }) => {
      const url = (data as { image_url: string | null } | null)?.image_url ?? null;
      if (!alive) return;
      setImg(url);
      swatch(url).then((c) => { if (alive) { setRgb(c); onColour?.(c); } });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistId]);

  const style = {
    ...(img ? { "--hero-img": `url("${img}")` } : {}),
    ...(rgb ? { "--hero-deep": deepCss(rgb), "--hero-glow": deepCss(rgb, 0.6) } : {}),
  } as CSSProperties;

  return (
    <header className={`artist-hero ${img ? "has-img" : ""}`} style={style}>
      <div className="artist-hero-inner">
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={name} className="artist-hero-photo" width={150} height={150} />
        )}
        <div style={{ minWidth: 0 }}>
          <h1 className="detail-name artist-hero-name">{name}</h1>
          {aliases.length > 0 && <div className="artist-hero-aka">also known as {aliases.join(", ")}</div>}
        </div>
      </div>
    </header>
  );
}
