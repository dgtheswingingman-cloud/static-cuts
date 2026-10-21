import type { MetadataRoute } from "next";
import { supabase } from "@/lib/supabase";

// Every artist and song page, plus the main public pages, so search engines
// can find them. Rebuilt once a day.
//
// Split into parts of 40,000 songs (search engines read at most 50,000 links
// per sitemap): /sitemap/0.xml, /sitemap/1.xml… robots.ts lists every part.
// Part 0 also has the main pages and every artist.
export const revalidate = 86400;

const SITE = "https://static-cuts.com";
export const SITEMAP_PARTS = 4; // room for 160,000 songs
const PER_PART = 40000;

export async function generateSitemaps() {
  return Array.from({ length: SITEMAP_PARTS }, (_, id) => ({ id }));
}

export default async function sitemap(props: { id: number | string | Promise<number | string> }): Promise<MetadataRoute.Sitemap> {
  const part = Number(await props.id) || 0;
  const pages: MetadataRoute.Sitemap = [];
  if (part === 0) {
    pages.push(
      { url: `${SITE}/`, changeFrequency: "daily", priority: 1 },
      ...["new", "radar", "search", "lists", "collabs", "producers", "help", "faq", "sources", "contributors", "on-this-day", "listen"].map(
        (p) => ({ url: `${SITE}/${p}`, changeFrequency: "daily" as const, priority: 0.6 })
      ),
    );
  }
  const { data } = await supabase.rpc("rpc_sitemap_part", { p_offset: part * PER_PART, p_limit: PER_PART });
  const d = (data as { artists?: string[]; songs?: string[] } | null) ?? {};
  for (const id of d.artists ?? []) {
    pages.push({ url: `${SITE}/artist/${encodeURIComponent(id)}`, changeFrequency: "daily", priority: 0.8 });
  }
  for (const id of d.songs ?? []) {
    pages.push({ url: `${SITE}/song/${encodeURIComponent(id)}`, changeFrequency: "weekly", priority: 0.5 });
  }
  return pages;
}
