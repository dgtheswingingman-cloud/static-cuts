"use client";

// Everything about one song: info, listen link, the other versions of it,
// status history, who added it, collecting, rating and comments.

import { useEffect, useState, type ReactNode } from "react";
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
import WantButton from "./WantButton";
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
  const [tab, setTab] = useState<"versions" | "timeline" | "info" | "comments">("versions");

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
  const day = t.leak_date ? ["Leaked", formatDate(t.leak_date)] : t.release_date ? ["Released", formatDate(t.release_date)] : t.created_at ? ["Added", formatDate(t.created_at)] : null;
  const tabs: [typeof tab, string][] = [
    ["versions", `Versions${song.family.length > 1 ? ` ${song.family.length}` : ""}`],
    ["timeline", "Timeline"],
    ["info", "Info"],
    ["comments", `Comments${song.comments > 0 ? ` ${song.comments}` : ""}`],
  ];

  return (
    <div className="wrap song-page">
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
            {song.family.length > 1 && <span className="feature-tag sp-tag-line">{song.family.length} versions</span>}
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

      <div className="song-actions sp-actions">
        {!isAdmin && (
          <>
            <button className={`tab ${song.owned ? "active" : ""}`} disabled={busy} onClick={toggleOwned}>
              {song.owned ? "✓ library" : "+ library"}
            </button>
            {status !== "released" && <WantButton trackId={t.id} />}
            <button className={`tab ${song.my_rating ? "active" : ""}`} onClick={() => (user ? setRateOpen(!rateOpen) : router.push("/login"))}>
              {song.my_rating ? `★ ${song.my_rating}/10` : "rate"}
            </button>
            <AddToList trackId={t.id} />
          </>
        )}
        <ShareButton title={`${t.title} · Static Cuts//`} path={`/song/${t.id}`} storyKey={t.id}
          fileName={`static-cuts-${t.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`} story={() => ({
          kicker: `${status} · ${song.artist?.name ?? ""}`,
          title: t.title,
          subtitle: [t.album, t.release_date ? new Date(t.release_date).getFullYear() : null].filter(Boolean).join(" · ") || undefined,
          imageUrl: cover,
          footer: `static-cuts.com/song/${t.id}`,
        })} />
        {!isAdmin && (["announced", "teased", "snippet", "rumored"].includes(status) ||
          (t.release_date && t.release_date >= new Date().toISOString().slice(0, 10))) && <RemindMe trackId={t.id} />}
      </div>

      <div className="sp-facts">
        <div>
          <span>Status</span>
          <strong className={`sp-fact-st sp-c-${status}`}>{status}</strong>
          {(() => {
            const tr = trustOf(t);
            return tr.level === "sourced" && t.status_source_url
              ? <a href={t.status_source_url} target="_blank" rel="noopener noreferrer" className={`trust-tag trust-${tr.level}`} title={tr.title}>{tr.label} ↗</a>
              : <em className={`trust-tag trust-${tr.level}`} title={tr.title}>{tr.label}</em>;
          })()}
        </div>
        {day && <div><span>{day[0]}</span><strong>{day[1]}</strong></div>}
        <div><span>In libraries</span><strong>{song.collectors.toLocaleString("en-GB")}</strong></div>
        <div>
          <span>Rating</span>
          <strong>{song.my_rating && song.rating?.avg ? `${song.rating.avg}/10` : (song.rating?.count ?? 0) > 0 ? `${song.rating?.count} rated` : "—"}</strong>
        </div>
      </div>

      {(t.spotify_url || t.deezer_url || t.apple_url) ? (
        <div className="sp-listen">
          {t.spotify_url && <a className="tab" href={t.spotify_url} target="_blank" rel="noopener noreferrer">Spotify ↗</a>}
          <InlinePlayer url={t.spotify_url} />
          {t.deezer_url && <a className="tab" href={t.deezer_url} target="_blank" rel="noopener noreferrer">Deezer ↗</a>}
          {t.apple_url && <a className="tab" href={t.apple_url} target="_blank" rel="noopener noreferrer">Apple Music ↗</a>}
        </div>
      ) : (
        <div className="comment-meta" style={{ marginTop: 12 }}>
          No listen link yet.{" "}
          <Link href={`/artist/${artistId}?highlight=${t.id}`} className="text-link">Know one? Add it</Link>
          {" · "}<Link href="/listen" className="text-link">how to listen</Link>
        </div>
      )}

      <FriendsWhoHaveIt trackId={t.id} signedIn={!!user} />
      <MyFile trackId={t.id} />
      <FileNote trackId={t.id} />
      {isAdmin && <AdminModeNote what="collect, rate, comment, vote or add to a list" />}

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

      {!isAdmin && VOTEABLE_STATUSES.includes(status) && <RealOrFake trackId={t.id} />}

      <nav className="sp-tabs" aria-label="Song sections">
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : undefined} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>
        ))}
      </nav>

      {tab === "versions" && (
        song.family.length > 1 ? (
          <div className="sp-versions">
            {song.family.map((v) => {
              const st = statusOf(v);
              const here = v.id === t.id;
              return (
                <Link key={v.id} href={`/song/${v.id}`} className={`track-row sp-version ${here ? "here" : ""}`} data-st={st} aria-current={here ? "page" : undefined}>
                  {cover
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={cover} alt="" width={44} height={44} className="sp-thumb" />
                    : <span className="sp-thumb sp-thumb-empty">SC//</span>}
                  <span className="sp-version-text">
                    <span className="track-title">{v.title}</span>
                    <span className="sp-sub">{[v.is_main ? "main song" : null, here ? "you're here" : null].filter(Boolean).join(" · ") || "version"}</span>
                  </span>
                  <span className={`feature-tag st st-${st}`}>{st}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="sp-empty">
            <div>ONE VERSION.</div>
            <Link href={`/artist/${artistId}?highlight=${t.id}`} className="text-link">Know another? Add it</Link>
          </div>
        )
      )}

      {tab === "timeline" && <SongTimeline trackId={t.id} auto={timeline} />}

      {tab === "info" && (
        <>
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
        </>
      )}

      {tab === "comments" && <TrackComments trackId={t.id} />}

      <div className="comment-meta" style={{ marginTop: 30, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Link href={`/artist/${artistId}?highlight=${t.id}`} className="text-link">{isAdmin ? "edit on the artist page" : "suggest an edit or a version"}</Link>
        <Link href={`/takedown?url=${encodeURIComponent(`https://static-cuts.com/song/${t.id}`)}`} className="text-link">takedown request</Link>
      </div>
    </div>
  );
}
