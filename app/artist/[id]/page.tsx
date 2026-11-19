// An artist page: /artist/<id>. The full page loads in the browser (it shows
// your collection), but the server sends the artist's facts and songs as
// plain text first, so search engines can read them. The browser's page
// replaces that text once it has loaded. (Title and link preview: layout.tsx.)

import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ArtistView from "./ArtistView";

type Props = { params: Promise<{ id: string }> };
type Song = { id: string; title: string; release_status: string | null; album: string | null };

const LIST = 300;

export default async function ArtistPage({ params }: Props) {
  const { id } = await params;
  const [a, songs, total, unreleased] = await Promise.all([
    supabase.from("artists").select("id, name, bio, country, real_name, active_from, image_url").eq("id", id).maybeSingle(),
    supabase.from("tracks").select("id, title, release_status, album").eq("artist_id", id).is("parent_track_id", null)
      .order("title").limit(LIST),
    supabase.from("tracks").select("id", { count: "exact", head: true }).eq("artist_id", id).is("parent_track_id", null),
    supabase.from("tracks").select("id", { count: "exact", head: true }).eq("artist_id", id).is("parent_track_id", null).neq("release_status", "released"),
  ]);
  // Really not there (not just the database being slow): a proper 404.
  if (!a.error && !a.data) notFound();
  const artist = a.data as { id: string; name: string; bio: string | null; country: string | null; real_name: string | null; active_from: string | null; image_url: string | null } | null;
  if (!artist) return <ArtistView />;

  const list = (songs.data ?? []) as Song[];
  const n = (x: number | null) => (x ?? 0).toLocaleString("en-GB");
  const bio = artist.bio ? artist.bio.replace(/<[^>]+>/g, "").trim() : "";
  const shortBio = bio.length > 400 ? bio.slice(0, 400).replace(/\s+\S*$/, "") + "…" : bio;
  const ld = {
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    name: artist.name,
    url: `https://static-cuts.com/artist/${artist.id}`,
    ...(artist.image_url ? { image: artist.image_url } : {}),
    ...(artist.active_from ? { foundingDate: String(artist.active_from).slice(0, 4) } : {}),
    ...(list.length ? { track: list.slice(0, 50).map((s) => ({ "@type": "MusicRecording", name: s.title, url: `https://static-cuts.com/song/${s.id}` })) } : {}),
  };

  return (
    <ArtistView>
      <div className="song-ssr">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
        <h1>{artist.name}</h1>
        <p>
          {n(total.count)} songs logged{unreleased.count ? `, ${n(unreleased.count)} of them unreleased, leaked or snippets` : ""}.
          {artist.real_name ? ` Real name: ${artist.real_name}.` : ""}
          {artist.country ? ` From ${artist.country}.` : ""}
        </p>
        {shortBio && <p>{shortBio}</p>}
        {list.length > 0 && (
          <>
            <h2>Songs{(total.count ?? 0) > list.length ? ` (first ${list.length} A–Z)` : ""}</h2>
            <ul>
              {list.map((s) => (
                <li key={s.id}>
                  <Link href={`/song/${s.id}`}>{s.title}</Link>
                  {s.release_status && s.release_status !== "released" ? ` (${s.release_status})` : ""}
                  {s.album ? ` · ${s.album}` : ""}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="empty-state">loading…</p>
      </div>
    </ArtistView>
  );
}
