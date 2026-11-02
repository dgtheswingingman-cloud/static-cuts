// The artist page itself loads in the browser (it shows your collection),
// so its title and link preview are filled in here, for Google and for
// links shared on Discord, Twitter and the like.

import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";

type Props = { params: Promise<{ id: string }>; children: React.ReactNode };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const [{ data: artist }, { count }, { count: unreleased }] = await Promise.all([
    supabase.from("artists").select("name").eq("id", id).maybeSingle(),
    supabase.from("tracks").select("id", { count: "exact", head: true }).eq("artist_id", id),
    supabase.from("tracks").select("id", { count: "exact", head: true }).eq("artist_id", id).neq("release_status", "released"),
  ]);
  if (!artist) return { title: "Artist not found · Static Cuts//" };
  const title = `${artist.name} — every song, leak and unreleased track · Static Cuts//`;
  const n = (x: number | null) => (x ?? 0).toLocaleString("en-GB");
  const description = `${n(count)} ${artist.name} songs logged${unreleased ? `, ${n(unreleased)} of them unreleased, leaked or snippets` : ""}: releases, features and every version, kept up to date by fans.`;
  // The link picture comes from opengraph-image.tsx next to this file.
  return {
    title,
    description,
    alternates: { canonical: `/artist/${id}` },
    openGraph: { title, description, type: "profile" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function ArtistLayout({ children }: Props) {
  return children;
}
