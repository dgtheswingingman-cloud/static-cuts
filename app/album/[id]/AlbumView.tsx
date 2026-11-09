"use client";
import "../../styles/album.css";
import "../../styles/editions.css";

// Album / EP page: cover, title, artist, date, length, label and the album's
// score (the average of its songs' average ratings), then the full tracklist
// in order with each song's status, versions and rating (rate right here),
// and more from the artist.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePersonalUser } from "../../useIsAdmin";
import ShareButton from "../../components/ShareButton";
import { thumb } from "@/lib/thumb";

type Row = {
  disk: number | null; position: number | null; title: string; artist: string | null; duration: number | null; explicit: boolean | null;
  track_id: string | null; site_title: string | null; status: string | null; artist_id: string | null;
  avg_rating: number | null; rating_count: number; versions: number; edition: string | null;
};
type Album = {
  id: string; title: string; kind: string; date: string | null; cover: string | null; label: string | null; link: string | null; songs: number | null;
  artist: { id: string; name: string; image: string | null };
  complete: boolean; length: number | null; score: number | null; rated: number; votes: number;
  tracks: Row[];
  more: { id: string; title: string; cover: string | null; date: string | null; kind: string }[];
  editions: { id: string; title: string; label: string; date: string | null; songs: number | null; extra: number }[];
};

const mmss = (s: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const long = (s: number | null) => {
  if (!s) return null;
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} hr ${m} min` : `${m} min`;
};
const niceDate = (d: string | null) => d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
// The album score shows once a few songs are rated, so one rating can't
// stand for a whole album.
const MIN_RATED = 3;

export default function AlbumView({ id }: { id: string }) {
  const user = usePersonalUser();
  const [a, setA] = useState<Album | null | undefined>(undefined);
  const [mine, setMine] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.rpc("rpc_album", { p_album: id });
    setA((data as Album | null) ?? null);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  // Which physical formats it came out on, from Discogs.
  const [press, setPress] = useState<{ formats: string[]; versions: number | null; url: string } | null>(null);
  useEffect(() => {
    setPress(null);
    supabase.rpc("rpc_album_discogs", { p_album: id }).then(({ data }) => setPress((data as typeof press) ?? null));
  }, [id]);

  const ids = useMemo(() => (a?.tracks ?? []).map((t) => t.track_id).filter(Boolean) as string[], [a]);
  useEffect(() => {
    if (!user || !ids.length) return;
    supabase.from("ratings").select("track_id, value").eq("user_id", user.id).in("track_id", ids)
      .then(({ data }) => setMine(Object.fromEntries((data ?? []).map((r) => [r.track_id, r.value]))));
  }, [user?.id, ids]);

  async function rate(trackId: string, value: number | null) {
    if (!user) return;
    setBusy(trackId);
    if (value == null) await supabase.from("ratings").delete().eq("user_id", user.id).eq("track_id", trackId);
    else await supabase.from("ratings").upsert({ user_id: user.id, track_id: trackId, value, updated_at: new Date().toISOString() });
    setMine((m) => { const n = { ...m }; if (value == null) delete n[trackId]; else n[trackId] = value; return n; });
    await load();
    setBusy(null);
  }

  if (a === undefined) return <div className="wrap al-page"><div className="empty-state">loading…</div></div>;
  if (a === null) return <div className="wrap al-page"><div className="empty-state">Album not found.</div></div>;

  const disks = [...new Set(a.tracks.map((t) => t.disk ?? 1))];
  const showScore = a.score != null && a.rated >= MIN_RATED;
  const kind = a.kind === "ep" ? "EP" : "Album";
  const onSite = a.tracks.filter((t) => t.track_id).length;

  return (
    <div className="wrap al-page">
      <div className="al-hero">
        <div className="al-cover">
          {a.cover
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={a.cover} alt={`${a.title} cover`} />
            : <span className="al-cover-blank">SC//</span>}
        </div>
        <div className="al-info">
          <div className="al-kind">{kind}<span>//</span></div>
          <h1 className="detail-name al-title">{a.title}</h1>
          <Link href={`/artist/${a.artist.id}`} className="al-artist">
            {a.artist.image
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={thumb(a.artist.image)} alt="" />
              : null}
            {a.artist.name}
          </Link>
          <div className="al-facts">
            {niceDate(a.date) && <span>{niceDate(a.date)}</span>}
            <span>{a.tracks.length || a.songs || 0} songs</span>
            {long(a.length) && <span>{long(a.length)}</span>}
            {a.label && <span>{a.label}</span>}
          </div>
          {a.editions.length > 1 && (
            <div className="al-editions">
              <span className="al-press-k">Editions</span>
              {a.editions.map((e) => (
                <span key={e.id} className="al-edition" title={e.title}>
                  {e.label}{e.extra > 0 && <small> +{e.extra}</small>}
                </span>
              ))}
            </div>
          )}
          {press && press.formats.length > 0 && (
            <div className="al-press">
              <span className="al-press-k">Pressed on</span>
              {press.formats.map((f) => <span key={f} className="al-press-f">{f}</span>)}
              <a href={press.url} target="_blank" rel="noopener noreferrer" className="al-press-link">
                {press.versions ? `${press.versions} version${press.versions === 1 ? "" : "s"} on Discogs` : "Discogs"} ↗
              </a>
            </div>
          )}

          <div className={`al-score ${showScore ? "" : "empty"}`}>
            <div className="al-score-n">{showScore ? a.score!.toFixed(1) : "–"}<small>/10</small></div>
            <div className="al-score-text">
              <b>Album rating</b>
              <span>
                {showScore
                  ? `Average of ${a.rated} of ${a.tracks.length} songs' ratings · ${a.votes} rating${a.votes === 1 ? "" : "s"}`
                  : a.rated > 0
                    ? `${a.rated} song${a.rated === 1 ? "" : "s"} rated so far. Shows once ${MIN_RATED} are.`
                    : "Not rated yet. Rate the songs below to build it."}
              </span>
            </div>
          </div>

          <div className="al-actions">
            <ShareButton title={`${a.title} — ${a.artist.name}`} path={`/album/${a.id}`} label="Share" className="st-btn" />
            <Link href={`/artist/${a.artist.id}`} className="st-btn">Artist page →</Link>
          </div>
        </div>
      </div>

      <section className="al-box">
        <div className="al-box-head">
          <h2>Tracklist</h2>
          <span className="al-num">{onSite} of {a.tracks.length} on the site</span>
        </div>
        {!a.complete && (
          <p className="al-note">The full tracklist for this {kind.toLowerCase()} is still being fetched from Deezer. These are the songs filed under it so far.</p>
        )}
        {disks.map((d) => (
          <div key={d}>
            {disks.length > 1 && <div className="al-disk">Disc {d}</div>}
            <ol className="al-tracks">
              {a.tracks.filter((t) => (t.disk ?? 1) === d).map((t, i) => {
                const name = t.site_title ?? t.title;
                const guest = t.artist && t.artist.toLowerCase() !== a.artist.name.toLowerCase() ? t.artist : null;
                return (
                  <li key={`${d}-${t.position ?? i}-${t.title}`} className={`al-row${t.track_id ? "" : " off"}`}>
                    <span className="al-pos">{t.position ?? i + 1}</span>
                    <span className="al-main">
                      {t.track_id
                        ? <Link href={`/song/${t.track_id}`} className="al-name">{name}</Link>
                        : <span className="al-name">{name}</span>}
                      <span className="al-sub">
                        {t.edition && <span className="al-ed-tag" title={`Only on the ${t.edition}`}>{t.edition}</span>}
                        {t.explicit && <span className="al-e" title="Explicit">E</span>}
                        {guest && <span>{guest}</span>}
                        {t.status && t.status !== "released" && <span className={`al-st st-${t.status}`}>{t.status}</span>}
                        {t.versions > 0 && t.track_id && <Link href={`/song/${t.track_id}`} className="al-vers">{t.versions} other version{t.versions === 1 ? "" : "s"}</Link>}
                        {!t.track_id && <span>not on the site yet</span>}
                      </span>
                    </span>
                    <span className="al-avg" title={t.rating_count ? `${t.rating_count} rating${t.rating_count === 1 ? "" : "s"}` : "No ratings yet"}>
                      {t.avg_rating != null ? Number(t.avg_rating).toFixed(1) : "–"}
                    </span>
                    {user && t.track_id ? (
                      <select className="al-rate" aria-label={`Rate ${name}`} disabled={busy === t.track_id}
                        value={mine[t.track_id] ?? ""} onChange={(e) => rate(t.track_id!, e.target.value ? Number(e.target.value) : null)}>
                        <option value="">Rate</option>
                        {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    ) : <span className="al-rate-blank" />}
                    <span className="al-len">{mmss(t.duration)}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
        {!user && <p className="al-note"><Link href={`/login?next=/album/${a.id}`} className="text-link">Log in</Link> to rate songs and build the album rating.</p>}
      </section>

      {a.more.length > 0 && (
        <section className="al-box">
          <div className="al-box-head"><h2>More from {a.artist.name}</h2></div>
          <div className="al-more">
            {a.more.slice(0, 12).map((m) => (
              <Link key={m.id} href={`/album/${m.id}`} className="al-more-card">
                {m.cover
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={thumb(m.cover)} alt="" loading="lazy" />
                  : <span className="al-cover-blank">SC//</span>}
                <b>{m.title}</b>
                <span>{[m.kind === "ep" ? "EP" : "Album", m.date?.slice(0, 4)].filter(Boolean).join(" · ")}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
