"use client";

// Era View: an artist's songs on a timeline, grouped by era (album or
// project; songs with no album go under their year). Leaks sit in the era
// they belong to, using their leak date.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { buildEras, dateOf, span, STATUS_ORDER, UNRELEASED, type Filter, type Song } from "@/lib/eras";
import { accentCss, deepCss, swatch, type Rgb } from "@/lib/swatch";

export default function ErasPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [artist, setArtist] = useState<{ id: string; name: string } | null>(null);
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [newestFirst, setNewestFirst] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Each era takes the main colour of its cover.
  const [colours, setColours] = useState<Record<string, Rgb>>({});

  useEffect(() => {
    supabase.rpc("rpc_artist_eras", { p_artist: id }).then(({ data }) => {
      const d = data as { artist: { id: string; name: string } | null; songs: Song[] } | null;
      setArtist(d?.artist ?? null);
      setSongs(d?.songs ?? []);
    });
  }, [id]);

  const eras = useMemo(() => {
    const keep = (songs ?? []).filter((s) =>
      filter === "all" || (filter === "released" ? s.status === "released" : UNRELEASED.includes(s.status)));
    const list = buildEras(keep);
    if (!newestFirst) return list;
    const undated = list.filter((e) => e.kind === "undated");
    return [...list.filter((e) => e.kind !== "undated").reverse(), ...undated];
  }, [songs, filter, newestFirst]);

  useEffect(() => {
    let alive = true;
    for (const e of eras) {
      if (!e.cover || colours[e.key]) continue;
      swatch(e.cover).then((rgb) => { if (alive && rgb) setColours((p) => ({ ...p, [e.key]: rgb })); });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eras]);

  const dated = (songs ?? []).filter((s) => dateOf(s) || s.album).length;

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push(`/artist/${id}`)}>← {artist?.name ?? "artist"}</button>
      <h1 className="detail-name page-title">{artist ? `${artist.name}: eras` : "Eras"}</h1>
      <div className="detail-meta">
        Songs grouped by era (album or project), oldest first. Leaks sit in their era by leak date; songs with no album go
        under their year.
        {songs && songs.length > 0 && ` ${dated} of ${songs.length} songs have an era or a date so far.`}
      </div>

      <div className="tabs">
        {(["all", "released", "unreleased"] as Filter[]).map((f) => (
          <button key={f} className={`tab ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
        <button className="tab" onClick={() => setNewestFirst(!newestFirst)}>{newestFirst ? "newest first" : "oldest first"}</button>
      </div>

      {!songs && <div className="empty-state">loading…</div>}
      {songs && eras.length === 0 && <div className="empty-state">No songs here yet.</div>}

      <div className="era-timeline">
        {eras.map((e) => {
          const counts = STATUS_ORDER.map((st) => [st, e.songs.filter((s) => s.status === st).length] as const).filter(([, n]) => n > 0);
          const isOpen = open.has(e.key) || e.songs.length <= 8;
          const shown = isOpen ? e.songs : e.songs.slice(0, 8);
          return (
            <section key={e.key} id={e.key} className={`era ${colours[e.key] ? "tinted" : ""}`}
              style={colours[e.key] ? ({ "--era": accentCss(colours[e.key]), "--era-deep": deepCss(colours[e.key], 0.45) } as CSSProperties) : undefined}>
              <div className="era-dot" aria-hidden />
              <div className="era-head">
                {e.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.cover} alt="" className="era-cover" width={84} height={84} loading="lazy" />
                ) : <div className="era-cover era-cover-empty" aria-hidden>{e.kind === "year" ? e.name : "—"}</div>}
                <div style={{ minWidth: 0 }}>
                  <div className="era-name">{e.name}</div>
                  <div className="review-row-meta">
                    {span(e) && e.kind !== "year" && <span>{span(e)}</span>}
                    <span>{e.songs.length} song{e.songs.length === 1 ? "" : "s"}</span>
                    {e.kind === "year" && <span>no album</span>}
                  </div>
                  <div className="review-row-meta" style={{ marginTop: 4 }}>
                    {counts.map(([st, n]) => <span key={st} className="feature-tag">{n} {st}</span>)}
                  </div>
                </div>
              </div>
              <ol className="era-songs">
                {shown.map((s) => (
                  <li key={s.id}>
                    <Link href={`/song/${s.id}`}>{s.title}</Link>
                    <span className="comment-meta">
                      {" "}· {s.status}
                      {s.status !== "released" && s.leak_date ? ` ${s.leak_date.slice(0, 4)}` : ""}
                      {s.versions > 0 ? ` · ${s.versions} version${s.versions === 1 ? "" : "s"}` : ""}
                    </span>
                    {s.spotify_url && <a className="listen-link" href={s.spotify_url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8 }}>listen</a>}
                  </li>
                ))}
              </ol>
              {!isOpen && (
                <button className="rating-chip" onClick={() => setOpen((p) => new Set(p).add(e.key))}>
                  show all {e.songs.length}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
