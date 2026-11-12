"use client";

// One person's credits, laid out like an artist page: the artists they've
// worked with sliding behind the name, the numbers, then tabs for an
// overview, every song they produced, the artists they produced for, and
// (when there are any) songs they're featured on and remixes they made. If they're an
// artist in the archive too, their own photo, colour and a link to that page;
// otherwise the colour comes from the artist they've made the most songs for.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeroCollage from "../../components/HeroCollage";
import ProducerAlert from "./ProducerAlert";
import { accentCss, deepCss, swatch, type Rgb } from "@/lib/swatch";
import { thumb } from "@/lib/thumb";

type Song = {
  track_id: string; title: string; artist_id: string; artist: string; status: string; release_date: string | null;
  album: string | null; spotify_url: string | null; cover_url: string | null; co_producers: string | null;
};
type Filter = "all" | "released" | "leaked" | "unreleased";
type Tab = "overview" | "songs" | "artists" | "features" | "remixes";
const UNRELEASED = ["unreleased", "snippet", "teased", "announced", "rumored", "unconfirmed"];
const n0 = (x: number) => x.toLocaleString("en-GB");

export default function ProducerPage() {
  const params = useParams<{ name: string }>();
  const name = decodeURIComponent(params.name);
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [rgb, setRgb] = useState<Rgb | null>(null);
  // If they're an artist in the archive too (a self-producing rapper), their own photo and page.
  const [self, setSelf] = useState<{ id: string; name: string; image_url: string | null } | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [artistFilter, setArtistFilter] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"recent" | "title" | "artist">("recent");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(80);
  const [other, setOther] = useState<{ features: Song[]; remixes: Song[] }>({ features: [], remixes: [] });

  useEffect(() => {
    let alive = true;
    setSongs(null); setPhotos({}); setRgb(null); setSelf(null);
    const selfP = supabase.rpc("rpc_producer_artist", { p_name: name }).then(({ data }) => {
      const me = ((data as { id: string; name: string; image_url: string | null }[]) ?? [])[0] ?? null;
      if (alive) setSelf(me);
      return me;
    });
    setOther({ features: [], remixes: [] });
    supabase.rpc("rpc_person_credits", { p_name: name }).then(({ data }) => {
      if (alive && data) setOther(data as { features: Song[]; remixes: Song[] });
    });
    supabase.rpc("rpc_producer", { p_name: name }).then(({ data }) => {
      if (!alive) return;
      const s = (data as Song[]) ?? [];
      setSongs(s);
      // Artists by how many songs this producer made for them.
      const n = new Map<string, number>();
      s.forEach((x) => n.set(x.artist_id, (n.get(x.artist_id) ?? 0) + 1));
      const ids = [...n.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 200);
      if (!ids.length) return;
      supabase.from("artists").select("id, image_url").in("id", ids).then(({ data: a }) => {
        if (!alive) return;
        const m: Record<string, string> = {};
        for (const r of (a ?? []) as { id: string; image_url: string | null }[]) if (r.image_url) m[r.id] = r.image_url;
        setPhotos(m);
        const topPhoto = ids.map((id) => m[id]).find(Boolean);
        selfP.then((me) => swatch(me?.image_url ?? topPhoto).then((c) => { if (alive) setRgb(c); }));
      });
    });
    return () => { alive = false; };
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

  const recent = useMemo(() => [...(songs ?? [])].filter((s) => s.release_date)
    .sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? "")), [songs]);

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

  const banner = [...new Set([...(self?.image_url ? [self.image_url] : []), ...artists.map((a) => photos[a.id]).filter(Boolean) as string[]])].slice(0, 30);
  const picked = artists.find((a) => a.id === artistFilter);
  const light = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light";
  const pageStyle = (rgb ? { "--accent": accentCss(rgb, light) } : {}) as CSSProperties;
  const heroStyle = (rgb ? { "--hero-deep": deepCss(rgb, 0.85) } : {}) as CSSProperties;

  const showSongs = (f: Filter, artist: string | null = null) => { setFilter(f); setArtistFilter(artist); setShown(80); setTab("songs"); };

  const row = (s: Song) => (
    <Link key={s.track_id} href={`/song/${s.track_id}`} className="sp-version ap-latest" data-st={s.status}>
      {s.cover_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={thumb(s.cover_url)} alt="" width={48} height={48} className="sp-thumb" loading="lazy" />
        : <span className="sp-thumb sp-thumb-empty">SC//</span>}
      <span className="sp-version-text">
        <span className="sp-version-title">{s.title}</span>
        <span className="sp-sub">{[s.artist, s.album, s.co_producers ? `with ${s.co_producers}` : null].filter(Boolean).join(" · ")}</span>
      </span>
      <span className={`feature-tag st st-${s.status}`}>{s.status}</span>
      {s.release_date && <span className="ap-date">{s.release_date.slice(0, 4)}</span>}
    </Link>
  );

  const artistRow = (a: { id: string; name: string; n: number }, i: number) => (
    <div key={a.id} className="ap-collab">
      <button className="ap-collab-row" onClick={() => showSongs("all", a.id)}>
        <span className="ap-collab-rank">{String(i + 1).padStart(2, "0")}</span>
        {photos[a.id]
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={thumb(photos[a.id])} alt="" width={44} height={44} className="sp-thumb ap-collab-photo" loading="lazy" />
          : <span className="sp-thumb sp-thumb-empty ap-collab-photo">{a.name.slice(0, 2).toUpperCase()}</span>}
        <span className="sp-version-text">
          <span className="sp-version-title">{a.name}</span>
          <span className="sp-sub">{a.n} song{a.n === 1 ? "" : "s"} together</span>
        </span>
        <span className="ap-collab-count">{a.n}</span>
      </button>
    </div>
  );

  return (
    <div className="wrap artist-page" style={pageStyle}>
      <header className={`artist-hero ah2 ${banner.length ? "has-img" : ""} ${banner.length >= 3 ? "ah2-has-collage" : ""}`} style={heroStyle}>
        {banner.length >= 3 && <HeroCollage images={banner} className="pf-collage ah2-collage" />}
        {banner.length > 0 && banner.length < 3 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={banner[0]} alt="" className="ah2-img" />
        )}
        <div className="artist-hero-inner ah2-inner">
          <span className="ah2-tag">
            {songs && songs.length === 0 && (other.features.length || other.remixes.length)
              ? (other.remixes.length >= other.features.length ? "Remixer" : "Featured artist")
              : <Link href="/producers" style={{ color: "inherit", textDecoration: "none" }}>Producer</Link>}
          </span>
          <div className="ah2-id">
            {self?.image_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={thumb(self.image_url)} alt="" className="ah2-pfp" width={96} height={96} />
              : <span className="ah2-pfp pr-pfp-blank" aria-hidden="true">{name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "SC"}</span>}
            <h1 className="detail-name artist-hero-name">{name}</h1>
          </div>
          {artists.length > 0 && <div className="ah2-genres">for {artists.slice(0, 3).map((a) => a.name).join(" / ")}</div>}
          <div className="ah2-stats">
            <button onClick={() => showSongs("all")}><strong>{songs ? n0(counts.all) : "…"}</strong><span>songs</span></button>
            <button onClick={() => setTab("artists")}><strong>{songs ? n0(artists.length) : "…"}</strong><span>artists</span></button>
            <button onClick={() => showSongs("leaked")}><strong>{songs ? n0(counts.leaked) : "…"}</strong><span>leaked</span></button>
            <button onClick={() => showSongs("unreleased")}><strong>{songs ? n0(counts.unreleased) : "…"}</strong><span>unreleased</span></button>
          </div>
        </div>
      </header>

      <div className="artist-actions ah2-actions">
        <ProducerAlert name={name} />
        {self && <Link href={`/artist/${self.id}`} className="tab">Artist page →</Link>}
      </div>

      <nav className="ap-tabs" aria-label="Producer sections">
        {([["overview", "Overview"], ["songs", "Produced"], ["artists", "Artists"],
           ...(other.features.length ? [["features", `Features (${n0(other.features.length)})`]] : []),
           ...(other.remixes.length ? [["remixes", `Remixes (${n0(other.remixes.length)})`]] : [])] as [Tab, string][]).map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : undefined} aria-pressed={tab === k}
            onClick={() => { if (k === "songs") showSongs("all"); else setTab(k); }}>{label}</button>
        ))}
      </nav>

      {!songs && <div className="empty-state">loading…</div>}
      {songs && songs.length === 0 && !other.features.length && !other.remixes.length && <div className="empty-state">No songs credited to {name} yet.</div>}
      {songs && songs.length === 0 && (other.features.length > 0 || other.remixes.length > 0) && tab !== "features" && tab !== "remixes" && (
        <div className="empty-state">
          No production credits.{" "}
          <button className="text-link" onClick={() => setTab(other.features.length ? "features" : "remixes")}>See their {other.features.length ? "features" : "remixes"} →</button>
        </div>
      )}

      {tab === "features" && (
        <>
          <div className="sp-head"><h2>Featured on ({n0(other.features.length)})</h2></div>
          <div className="sp-versions">{other.features.map(row)}</div>
        </>
      )}
      {tab === "remixes" && (
        <>
          <div className="sp-head"><h2>Remixes ({n0(other.remixes.length)})</h2></div>
          <div className="sp-versions">{other.remixes.map(row)}</div>
        </>
      )}

      {songs && songs.length > 0 && tab === "overview" && (
        <>
          <div className="sp-head">
            <h2>Latest</h2>
            <button onClick={() => showSongs("all")}>View all →</button>
          </div>
          <div className="sp-versions">{(recent.length ? recent : songs).slice(0, 6).map(row)}</div>

          <div className="sp-head">
            <h2>Worked with</h2>
            {artists.length > 5 && <button onClick={() => setTab("artists")}>View all →</button>}
          </div>
          <div className="sp-versions">{artists.slice(0, 5).map(artistRow)}</div>
        </>
      )}

      {songs && songs.length > 0 && tab === "artists" && (
        <>
          <div className="sp-head"><h2>Artists ({artists.length})</h2></div>
          <div className="sp-versions">{artists.map(artistRow)}</div>
        </>
      )}

      {songs && songs.length > 0 && tab === "songs" && (
        <>
          <div className="sp-head">
            <h2>{picked ? `With ${picked.name}` : "Songs"} ({n0(list.length)})</h2>
            {picked && <button onClick={() => setArtistFilter(null)}>Show everyone ✕</button>}
          </div>
          <nav className="rd-chips" aria-label="Filter" style={{ marginBottom: 10 }}>
            {([["all", "All"], ["released", "Released"], ["leaked", "Leaked"], ["unreleased", "Unreleased"]] as [Filter, string][]).map(([k, label]) => (
              <button key={k} className={filter === k ? "on" : undefined} aria-pressed={filter === k} onClick={() => { setFilter(k); setShown(80); }}>{label}</button>
            ))}
          </nav>
          <div className="lb-artist-tools">
            <input className="sr-select lb-filter" placeholder="Filter songs…" value={q} onChange={(e) => { setQ(e.target.value); setShown(80); }} aria-label="Filter songs" />
            <select className="sr-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
              <option value="recent">Sort: most recent</option>
              <option value="title">Sort: title</option>
              <option value="artist">Sort: artist</option>
            </select>
          </div>
          {list.length === 0 && <div className="empty-state">Nothing matches.</div>}
          <div className="sp-versions">{list.slice(0, shown).map(row)}</div>
          {list.length > shown && (
            <div style={{ textAlign: "center", marginTop: 18 }}>
              <button className="tab" onClick={() => setShown(shown + 120)}>Show more ({n0(list.length - shown)})</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
