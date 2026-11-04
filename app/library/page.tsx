"use client";

// Library: your corner of the site. Your lists, the songs you want, your
// ratings, Local Cuts (your own files, checked against the archive) and
// importing a collection, with your numbers on top.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { usePersonalUser } from "../useIsAdmin";

type ListRow = { id: string; title: string; songs: number; is_public: boolean };
type SongRef = { track_id: string; value?: number; tracks: { id: string; title: string; cover_url: string | null; release_status: string | null; artists: { name: string } | null } | null };

const n0 = (x: number | null | undefined) => (x ?? 0).toLocaleString("en-GB");

function Head({ icon, title, href }: { icon: string; title: string; href?: string }) {
  return (
    <div className="sp-head lb-head">
      <h2><span className="sr-icon" aria-hidden="true">{icon}</span>{title}</h2>
      {href && <Link href={href}>View all →</Link>}
    </div>
  );
}

export default function LibraryPage() {
  const { loading } = useAuth();
  const user = usePersonalUser();
  const [stats, setStats] = useState<{ following: number; wanted: number; rated: number } | null>(null);
  const [lists, setLists] = useState<ListRow[] | null>(null);
  const [listCovers, setListCovers] = useState<Record<string, string>>({});
  const [wanted, setWanted] = useState<SongRef[] | null>(null);
  const [rated, setRated] = useState<SongRef[] | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    const me = user.id;
    Promise.all([
      supabase.from("follows").select("artist_id", { count: "exact", head: true }).eq("user_id", me),
      supabase.from("wanted_votes").select("track_id", { count: "exact", head: true }).eq("user_id", me),
      supabase.from("ratings").select("track_id", { count: "exact", head: true }).eq("user_id", me),
    ]).then(([f, w, r]) => setStats({ following: f.count ?? 0, wanted: w.count ?? 0, rated: r.count ?? 0 }));
    supabase.rpc("rpc_browse_lists", { p_kind: "mine" }).then(({ data }) => {
      const l = ((data ?? []) as ListRow[]);
      setLists(l);
      const ids = l.slice(0, 6).map((x) => x.id);
      if (ids.length) {
        supabase.from("song_list_items").select("list_id, tracks(cover_url)").in("list_id", ids).limit(300).then(({ data: items }) => {
          const m: Record<string, string> = {};
          for (const it of (items ?? []) as unknown as { list_id: string; tracks: { cover_url: string | null } | null }[]) {
            if (!m[it.list_id] && it.tracks?.cover_url) m[it.list_id] = it.tracks.cover_url;
          }
          setListCovers(m);
        });
      }
    });
    const cols = "track_id, tracks(id, title, cover_url, release_status, artists(name))";
    supabase.from("wanted_votes").select(cols).eq("user_id", me).order("created_at", { ascending: false }).limit(5)
      .then(({ data }) => setWanted((data as unknown as SongRef[]) ?? []));
    supabase.from("ratings").select(`value, ${cols}`).eq("user_id", me).order("updated_at", { ascending: false }).limit(5)
      .then(({ data }) => setRated((data as unknown as SongRef[]) ?? []));
  }, [loading, user?.id]);

  const songRow = (r: SongRef, tag: ReactNode) => r.tracks && (
    <Link key={r.track_id} href={`/song/${r.track_id}`} className="sp-version lb-song" data-st={r.tracks.release_status ?? ""}>
      {r.tracks.cover_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={r.tracks.cover_url} alt="" width={44} height={44} className="sp-thumb" loading="lazy" />
        : <span className="sp-thumb sp-thumb-empty">SC//</span>}
      <span className="sp-version-text">
        <span className="sp-version-title">{r.tracks.title}</span>
        <span className="sp-sub">{r.tracks.artists?.name ?? ""}</span>
      </span>
      {tag}
      <span aria-hidden="true" className="hf-chev">›</span>
    </Link>
  );

  return (
    <div className="wrap">
      <div className="sr-top">
        <div className="sr-title" aria-hidden="true">LIBRARY<span>//</span></div>
        <div className="rd-sub">Wanted / lists / ratings / local</div>
      </div>
      <h1 className="sr-h1">Library</h1>
      <div className="lb-lead">Your lists, the songs you&apos;re after, your ratings and your own files.</div>

      <nav className="rd-chips" aria-label="Library">
        <a href="#wanted">Wanted{stats ? ` (${n0(stats.wanted)})` : ""}</a>
        <a href="#lists">Lists{lists ? ` (${n0(lists.length)})` : ""}</a>
        <a href="#ratings">Ratings{stats ? ` (${n0(stats.rated)})` : ""}</a>
        <Link href="/local">Local Cuts</Link>
      </nav>

      {!loading && !user && (
        <div className="empty-state" style={{ marginTop: 18 }}>
          <Link href="/login" className="text-link">Log in</Link> to keep lists, mark songs you want and rate them. <Link href="/local" className="text-link">Local Cuts</Link> works without an account.
        </div>
      )}

      {user && (
        <>
          <div className="sp-head lb-head"><h2>Your numbers</h2></div>
          <div className="lb-stats">
            <Link href={`/profile/${user.id}`}><strong>{stats ? n0(stats.following) : "…"}</strong><span>artists followed</span></Link>
            <a href="#lists"><strong>{lists ? n0(lists.length) : "…"}</strong><span>lists</span></a>
            <a href="#wanted"><strong>{stats ? n0(stats.wanted) : "…"}</strong><span>wanted</span></a>
            <a href="#ratings"><strong>{stats ? n0(stats.rated) : "…"}</strong><span>rated</span></a>
          </div>

          <div className="hf-two">
            <section id="lists">
              <Head icon="≡" title={`Lists${lists ? ` (${lists.length})` : ""}`} href="/lists" />
              <div className="sp-versions">
                {lists && lists.length === 0 && <div className="comment-meta" style={{ padding: 12 }}>No lists yet. <Link href="/lists" className="text-link">Make one →</Link></div>}
                {(lists ?? []).slice(0, 6).map((l) => (
                  <Link key={l.id} href={`/list/${l.id}`} className="hf-trend lb-list">
                    {listCovers[l.id]
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={listCovers[l.id]} alt="" width={44} height={44} loading="lazy" />
                      : <span className="hf-trend-blank">≡</span>}
                    <span className="sp-version-text">
                      <span className="hf-trend-name">{l.title}</span>
                      <span className="sp-sub">{n0(l.songs)} song{l.songs === 1 ? "" : "s"}{l.is_public ? "" : " · private"}</span>
                    </span>
                    <span aria-hidden="true" className="hf-chev">›</span>
                  </Link>
                ))}
              </div>
            </section>
            <section id="wanted">
              <Head icon="◎" title={`Wanted${stats ? ` (${n0(stats.wanted)})` : ""}`} href="/wanted" />
              <div className="sp-versions">
                {wanted && wanted.length === 0 && <div className="comment-meta" style={{ padding: 12 }}>Tap the heart on an unreleased song to add it here.</div>}
                {(wanted ?? []).map((w) => songRow(w, <span className="feature-tag st lb-wanted">wanted</span>))}
              </div>
            </section>
          </div>

          <section id="ratings">
            <Head icon="☆" title={`Your ratings${stats ? ` (${n0(stats.rated)})` : ""}`} />
            <div className="sp-versions">
              {rated && rated.length === 0 && <div className="comment-meta" style={{ padding: 12 }}>Songs you rate show up here.</div>}
              {(rated ?? []).map((r) => songRow(r, <span className="lb-score">★ {r.value}/10</span>))}
            </div>
          </section>
        </>
      )}

      <Head icon="↓" title="Local Cuts" href="/local" />
      <Link href="/local" className="lb-card">
        <span className="lb-card-icon" aria-hidden="true">▢</span>
        <span className="sp-version-text">
          <strong>Your own files</strong>
          <span>Point it at your music folder: see which songs you have, which versions, and what you&apos;re missing.</span>
        </span>
        <span aria-hidden="true" className="hf-chev">›</span>
      </Link>

      <Link href="/collection/import" className="lb-card lb-import">
        <span className="lb-card-icon" aria-hidden="true">⛁</span>
        <span className="sp-version-text">
          <strong>Import collection</strong>
          <span>Bring in what you have from other places.</span>
        </span>
        <span className="lb-import-pills">
          <span>Spotify</span><span>Apple Music</span><span>File / CSV</span>
        </span>
      </Link>
    </div>
  );
}
