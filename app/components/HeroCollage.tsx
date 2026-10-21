"use client";

// Computers only: faded artist photos behind the homepage wordmark. Your
// followed artists when you follow enough with photos, otherwise a random
// mix from the archive.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

function shuffle<T>(list: T[]) {
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}

export default function HeroCollage({ artistIds }: { artistIds?: string[] }) {
  const [imgs, setImgs] = useState<string[]>([]);
  const key = (artistIds ?? []).slice().sort().join(",");
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    (async () => {
      let mine: string[] = [];
      if (artistIds && artistIds.length) {
        const { data } = await supabase.from("artists").select("image_url").in("id", artistIds.slice(0, 200)).not("image_url", "is", null);
        mine = ((data ?? []) as { image_url: string }[]).map((r) => r.image_url);
      }
      let list = mine;
      if (mine.length < 6) {
        const { data } = await supabase.from("artists").select("image_url").not("image_url", "is", null).limit(80);
        list = [...mine, ...shuffle(((data ?? []) as { image_url: string }[]).map((r) => r.image_url).filter((u) => !mine.includes(u)))];
      }
      list = shuffle(list);
      // Fill the whole collage, repeating photos if there aren't enough.
      const out: string[] = [];
      for (let i = 0; list.length && i < 30; i++) out.push(list[i % list.length]);
      setImgs(out);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
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
