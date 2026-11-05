"use client";

// One producer: the artists they've worked with sliding behind the name, the
// numbers, who they've made the most songs for, and every song they're
// credited on (filter by status, sort, or pick an artist).

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeroCollage from "../../components/HeroCollage";

type Song = {
  track_id: string; title: string; artist_id: string; artist: string; status: string; release_date: string | null;
  album: string | null; spotify_url: string | null; cover_url: string | null; co_producers: string | null;
};
type Filter = "all" | "released" | "leaked" | "unreleased";
const UNRELEASED = ["unreleased", "snippet", "teased", "announced", "rumored", "unconfirmed"];
const n0 = (x: number) => x.toLocaleString("en-GB");

export default function ProducerPage() {
  const params = useParams<{ name: string }>();
  const name = decodeURIComponent(params.name);
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [artistFilter, setArtistFilter] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"recent" | "title" | "artist">("recent");
  const [q, setQ] = useState("");
  const [allArtists, setAllArtists] = useState(false);
  const [shown, setShown] = useState(80);

  useEffect(() => {
    supabase.rpc("rpc_producer", { p_name: name }).then(({ data }) => {
      const s = (data as Song[]) ?? [];
      setSongs(s);
      const ids = [...new Set(s.map((x) => x.artist_id))].slice(0, 200);
      if (ids.length) {
        supabase.from("artists").select("id, image_url").in("id", ids).then(({ data: a }) => {
          const m: Record<string, string> = {};
          for (const r of (a ?? []) as { id: string; image_url: string | null }[]) if (r.image_url) m[r.id] = r.image_url;
          setPhotos(m);
        });
      }
    });
  }, [name]);

  const artists = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number }>();
    (songs ?? []).forEach((s) => {
      const a = m.get(s.artist_id) ?? { id: s.artist_id, name: s.artist, n: 0 };
      a.n++;
      m.set(s.artist_id, a);
    });
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [songs]);

  const counts = useMemo(() => {
    const s = songs ?? [];
    return {
      all: s.length,
      released: s.filter((x) => x.status === "released").length,
      leaked: s.filter((x) => x.status === "leaked").length,
      unreleased: s.filter((x) => UNRELEASED.includes(x.status)).length,
    };
  }, [songs]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let l = (songs ?? []).filter((s) => (!artistFilter || s.artist_id === artistFilter)
      && (filter === "all" || (filter === "unreleased" ? UNRELEASED.includes(s.status) : s.status === filter))
      && (!needle || s.title.toLowerCase().includes(needle) || s.artist.toLowerCase().includes(needle)));
    if (sort === "recent") l = [...l].sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? ""));
    if (sort === "title") l = [...l].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "artist") l = [...l].sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
    return l;
  }, [songs, artistFilter, filter, sort, q]);

  const banner = artists.map((a) => photos[a.id]).filter(Boolean).slice(0, 24) as string[];

  return (
    <div className="wrap gn-page">
      <header className="pr-head">
        <div>
          <div className="pr-kicker"><Link href="/producers">Producer</Link><em>//</em></div>
          <h1 className="ls-title gn-title gn-one">{name}<span>//</span></h1>
        </div>
        <div className="gn-lead">
          <span>Songs, artists and unreleased material this producer is credited on.</span>
        </div>
      </header>

      {banner.length >= 3 && (
        <div className="pr-banner">
          <HeroCollage images={banner} className="pf-collage ah2-collage" />
        </div>
      )}

      {songs && songs.length > 0 && (
        <div className="pr-stats">
          <button onClick={() => { setFilter("all"); setArtistFilter(null); }}><em>///</em> Songs<strong>{n0(counts.all)}</strong></button>
          <button onClick={() => setAllArtists(true)}><em>///</em> Artists<strong>{n0(artists.length)}</strong></button>
          <button onClick={() => setFilter("leaked")}><em>///</em> Leaked<strong>{n0(counts.leaked)}</strong></button>
          <button onClick={() => setFilter("unreleased")}><em>///</em> Unreleased<strong>{n0(counts.unreleased)}</strong></button>
        </div>
      )}

      {artists.length > 0 && (
        <>
          <div className="gn-sec">
            <h2><em>///</em> Worked with<em>//</em></h2>
            <span>{n0(artists.length)} artist{artists.length === 1 ? "" : "s"}. Tap one to see just their songs.</span>
            {artists.length > 6 && <button className="pr-viewall" onClick={() => setAllArtists(!allArtists)}>{allArtists ? "Less" : "View all"} →</button>}
          </div>
          <div className="pr-artists">
            {artists.slice(0, allArtists ? 200 : 6).map((a) => (
              <button key={a.id} className={`pr-artist ${artistFilter === a.id ? "on" : ""}`} aria-pressed={artistFilter === a.id}
                style={photos[a.id] ? ({ "--img": `url("${photos[a.id]}")` } as CSSProperties) : undefined}
                onClick={() => setArtistFilter(artistFilter === a.id ? null : a.id)}>
                <span className="pr-artist-name">{a.name}</span>
                <span className="pr-artist-n">{n0(a.n)} song{a.n === 1 ? "" : "s"}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="gn-sec pr-songs-head">
        <h2><em>///</em> Songs<em>//</em></h2>
        <span>{artistFilter ? `${n0(list.length)} with ${artists.find((a) => a.id === artistFilter)?.name}` : `${n0(list.length)} song${list.length === 1 ? "" : "s"}`}</span>
      </div>
      <div className="pr-tools">
        <nav className="rd-chips rd-subchips" aria-label="Filter">
          {([["all", "All"], ["released", "Released"], ["leaked", "Leaked"], ["unreleased", "Unreleased"]] as [Filter, string][]).map(([k, label]) => (
            <button key={k} className={filter === k ? "on" : undefined} aria-pressed={filter === k} onClick={() => { setFilter(k); setShown(80); }}>{label} ({n0(counts[k])})</button>
          ))}
        </nav>
        <input className="sr-select pr-search" placeholder="Search songs…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search songs" />
        <select className="sr-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="recent">Sort: most recent</option>
          <option value="title">Sort: title</option>
          <option value="artist">Sort: artist</option>
        </select>
      </div>

      {!songs && <div className="empty-state">loading…</div>}
      {songs && songs.length === 0 && <div className="empty-state">No songs credited to {name} yet.</div>}
      {songs && songs.length > 0 && list.length === 0 && <div className="empty-state">Nothing matches.</div>}
      <ol className="lv-rows pr-rows">
        {list.slice(0, shown).map((s) => (
          <li key={s.track_id} className="lv-row" data-st={s.status}>
            <Link href={`/song/${s.track_id}`} className="lv-row-main">
              {s.cover_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={s.cover_url} alt="" width={56} height={56} loading="lazy" className="lv-cover" />
                : <span className="lv-cover lv-cover-blank">SC//</span>}
              <span className="lv-row-text">
                <span className="lv-row-title">{s.title}</span>
                <span className="lv-row-artist">{[s.artist, s.release_date?.slice(0, 4), s.co_producers ? `with ${s.co_producers}` : null].filter(Boolean).join(" · ")}</span>
              </span>
              <span className={`feature-tag st st-${s.status}`}>{s.status}</span>
            </Link>
            {s.spotify_url && <a className="lv-listen" href={s.spotify_url} target="_blank" rel="noopener noreferrer" aria-label="Listen on Spotify">↗</a>}
          </li>
        ))}
      </ol>
      {list.length > shown && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button className="tab" onClick={() => setShown(shown + 120)}>Show more ({n0(list.length - shown)})</button>
        </div>
      )}
    </div>
  );
}
