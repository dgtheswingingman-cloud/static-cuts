"use client";

// Computers only: faded artist photos behind the homepage wordmark.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function HeroCollage() {
  const [imgs, setImgs] = useState<string[]>([]);
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    supabase.from("artists").select("image_url").not("image_url", "is", null).limit(60).then(({ data }) => {
      const list = ((data ?? []) as { image_url: string }[]).map((r) => r.image_url);
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      setImgs(list.slice(0, 24));
    });
  }, []);
  if (imgs.length < 6) return null;
  return (
    <div className="hero-collage" aria-hidden="true">
      {imgs.map((u, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={u} alt="" loading="lazy" />
      ))}
    </div>
  );
}
