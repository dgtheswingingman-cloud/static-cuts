"use client";

// Everything about one song: info, listen link, the other versions of it,
// status history, who added it, collecting, rating and comments.

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { accentCss, deepCss, swatch, type Rgb } from "@/lib/swatch";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import TrackComments from "../../artist/[id]/TrackComments";
import FanCovers from "./FanCovers";
import SongTimeline, { type AutoEvent } from "./SongTimeline";
import RealOrFake, { VOTEABLE_STATUSES } from "./RealOrFake";
import AddToList from "./AddToList";
import RemindMe from "./RemindMe";
import InlinePlayer from "../../components/InlinePlayer";
import FileNote from "./FileNote";
import MyFile from "./MyFile";
import ShareButton from "../../components/ShareButton";
import { useIsAdmin, usePersonalUser } from "../../useIsAdmin";
import AdminModeNote from "../../components/AdminModeNote";
import FriendsWhoHaveIt from "./FriendsWhoHaveIt";
import { likeOnSpotify } from "@/lib/spotifyLikes";
import Supporter from "../../components/Supporter";

type Track = {
  id: string;
  title: string;
  artist_id: string;
  spotify_url: string | null;
  deezer_url?: string | null;
  apple_url?: string | null;
  // Released under another name of the artist's (e.g. "Archy Marshall").
  credited_as?: string | null;
  length_sec?: number | null;
  parent_track_id: string | null;
  is_featured: boolean;
  is_official: boolean;
  aliases: string | null;
  track_number: number | null;
  release_date: string | null;
  leak_date?: string | null;
  cover_url?: string | null;
  // What to show: the song's own art, a fan cover or a photo of the artist.
  display_cover?: { url: string; kind: "own" | "fan" | "artist" } | null;
  producers: string | null;
  writers?: string | null;
  label?: string | null;
  isrc?: string | null;
  explicit?: boolean | null;
  genre: string | null;
  notes: string | null;
  album: string | null;
  release_status: string | null;
  created_at: string | null;
  source: string | null;
  source_url: string | null;
  status_source?: string | null;
  status_source_url?: string | null;
  spotify_verified_at?: string | null;
};
type Relation = { kind: string; title: string; artist: string | null; url: string | null; track_id: string | null };
const RELATION_LABELS: Record<string, string> = {
  samples: "Samples", sampled_in: "Sampled in", interpolates: "Interpolates", interpolated_by: "Interpolated in",
  remix_of: "Remix of", remixed_by: "Remixed in", cover_of: "Cover of", covered_by: "Covered by",
};

type Version = { id: string; title: string; release_status: string | null; is_official: boolean; spotify_url: string | null; is_main: boolean };
type Song = {
  redirect?: string;
  track: Track;
  artist: { id: string; name: string } | null;
  family: Version[];
  appears_on: { id: string; name: string }[];
  history: { from: string | null; to: string; at: string; note?: string | null; by_suggestion?: boolean }[];
  added_by: { id: string; name: string } | null;
  collectors: number;
  comments: number;
  owned: boolean;
  my_rating: number | null;
  rating: { avg?: number; count: number } | null;
};

const SOURCE_NAMES: Record<string, string> = { spotify: "Spotify", genius: "Genius", lastfm: "Last.fm", sheet: "Community sheet" };

function statusOf(t: { release_status: string | null; is_official: boolean }) {
  return t.release_status ?? (t.is_official ? "released" : "unconfirmed");
}

// How sure we are of a song's status, in plain words. Kept separate from
// the status itself: "leaked" from a careful tracker and "leaked" that
// nobody has checked aren't the same thing.
function trustOf(t: Track): { level: "confirmed" | "sourced" | "reported" | "unverified"; label: string; title: string } {
  const status = statusOf(t);
  if (status === "released" && /open\.spotify\.com/.test(t.spotify_url ?? "")) {
    return { level: "confirmed", label: "✓ confirmed on Spotify", title: "This song is on Spotify, so it's officially out." };
  }
  if (status === "unconfirmed") {
    return { level: "unverified", label: "unverified", title: "Nobody has confirmed whether this song is out, leaked or unreleased yet." };
  }
  if (t.status_source) {
    return { level: "sourced", label: `per ${t.status_source}`, title: "The status comes from this community tracker." };
  }
  return { level: "reported", label: "community-reported", title: "Added or approved by the community; no outside source recorded." };
}

function formatDate(d: string, withYear = true) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}

export default function SongView({ id }: { id: string }) {
  const { loading: authLoading } = useAuth();
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [song, setSong] = useState<Song | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [sheet, setSheet] = useState<{ title: string; credit: string | null; url: string } | null>(null);
  const [more, setMore] = useState(false);
  const [listenOpen, setListenOpen] = useState(false);
  const [allComments, setAllComments] = useState(false);
  // The page's colour, taken from the cover (like artist pages).
  const [rgb, setRgb] = useState<Rgb | null>(null);
  const coverUrl = song?.track.display_cover?.url ?? song?.track.cover_url ?? null;
  useEffect(() => {
    let alive = true;
    setRgb(null);
    swatch(coverUrl).then((c) => { if (alive) setRgb(c); });
    return () => { alive = false; };
  }, [coverUrl]);

  async function load() {
    const { data, error } = await supabase.rpc("rpc_song_page", { p_id: id });
    if (error || !data) { setMissing(true); return; }
    const s = data as Song;
    if (s.redirect) { router.replace(`/song/${s.redirect}`); return; }
    setSong(s);
    if (s.track.source === "sheet" && s.track.source_url) {
      supabase.rpc("rpc_sheet_credit", { p_url: s.track.source_url }).then(({ data: c }) => setSheet(c ?? null));
    }
  }

  // Samples, interpolations, remixes and covers (from Genius).
  const [relations, setRelations] = useState<Relation[]>([]);
  useEffect(() => {
    supabase.rpc("rpc_track_relations", { p_track: id }).then(({ data }) => setRelations((data as Relation[]) ?? []));
  }, [id]);

  useEffect(() => {
    if (!authLoading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, authLoading, user?.id]);

  async function toggleOwned() {
    if (!user) { if (!isAdmin) router.push("/login"); return; }
    if (!song) return;
    setBusy(true);
    const { error } = song.owned
      ? await supabase.from("track_ownership").delete().eq("user_id", user.id).eq("track_id", song.track.id)
      : await supabase.from("track_ownership").insert({ user_id: user.id, track_id: song.track.id });
    setBusy(false);
    if (!error) {
      // Collecting also saves it to Spotify Liked Songs, if that's switched on in Settings.
      if (!song.owned) likeOnSpotify(song.track.spotify_url).catch(() => {});
      setSong({ ...song, owned: !song.owned, collectors: song.collectors + (song.owned ? -1 : 1) });
    }
  }

  async function rate(value: number | null) {
    if (!user) { if (!isAdmin) router.push("/login"); return; }
    if (!song) return;
    const { error } = value === null
      ? await supabase.from("ratings").delete().eq("user_id", user.id).eq("track_id", song.track.id)
      : await supabase.from("ratings").upsert({ user_id: user.id, track_id: song.track.id, value, updated_at: new Date().toISOString() });
    setRateOpen(false);
    if (!error) load();
  }


  if (missing) {
    return (
      <div className="wrap">
        <div className="empty-state" style={{ marginTop: 30 }}>This song isn&apos;t in the archive (it may have been deleted).</div>
      </div>
    );
  }
  if (!song) return <div className="wrap"><div className="empty-state">loading…</div></div>;

  const t = song.track;
  const artistId = song.artist?.id ?? t.artist_id;
  const main = song.family.find((v) => v.is_main);

  const info: [string, ReactNode][] = [];
  if (t.aliases) info.push(["Also known as", t.aliases]);
  if (t.album) info.push(["Album", t.album]);
  if (t.track_number) info.push(["Track number", String(t.track_number)]);
  if (t.release_date) info.push(["Release date", formatDate(t.release_date)]);
  if (t.leak_date) info.push(["Leaked", formatDate(t.leak_date)]);
  if (t.length_sec) info.push(["Length", `${Math.floor(t.length_sec / 60)}:${String(t.length_sec % 60).padStart(2, "0")}`]);
  if (t.producers) {
    const names = t.producers.split(/\s*(?:,|&|\band\b|\+|\/)\s*/i).map((x) => x.trim()).filter(Boolean);
    info.push(["Producers", (
      <span>
        {names.map((n, i) => (
          <span key={n}>{i > 0 && ", "}<Link href={`/producer/${encodeURIComponent(n)}`} className="text-link">{n}</Link></span>
        ))}
      </span>
    )]);
  }
  if (t.writers) info.push(["Written by", t.writers]);
  if (t.label) info.push(["Label", t.label]);
  if (t.isrc) info.push(["ISRC", <span title="The recording's official code" style={{ fontFamily: "var(--font-mono, monospace)" }}>{t.isrc}</span>]);
  if (song.appears_on.length > 0) {
    info.push(["Featuring", (
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {song.appears_on.map((a) => <Link key={a.id} href={`/artist/${a.id}`} className="feature-tag" style={{ textDecoration: "none" }}>{a.name}</Link>)}
      </span>
    )]);
  }
  if (t.genre) info.push(["Genre", t.genre]);
  if (t.notes) info.push(["Notes", <span style={{ whiteSpace: "pre-wrap" }}>{t.notes}</span>]);
  if (song.added_by) {
    info.push(["Added by", (
      <span>
        <Link href={`/profile/${song.added_by.id}`} className="text-link">{song.added_by.name}</Link><Supporter id={song.added_by.id} />
        {t.created_at && <span className="comment-meta"> · {formatDate(t.created_at)}</span>}
      </span>
    )]);
  }
  if (t.source === "sheet" && sheet) {
    info.push(["Source", (
      <span>
        from <a href={sheet.url} target="_blank" rel="noopener noreferrer" className="text-link">{sheet.title} ↗</a>
        {sheet.credit && <>, by {sheet.credit}</>}
        <span className="comment-meta"> · <Link href="/sources" className="text-link">all sources</Link></span>
      </span>
    )]);
  } else if (t.source) {
    const name = SOURCE_NAMES[t.source] ?? t.source;
    info.push(["Source", t.source_url
      ? <a href={t.source_url} target="_blank" rel="noopener noreferrer" className="text-link">{name} ↗</a>
      : name]);
  }

  // The known dates and every status change the site has recorded; the
  // timeline adds the moments fans add (snippets, shows, interviews…).
  const timeline: AutoEvent[] = [
    ...(t.leak_date ? [{ at: t.leak_date, kind: "leak" as const, text: <>Leaked</> }] : []),
    ...(t.release_date ? [{ at: t.release_date, kind: "release" as const, text: <>Released{t.album ? <> on {t.album}</> : null}</> }] : []),
    ...song.history.map((h) => ({
      at: h.at, site: true,
      text: h.from ? <>marked {h.from} → <strong>{h.to}</strong></> : <>added as <strong>{h.to}</strong></>,
      note: h.note ?? (h.by_suggestion ? "from an approved suggestion" : null),
    })),
  ];

  const cover = t.display_cover?.url ?? t.cover_url ?? null;
  const status = statusOf(t);
  const firstSeen = t.leak_date ?? t.release_date ?? t.created_at;
  const listen = [
    t.spotify_url ? { name: "Spotify", url: t.spotify_url } : null,
    t.deezer_url ? { name: "Deezer", url: t.deezer_url } : null,
    t.apple_url ? { name: "Apple Music", url: t.apple_url } : null,
  ].filter(Boolean) as { name: string; url: string }[];
  const themeStyle = (rgb ? { "--accent": accentCss(rgb, typeof document !== "undefined" && document.documentElement.dataset.theme === "light"), "--sp-deep": deepCss(rgb, 0.85) } : {}) as CSSProperties;
  const Dots = () => <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>;

  return (
    <div className={`wrap song-page ${rgb ? "themed" : ""}`} style={themeStyle}>
      <section className={`sp-hero ${cover ? "has-img" : ""}`}>
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="sp-hero-img"
            title={t.display_cover?.kind === "fan" ? "Cover picked by fans" : t.display_cover?.kind === "artist" ? "No cover yet: a photo of the artist" : undefined} />
        )}
        <div className="sp-hero-inner">
          <Link href={`/artist/${artistId}?highlight=${t.id}`} className="back-btn">← {song.artist?.name ?? "artist"}</Link>
          <div className="sp-tags">
            <span className={`feature-tag st st-${status}`}>{status}</span>
            {t.explicit && <span className="feature-tag sp-tag-line" title="Explicit">E</span>}
            {t.is_featured && <span className="feature-tag sp-tag-line">featured</span>}
          </div>
          <h1 className="detail-name song-title">{t.title}</h1>
          <div className="sp-artist">
            <Link href={`/artist/${artistId}`}>{song.artist?.name ?? "Unknown artist"}</Link>
            {t.credited_as && <span className="sp-sub"> as {t.credited_as}</span>}
          </div>
          {(t.album || (main && main.id !== t.id)) && (
            <div className="sp-sub">
              {t.album}
              {t.album && main && main.id !== t.id && " · "}
              {main && main.id !== t.id && <>version of <Link href={`/song/${main.id}`} className="text-link">{main.title}</Link></>}
            </div>
          )}
        </div>
      </section>

      <div className="sp-actions">
        {!isAdmin && (
          <button className={`tab sp-main-btn ${song.owned ? "owned" : ""}`} disabled={busy} onClick={toggleOwned} aria-pressed={song.owned}>
            {song.owned ? "✓ In your library" : "+ Add to library"}
          </button>
        )}
        <ShareButton title={`${t.title} · Static Cuts//`} path={`/song/${t.id}`} storyKey={t.id} className="tab sp-icon-btn" ariaLabel="Share"
          label={<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 5l7 6-7 6v-3.5c-5 0-8.5 1.5-11 5 1-5 4-9.5 11-10.5z" /></svg>}
          fileName={`static-cuts-${t.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`} story={() => ({
          kicker: `${status} · ${song.artist?.name ?? ""}`,
          title: t.title,
          subtitle: [t.album, t.release_date ? new Date(t.release_date).getFullYear() : null].filter(Boolean).join(" · ") || undefined,
          imageUrl: cover,
          footer: `static-cuts.com/song/${t.id}`,
        })} />
        {!isAdmin && (
          <button className={`tab sp-icon-btn ${more ? "active" : ""}`} aria-label="More" aria-expanded={more} onClick={() => setMore(!more)}><Dots /></button>
        )}
      </div>
      {more && !isAdmin && (
        <div className="sp-more">
          <AddToList trackId={t.id} />
          {(["announced", "teased", "snippet", "rumored"].includes(status) ||
            (t.release_date && t.release_date >= new Date().toISOString().slice(0, 10))) && <RemindMe trackId={t.id} />}
        </div>
      )}

      <div className="sp-facts">
        <div><span>Versions</span><strong>{song.family.length}</strong></div>
        <div><span>First seen</span><strong>{firstSeen ? formatDate(firstSeen) : "—"}</strong></div>
        <div>
          <span>Status</span>
          <strong><span className={`feature-tag st st-${status}`}>{status}</span></strong>
        </div>
        <div><span>In libraries</span><strong>{song.collectors.toLocaleString("en-GB")}</strong></div>
      </div>
      <div className="sp-trust">
        {(() => {
          const tr = trustOf(t);
          return tr.level === "sourced" && t.status_source_url
            ? <a href={t.status_source_url} target="_blank" rel="noopener noreferrer" className={`trust-tag trust-${tr.level}`} title={tr.title}>{tr.label} ↗</a>
            : <span className={`trust-tag trust-${tr.level}`} title={tr.title}>{tr.label}</span>;
        })()}
      </div>

      {!isAdmin && (
        <button className={`sp-rate ${song.my_rating ? "rated" : ""}`} aria-expanded={rateOpen} onClick={() => (user ? setRateOpen(!rateOpen) : router.push("/login"))}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill={song.my_rating ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>
          <span className="sp-rate-text">
            <strong>{song.my_rating ? `You: ${song.my_rating}/10` : "Rate it"}</strong>
            <span>
              {song.my_rating
                ? (song.rating?.avg ? `Average ${song.rating.avg}/10 · ${song.rating.count} rating${song.rating.count === 1 ? "" : "s"}` : "No other ratings yet")
                : `${(song.rating?.count ?? 0).toLocaleString("en-GB")} rating${song.rating?.count === 1 ? "" : "s"} · rate to see the average`}
            </span>
          </span>
          <span className="sp-rate-cta">{song.my_rating ? "Change" : "1–10"}</span>
        </button>
      )}
      {rateOpen && !isAdmin && (
        <div className="comments-panel" style={{ marginTop: 10 }}>
          <div className="comment-meta" style={{ marginBottom: 8 }}>
            {song.my_rating
              ? (song.rating?.avg ? `Community average ${song.rating.avg}/10 from ${song.rating.count} rating${song.rating.count === 1 ? "" : "s"}` : "No other ratings yet")
              : "Rate it to see the community average."}
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} className={`rating-num ${song.my_rating === n ? "selected" : ""}`} onClick={() => rate(n)}>{n}</button>
            ))}
            {song.my_rating && <button className="rating-clear" onClick={() => rate(null)}>clear</button>}
          </div>
        </div>
      )}


      {listen.length > 0 ? (
        <>
          <button className="sp-listen" aria-expanded={listenOpen} onClick={() => setListenOpen(!listenOpen)}>
            <span className="sp-listen-icons">
              {t.spotify_url && <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1DB954" /><path d="M6.5 9.3c3.8-1.1 8-.8 11.2 1M7.2 12.4c3-.8 6.4-.5 9 1M7.9 15.3c2.4-.6 5-.4 7 .8" stroke="#070707" strokeWidth="1.7" strokeLinecap="round" fill="none" /></svg>}
              {t.apple_url && <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="currentColor"><path d="M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.8-3-.8C7 7.3 5.5 8.2 4.7 9.700c-1.7 2.9-.4 7.200 1.200 9.6.8 1.1 1.700 2.400 2.900 2.300 1.200 0 1.600-.7 3-.7s1.800.7 3 .7c1.300 0 2.100-1.100 2.800-2.300.9-1.300 1.300-2.600 1.300-2.700-.1 0-2.500-1-2.500-3.900zM14.200 5.600c.6-.8 1.100-1.800 1-2.900-.9 0-2.100.6-2.700 1.400-.6.700-1.100 1.800-1 2.800 1 .1 2.100-.5 2.700-1.300z" /></svg>}
              {!t.spotify_url && !t.apple_url && <span className="sp-sub">DZ</span>}
            </span>
            <span className="sp-listen-text">
              <strong>Listen on streaming</strong>
              <span>Official releases only</span>
            </span>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="sp-chev"><path d="m9 6 6 6-6 6" /></svg>
          </button>
          {listenOpen && (
            <div className="sp-listen-list">
              {listen.map((l) => <a key={l.name} className="tab" href={l.url} target="_blank" rel="noopener noreferrer">{l.name} ↗</a>)}
              <InlinePlayer url={t.spotify_url} />
            </div>
          )}
        </>
      ) : (
        <div className="comment-meta" style={{ marginTop: 12 }}>
          No official release yet.{" "}
          <Link href="/listen" className="text-link">How to listen</Link>
        </div>
      )}

      <FriendsWhoHaveIt trackId={t.id} signedIn={!!user} />
      <MyFile trackId={t.id} />
      <FileNote trackId={t.id} />
      {isAdmin && <AdminModeNote what="collect, rate, comment, vote or add to a list" />}
      {!isAdmin && VOTEABLE_STATUSES.includes(status) && <RealOrFake trackId={t.id} />}

      <div className="sp-head">
        <h2>Versions ({song.family.length})</h2>
        <Link href={`/artist/${artistId}?highlight=${t.id}`}>Add version +</Link>
      </div>
      <div className="sp-versions">
        {song.family.map((v) => {
          const st = statusOf(v);
          const here = v.id === t.id;
          return (
            <Link key={v.id} href={`/song/${v.id}`} className={`sp-version ${here ? "here" : ""}`} data-st={st} aria-current={here ? "page" : undefined}>
              <span className="sp-version-text">
                <span className="sp-version-title">{v.title}</span>
                <span className="sp-sub">{[v.is_main ? "main song" : "version", here ? "you're here" : null].filter(Boolean).join(" · ")}</span>
              </span>
              <span className={`feature-tag st st-${st}`}>{st}</span>
            </Link>
          );
        })}
      </div>

      <SongTimeline trackId={t.id} auto={timeline} />

      <div className="sp-head">
        <h2>Comments{song.comments > 0 ? ` (${song.comments})` : ""}</h2>
        {song.comments > 1 && <button onClick={() => setAllComments(!allComments)}>{allComments ? "Show less" : "View all →"}</button>}
      </div>
      <TrackComments trackId={t.id} limit={allComments ? undefined : 1} />

      <details className="sp-info">
        <summary>Info</summary>
        {info.map(([label, value]) => (
          <div key={label} className="song-info-row">
            <div className="comment-meta">{label}</div>
            <div className="comment-body">{value}</div>
          </div>
        ))}
        {relations.length > 0 && (
          <>
            <div className="section-label">Samples &amp; connections</div>
            {Object.entries(relations.reduce<Record<string, Relation[]>>((acc, r) => { (acc[r.kind] ??= []).push(r); return acc; }, {}))
              .map(([kind, rows]) => (
                <div key={kind} className="song-info-row">
                  <div className="comment-meta">{RELATION_LABELS[kind] ?? kind}</div>
                  <div className="comment-body">
                    {rows.slice(0, 12).map((r, i) => (
                      <span key={`${r.title}-${i}`}>
                        {i > 0 && " · "}
                        {r.track_id
                          ? <Link href={`/song/${r.track_id}`} className="text-link">{r.title}</Link>
                          : r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-link">{r.title} ↗</a> : r.title}
                        {r.artist && <span className="comment-meta"> by {r.artist}</span>}
                      </span>
                    ))}
                    {rows.length > 12 && <span className="comment-meta"> and {rows.length - 12} more</span>}
                  </div>
                </div>
              ))}
            <div className="comment-meta" style={{ marginTop: 4 }}>From Genius.</div>
          </>
        )}
        {!t.cover_url && <FanCovers trackId={t.id} onChange={load} />}
      </details>

      <div className="comment-meta" style={{ marginTop: 30, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Link href={`/artist/${artistId}?highlight=${t.id}`} className="text-link">{isAdmin ? "edit on the artist page" : "suggest an edit or a version"}</Link>
        <Link href={`/takedown?url=${encodeURIComponent(`https://static-cuts.com/song/${t.id}`)}`} className="text-link">takedown request</Link>
      </div>
    </div>
  );
}
