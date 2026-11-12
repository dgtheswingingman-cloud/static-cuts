"use client";

// My Library: the artists you follow (with how much of each you've
// collected), your lists, Local Cuts (your own files) and importing from
// Spotify / Apple Music / a file. The homepage shows the whole archive; your
// artists live here.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { usePersonalUser } from "../useIsAdmin";
import HeroCollage from "../components/HeroCollage";
import ExportCard from "./ExportCard";
import { thumb } from "@/lib/thumb";
import Missing from "../components/Missing";
import { usePremium } from "../usePremium";

type ListRow = { id: string; title: string; songs: number; is_public: boolean };
type Mine = { id: string; name: string; track_count: number; collected: number };

const n0 = (x: number | null | undefined) => (x ?? 0).toLocaleString("en-GB");

export default function LibraryPage() {
  const { loading } = useAuth();
  const user = usePersonalUser();
  const { premium } = usePremium();
  const [showMissing, setShowMissing] = useState(false);
  const [follows, setFollows] = useState<{ artist_id: string; pinned: boolean }[] | null>(null);
  const [artistRows, setArtistRows] = useState<Mine[] | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [lists, setLists] = useState<ListRow[] | null>(null);
  const [listCovers, setListCovers] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<"name" | "pct" | "songs">("name");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (loading || !user) return;
    supabase.from("follows").select("artist_id, pinned").eq("user_id", user.id).then(({ data }) => {
      const f = (data ?? []) as { artist_id: string; pinned: boolean }[];
      setFollows(f);
      const ids = f.map((x) => x.artist_id);
      for (let i = 0; i < ids.length; i += 200) {
        supabase.from("artists").select("id, image_url").in("id", ids.slice(i, i + 200)).then(({ data: a }) => {
          const m: Record<string, string> = {};
          for (const r of (a ?? []) as { id: string; image_url: string | null }[]) if (r.image_url) m[r.id] = r.image_url;
          setPhotos((p) => ({ ...p, ...m }));
        });
      }
    });
    // Song counts and how many you've collected, per artist.
    supabase.rpc("rpc_home_artists", { p_mine: true }).then(({ data }) => setArtistRows((data as Mine[]) ?? []));
    supabase.rpc("rpc_browse_lists", { p_kind: "mine" }).then(({ data }) => {
      const l = ((data ?? []) as ListRow[]);
      setLists(l);
      const ids = l.slice(0, 8).map((x) => x.id);
      if (ids.length) {
        supabase.from("song_list_items").select("list_id, tracks(cover_url)").in("list_id", ids).limit(400).then(({ data: items }) => {
          const m: Record<string, string> = {};
          for (const it of (items ?? []) as unknown as { list_id: string; tracks: { cover_url: string | null } | null }[]) {
            if (!m[it.list_id] && it.tracks?.cover_url) m[it.list_id] = it.tracks.cover_url;
          }
          setListCovers(m);
        });
      }
    });
  }, [loading, user?.id]);

  const mine = useMemo(() => {
    if (!follows || !artistRows) return null;
    const pinned = new Set(follows.filter((f) => f.pinned).map((f) => f.artist_id));
    const ids = new Set(follows.map((f) => f.artist_id));
    const needle = filter.trim().toLowerCase();
    const pct = (a: Mine) => (a.track_count ? a.collected / a.track_count : 0);
    return artistRows.filter((a) => ids.has(a.id) && (!needle || a.name.toLowerCase().includes(needle)))
      .sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id))
        || (sort === "pct" ? pct(b) - pct(a) : sort === "songs" ? b.track_count - a.track_count : a.name.localeCompare(b.name)))
      .map((a) => ({ ...a, pinned: pinned.has(a.id) }));
  }, [follows, artistRows, sort, filter]);

  // Your artists' photos sliding behind the title (pinned ones first).
  const bannerPhotos = (mine ?? []).map((a) => photos[a.id]).filter(Boolean).slice(0, 24);
  const collectedTotal = (mine ?? []).reduce((t, a) => t + a.collected, 0);
  const songsTotal = (mine ?? []).reduce((t, a) => t + a.track_count, 0);

  return (
    <div className="wrap">
      <header className={`lb-hero ${bannerPhotos.length >= 3 ? "has-collage" : ""}`}>
        {bannerPhotos.length >= 3 && <HeroCollage images={bannerPhotos} className="pf-collage ah2-collage" />}
        <div className="sr-top lb-hero-inner">
          <div className="sr-title" aria-hidden="true">MY LIBRARY<span>//</span></div>
          <div className="rd-sub">Artists / lists / local / import</div>
        </div>
      </header>
      <h1 className="sr-h1">My Library</h1>
      <div className="lb-lead">The artists you follow, your lists, your own files and imports.</div>

      {!loading && !user && (
        <div className="empty-state" style={{ marginTop: 18 }}>
          <Link href="/login" className="text-link">Log in</Link> to follow artists, track what you&apos;ve collected and keep lists. <Link href="/local" className="text-link">Local Cuts</Link> works without an account.
        </div>
      )}

      {user && (
        <>
          <div className="lb-stats">
            <a href="#artists"><strong>{follows ? n0(follows.length) : "…"}</strong><span>artists followed</span></a>
            <a href="#artists"><strong>{mine ? `${songsTotal ? Math.round((collectedTotal / songsTotal) * 100) : 0}%` : "…"}</strong><span>collected</span></a>
            <a href="#lists"><strong>{lists ? n0(lists.length) : "…"}</strong><span>lists</span></a>
          </div>

          <section id="artists">
            <div className="sp-head lb-head">
              <h2><span className="sr-icon" aria-hidden="true">☺</span>Artists you follow{follows ? ` (${n0(follows.length)})` : ""}</h2>
            </div>
            {follows && follows.length > 0 && (
              <div className="lb-artist-tools">
                <input className="sr-select lb-filter" placeholder="Filter your artists…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter your artists" />
                <select className="sr-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
                  <option value="name">Sort: A–Z</option>
                  <option value="pct">Sort: most collected</option>
                  <option value="songs">Sort: most songs</option>
                </select>
              </div>
            )}
            {follows && follows.length === 0 && (
              <div className="comment-meta">You&apos;re not following anyone yet. <Link href="/" className="text-link">Browse the archive</Link> or <Link href="/start" className="text-link">pick a few artists</Link>.</div>
            )}
            {follows && follows.length > 0 && !mine && <div className="empty-state">loading…</div>}
            {mine && (
              <div className="lb-artists">
                {mine.map((a) => {
                  const pct = a.track_count ? Math.round((a.collected / a.track_count) * 100) : 0;
                  return (
                    <Link key={a.id} href={`/artist/${a.id}`} className="lb-artist" style={photos[a.id] ? ({ "--img": `url("${photos[a.id]}")` } as CSSProperties) : undefined}>
                      <span className="lb-artist-name">{a.name}{a.pinned && <span className="lb-pin" title="Pinned">●</span>}</span>
                      <span className="lb-artist-meta">{n0(a.collected)} / {n0(a.track_count)} songs · {pct}%</span>
                      <span className="lb-bar"><span style={{ width: `${pct}%` }} /></span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <section id="lists">
            <div className="sp-head lb-head">
              <h2><span className="sr-icon" aria-hidden="true">≡</span>Your lists{lists ? ` (${lists.length})` : ""}</h2>
              <Link href="/lists">All lists →</Link>
            </div>
            <div className="sp-versions">
              {lists && lists.length === 0 && <div className="comment-meta" style={{ padding: 12 }}>No lists yet. <Link href="/lists" className="text-link">Make one →</Link></div>}
              {(lists ?? []).slice(0, 8).map((l) => (
                <Link key={l.id} href={`/list/${l.id}`} className="hf-trend lb-list">
                  {listCovers[l.id]
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={thumb(listCovers[l.id])} alt="" width={44} height={44} loading="lazy" />
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
        </>
      )}

      {user && collectedTotal > 0 && (
        <section id="missing">
          {showMissing
            ? <Missing collection premium={!!premium} intro="From your collection: every artist you have 3+ songs of, era by era." />
            : (
              <button className="lb-card lb-missing" onClick={() => setShowMissing(true)}>
                <span className="sp-version-text">
                  <strong>What you&apos;re missing</strong>
                  <span>See how much of each artist you have, era by era, and which songs you don&apos;t have yet.</span>
                </span>
                <span aria-hidden="true" className="hf-chev">›</span>
              </button>
            )}
        </section>
      )}

      <section>
        <div className="sp-head lb-head"><h2><span className="sr-icon" aria-hidden="true">▢</span>Local Cuts</h2></div>
        <Link href="/local" className="lb-card">
          <span className="sp-version-text">
            <strong>Your own files</strong>
            <span>Point it at your music folder: see which songs you have, which versions, and what you&apos;re missing. Your files never leave your device.</span>
          </span>
          <span aria-hidden="true" className="hf-chev">›</span>
        </Link>
      </section>

      <section>
        <div className="sp-head lb-head"><h2><span className="sr-icon" aria-hidden="true">⇅</span>Import &amp; export</h2></div>
        <Link href="/collection/import" className="lb-card lb-import">
          <span className="sp-version-text">
            <strong>From other services</strong>
            <span>Mark what you already have, from your Spotify, Apple Music or a file.</span>
          </span>
          <span className="lb-import-pills">
            <span>Spotify</span><span>Apple Music</span><span>File / CSV</span>
          </span>
        </Link>
        {user && <ExportCard userId={user.id} />}
      </section>
    </div>
  );
}
