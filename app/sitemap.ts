import type { MetadataRoute } from "next";
import { supabase } from "@/lib/supabase";

// Every artist and song page, plus the main public pages, so search engines
// can find them. Rebuilt once a day.
export const revalidate = 86400;

const SITE = "https://static-cuts.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, changeFrequency: "daily", priority: 1 },
    ...["new", "radar", "search", "lists", "collabs", "producers", "help", "faq", "sources", "contributors", "on-this-day"].map(
      (p) => ({ url: `${SITE}/${p}`, changeFrequency: "daily" as const, priority: 0.6 })
    ),
  ];
  const { data } = await supabase.rpc("rpc_sitemap");
  const d = (data as { artists?: string[]; songs?: string[] } | null) ?? {};
  for (const id of d.artists ?? []) {
    pages.push({ url: `${SITE}/artist/${encodeURIComponent(id)}`, changeFrequency: "daily", priority: 0.8 });
  }
  for (const id of d.songs ?? []) {
    pages.push({ url: `${SITE}/song/${encodeURIComponent(id)}`, changeFrequency: "weekly", priority: 0.5 });
  }
  return pages;
}
