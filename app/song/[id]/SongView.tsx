"use client";

// Everything about one song: info, listen link, the other versions of it,
// status history, who added it, collecting, rating and comments.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import TrackComments from "../../artist/[id]/TrackComments";
import RealOrFake, { VOTEABLE_STATUSES } from "./RealOrFake";
import AddToList from "./AddToList";
import RemindMe from "./RemindMe";
import WantButton from "./WantButton";
import InlinePlayer from "../../components/InlinePlayer";
import FileNote from "./FileNote";
import MyFile from "./MyFile";
import StoryButton from "../../components/StoryButton";
import { useIsAdmin, usePersonalUser } from "../../useIsAdmin";
import AdminModeNote from "../../components/AdminModeNote";
import FriendsWhoHaveIt from "./FriendsWhoHaveIt";
import { likeOnSpotify } from "@/lib/spotifyLikes";

type Track = {
  id: string;
  title: string;
  artist_id: string;
  spotify_url: string | null;
  deezer_url?: string | null;
  length_sec?: number | null;
  parent_track_id: string | null;
  is_featured: boolean;
  is_official: boolean;
  aliases: string | null;
  track_number: number | null;
  release_date: string | null;
  leak_date?: string | null;
  cover_url?: string | null;
  producers: string | null;
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
  const [copied, setCopied] = useState(false);
  const [sheet, setSheet] = useState<{ title: string; credit: string | null; url: string } | null>(null);

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

  function share() {
    const url = `${window.location.origin}/song/${id}`;
    if (navigator.share) {
      navigator.share({ title: song?.track.title, url }).catch(() => {});
      return;
    }
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); });
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
  const versions = song.family.filter((v) => v.id !== t.id);
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
        <Link href={`/profile/${song.added_by.id}`} className="text-link">{song.added_by.name}</Link>
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

  // The song's life in order: when it leaked or came out, plus every status
  // change the site has recorded (and where it came from).
  const timeline: { at: string; text: ReactNode; note?: string | null }[] = [
    ...(t.leak_date ? [{ at: t.leak_date, text: <><strong>leaked</strong></> }] : []),
    ...(t.release_date ? [{ at: t.release_date, text: <><strong>released</strong>{t.album ? <> on {t.album}</> : null}</> }] : []),
    ...song.history.map((h) => ({
      at: h.at,
      text: h.from ? <>marked {h.from} → <strong>{h.to}</strong> here</> : <>added here as <strong>{h.to}</strong></>,
      note: h.note ?? (h.by_suggestion ? "from an approved suggestion" : null),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="wrap song-page">
      <Link href={`/artist/${artistId}?highlight=${t.id}`} className="back-btn">← {song.artist?.name ?? "artist"}</Link>

      {t.cover_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.cover_url} alt="" className="song-cover" width={140} height={140} />
      )}
      <h1 className="detail-name song-title">{t.title}</h1>
      <div className="detail-meta song-tags">
        <Link href={`/artist/${artistId}`} className="text-link">{song.artist?.name ?? "Unknown artist"}</Link>
        <span className="feature-tag">{statusOf(t)}</span>
        {(() => {
          const tr = trustOf(t);
          return tr.level === "sourced" && t.status_source_url
            ? <a href={t.status_source_url} target="_blank" rel="noopener noreferrer" className={`trust-tag trust-${tr.level}`} title={tr.title}>{tr.label} ↗</a>
            : <span className={`trust-tag trust-${tr.level}`} title={tr.title}>{tr.label}</span>;
        })()}
        {t.is_featured && <span className="feature-tag">featured</span>}
        {main && main.id !== t.id && (
          <span>version of <Link href={`/song/${main.id}`} className="text-link">{main.title}</Link></span>
        )}
      </div>

      <div className="song-actions">
        {t.spotify_url && (
          <a className="tab active" href={t.spotify_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
            listen ↗
          </a>
        )}
        <InlinePlayer url={t.spotify_url} />
        {t.deezer_url && (
          <a className={`tab ${t.spotify_url ? "" : "active"}`} href={t.deezer_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
            Deezer ↗
          </a>
        )}
        {!isAdmin && (
          <>
            <button className={`tab ${song.owned ? "active" : ""}`} disabled={busy} onClick={toggleOwned}>
              {song.owned ? "✓ collected" : "collect"}
            </button>
            <button className={`tab ${song.my_rating ? "active" : ""}`} onClick={() => (user ? setRateOpen(!rateOpen) : router.push("/login"))}>
              {song.my_rating ? `rated ${song.my_rating}/10` : "rate"}
            </button>
          </>
        )}
        <button className="tab" onClick={share}>{copied ? "link copied" : "share"}</button>
        <StoryButton fileName={`static-cuts-${t.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`} story={() => ({
          kicker: `${statusOf(t)} · ${song.artist?.name ?? ""}`,
          title: t.title,
          subtitle: [t.album, t.release_date ? new Date(t.release_date).getFullYear() : null].filter(Boolean).join(" · ") || undefined,
          imageUrl: t.cover_url,
          footer: `static-cuts.com/song/${t.id}`,
        })} />
        {!isAdmin && (["announced", "teased", "snippet", "rumored"].includes(statusOf(t)) ||
          (t.release_date && t.release_date >= new Date().toISOString().slice(0, 10))) && <RemindMe trackId={t.id} />}
        {!isAdmin && statusOf(t) !== "released" && <WantButton trackId={t.id} />}
        {!isAdmin && <AddToList trackId={t.id} />}
      </div>
      <FriendsWhoHaveIt trackId={t.id} signedIn={!!user} />
      <MyFile trackId={t.id} />
      <FileNote trackId={t.id} />
      {!t.spotify_url && !t.deezer_url && (
        <div className="comment-meta" style={{ marginTop: 8 }}>
          No listen link yet: we know about this song but not of a place to play it.{" "}
          <Link href={`/artist/${artistId}?highlight=${t.id}`} className="text-link">Know one? Add it</Link>
          {" · "}<Link href="/listen" className="text-link">how to listen, and playing your own files</Link>
        </div>
      )}
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

      {!isAdmin && VOTEABLE_STATUSES.includes(statusOf(t)) && <RealOrFake trackId={t.id} />}

      <div className="health-tiles" style={{ marginTop: 20 }}>
        <div className="health-tile">
          <div className="health-tile-value">{song.collectors.toLocaleString("en-GB")}</div>
          <div className="health-tile-label">collected</div>
        </div>
        <div className="health-tile">
          <div className="health-tile-value">{song.my_rating && song.rating?.avg ? song.rating.avg : (song.rating?.count ?? 0)}</div>
          <div className="health-tile-label">{song.my_rating && song.rating?.avg ? "avg rating" : `rating${song.rating?.count === 1 ? "" : "s"}`}</div>
        </div>
        <div className="health-tile">
          <div className="health-tile-value">{song.family.length}</div>
          <div className="health-tile-label">version{song.family.length === 1 ? "" : "s"}</div>
        </div>
      </div>

      {info.length > 0 && (
        <>
          <div className="section-label">Song info</div>
          {info.map(([label, value]) => (
            <div key={label} className="song-info-row">
              <div className="comment-meta">{label}</div>
              <div className="comment-body">{value}</div>
            </div>
          ))}
        </>
      )}

      {versions.length > 0 && (
        <>
          <div className="section-label">Other versions ({versions.length})</div>
          {versions.map((v) => (
            <div key={v.id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title"><Link href={`/song/${v.id}`}>{v.title}</Link></div>
                <div className="review-row-meta">
                  {v.is_main && <span className="feature-tag">main song</span>}
                  <span className="feature-tag">{statusOf(v)}</span>
                </div>
              </div>
              {v.spotify_url && <a className="listen-link" href={v.spotify_url} target="_blank" rel="noopener noreferrer">listen</a>}
            </div>
          ))}
        </>
      )}

      {timeline.length > 0 && (
        <>
          <div className="section-label">History</div>
          <ol className="song-history">
            {timeline.map((h, i) => (
              <li key={i}>
                <span className="comment-meta">{formatDate(h.at)}</span>{" "}{h.text}
                {h.note && <span className="comment-meta"> · {h.note}</span>}
              </li>
            ))}
          </ol>
        </>
      )}

      <div className="section-label">Comments{song.comments > 0 ? ` (${song.comments})` : ""}</div>
      <TrackComments trackId={t.id} />

      <div className="comment-meta" style={{ marginTop: 30, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Link href={`/artist/${artistId}?highlight=${t.id}`} className="text-link">{isAdmin ? "edit on the artist page" : "suggest an edit or a version"}</Link>
        <Link href={`/takedown?url=${encodeURIComponent(`https://static-cuts.com/song/${t.id}`)}`} className="text-link">takedown request</Link>
      </div>
    </div>
  );
}
