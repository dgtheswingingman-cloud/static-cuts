// The artist page itself loads in the browser (it shows your collection),
// so its title and link preview are filled in here, for Google and for
// links shared on Discord, Twitter and the like.

import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";

type Props = { params: Promise<{ id: string }>; children: React.ReactNode };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const [{ data: artist }, { count }, { data: cover }] = await Promise.all([
    supabase.from("artists").select("name").eq("id", id).maybeSingle(),
    supabase.from("tracks").select("id", { count: "exact", head: true }).eq("artist_id", id),
    supabase.from("tracks").select("cover_url").eq("artist_id", id).not("cover_url", "is", null)
      .order("release_date", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
  ]);
  if (!artist) return { title: "Artist not found · Static Cuts//" };
  const title = `${artist.name} · every song, leak and release · Static Cuts//`;
  const description = `${(count ?? 0).toLocaleString("en-GB")} ${artist.name} songs logged: releases, features, leaks, snippets and unreleased tracks, kept up to date by fans.`;
  const images = cover?.cover_url ? [{ url: cover.cover_url as string }] : undefined;
  return {
    title,
    description,
    alternates: { canonical: `/artist/${id}` },
    openGraph: { title, description, type: "profile", images },
    twitter: { card: images ? "summary_large_image" : "summary", title, description, images: images?.map((i) => i.url) },
  };
}

export default function ArtistLayout({ children }: Props) {
  return children;
}
