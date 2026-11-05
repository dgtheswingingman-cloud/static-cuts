"use client";

// One producer, laid out like a genre page: the artists they've worked with
// sliding behind the name, those artists as cards (tap one to see just their
// songs), then every song they're credited on.

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

  const banner = artists.map((a) => photos[a.id]).filter(Boolean).slice(0, 30) as string[];
  const picked = artists.find((a) => a.id === artistFilter);

  return (
    <div className="wrap gn-page">
      <header className={`lb-hero gn-hero ${banner.length >= 3 ? "has-collage" : ""}`}>
        {banner.length >= 3 && <HeroCollage images={banner} className="pf-collage ah2-collage" />}
        <div className="lb-hero-inner">
          <div className="ls-crumb"><Link href="/producers">Producers</Link> / <span>{name}</span></div>
          <span className="ah2-tag gn-tag">Producer//</span>
          <h1 className="ls-title gn-title gn-one">{name}<span>//</span></h1>
          {songs && songs.length > 0 && (
            <div className="gn-stats">
              <span><strong>{n0(counts.all)}</strong> songs</span>
              <span><strong>{n0(artists.length)}</strong> artists</span>
              {counts.leaked > 0 && <span><strong>{n0(counts.leaked)}</strong> leaked</span>}
              {counts.unreleased > 0 && <span><strong>{n0(counts.unreleased)}</strong> unreleased</span>}
            </div>
          )}
        </div>
      </header>

      {artists.length > 0 && (
        <>
          <div className="gn-sec">
            <h2><em>///</em> Worked with</h2>
            <span>{artistFilter ? "Tap again to show everyone." : "Tap an artist to see just their songs."}</span>
          </div>
          <div className="lb-artists">
            {artists.slice(0, allArtists ? 200 : 12).map((a) => (
              <button key={a.id} className={`lb-artist pr-pick ${artistFilter === a.id ? "on" : ""}`} aria-pressed={artistFilter === a.id}
                style={photos[a.id] ? ({ "--img": `url("${photos[a.id]}")` } as CSSProperties) : undefined}
                onClick={() => { setArtistFilter(artistFilter === a.id ? null : a.id); setShown(80); }}>
                <span className="lb-artist-name">{a.name}</span>
                <span className="lb-artist-meta">{n0(a.n)} song{a.n === 1 ? "" : "s"}</span>
              </button>
            ))}
          </div>
          {artists.length > 12 && (
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <button className="tab" onClick={() => setAllArtists(!allArtists)}>{allArtists ? "Show fewer" : `Show all ${n0(artists.length)}`}</button>
            </div>
          )}
        </>
      )}

      <div className="gn-sec">
        <h2><em>///</em> Songs</h2>
        <span>{picked ? `${n0(list.length)} with ${picked.name}` : `${n0(list.length)} song${list.length === 1 ? "" : "s"}`}</span>
      </div>
      <nav className="rd-chips gn-modes" aria-label="Filter">
        {([["all", "All"], ["released", "Released"], ["leaked", "Leaked"], ["unreleased", "Unreleased"]] as [Filter, string][]).map(([k, label]) => (
          <button key={k} className={filter === k ? "on" : undefined} aria-pressed={filter === k} onClick={() => { setFilter(k); setShown(80); }}>{label}</button>
        ))}
      </nav>
      <div className="lb-artist-tools">
        <input className="sr-select lb-filter" placeholder={`Filter ${name} songs…`} value={q} onChange={(e) => { setQ(e.target.value); setShown(80); }} aria-label="Filter songs" />
        <select className="sr-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="recent">Sort: most recent</option>
          <option value="title">Sort: title</option>
          <option value="artist">Sort: artist</option>
        </select>
      </div>

      {!songs && <div className="empty-state">loading…</div>}
      {songs && songs.length === 0 && <div className="empty-state">No songs credited to {name} yet.</div>}
      {songs && songs.length > 0 && list.length === 0 && <div className="empty-state">Nothing matches.</div>}
      <div className="sp-versions">
        {list.slice(0, shown).map((s) => (
          <Link key={s.track_id} href={`/song/${s.track_id}`} className="sp-version" data-st={s.status}>
            {s.cover_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={s.cover_url} alt="" width={48} height={48} className="sp-thumb" loading="lazy" />
              : <span className="sp-thumb sp-thumb-empty">SC//</span>}
            <span className="sp-version-text">
              <span className="sp-version-title">{s.title}</span>
              <span className="sp-sub">{[s.artist, s.album, s.co_producers ? `with ${s.co_producers}` : null].filter(Boolean).join(" · ")}</span>
            </span>
            <span className={`feature-tag st st-${s.status}`}>{s.status}</span>
            {s.release_date && <span className="ap-date">{s.release_date.slice(0, 4)}</span>}
          </Link>
        ))}
      </div>
      {list.length > shown && (
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <button className="tab" onClick={() => setShown(shown + 120)}>Show more ({n0(list.length - shown)})</button>
        </div>
      )}
    </div>
  );
}
