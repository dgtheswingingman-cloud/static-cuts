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

type Track = {
  id: string;
  title: string;
  artist_id: string;
  spotify_url: string | null;
  parent_track_id: string | null;
  is_featured: boolean;
  is_official: boolean;
  aliases: string | null;
  track_number: number | null;
  release_date: string | null;
  leak_date?: string | null;
  producers: string | null;
  genre: string | null;
  notes: string | null;
  album: string | null;
  release_status: string | null;
  created_at: string | null;
  source: string | null;
  source_url: string | null;
};
type Version = { id: string; title: string; release_status: string | null; is_official: boolean; spotify_url: string | null; is_main: boolean };
type Song = {
  redirect?: string;
  track: Track;
  artist: { id: string; name: string } | null;
  family: Version[];
  appears_on: { id: string; name: string }[];
  history: { from: string | null; to: string; at: string }[];
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

function formatDate(d: string, withYear = true) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}

export default function SongView({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
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
    if (!user) { router.push("/login"); return; }
    if (!song) return;
    setBusy(true);
    const { error } = song.owned
      ? await supabase.from("track_ownership").delete().eq("user_id", user.id).eq("track_id", song.track.id)
      : await supabase.from("track_ownership").insert({ user_id: user.id, track_id: song.track.id });
    setBusy(false);
    if (!error) setSong({ ...song, owned: !song.owned, collectors: song.collectors + (song.owned ? -1 : 1) });
  }

  async function rate(value: number | null) {
    if (!user) { router.push("/login"); return; }
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
        <button className="back-btn" onClick={() => router.push("/")}>← home</button>
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
  if (t.producers) info.push(["Producers", t.producers]);
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

  return (
    <div className="wrap song-page">
      <Link href={`/artist/${artistId}?highlight=${t.id}`} className="back-btn">← {song.artist?.name ?? "artist"}</Link>

      <h1 className="detail-name song-title">{t.title}</h1>
      <div className="detail-meta song-tags">
        <Link href={`/artist/${artistId}`} className="text-link">{song.artist?.name ?? "Unknown artist"}</Link>
        <span className="feature-tag">{statusOf(t)}</span>
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
        <button className={`tab ${song.owned ? "active" : ""}`} disabled={busy} onClick={toggleOwned}>
          {song.owned ? "✓ collected" : "collect"}
        </button>
        <button className={`tab ${song.my_rating ? "active" : ""}`} onClick={() => (user ? setRateOpen(!rateOpen) : router.push("/login"))}>
          {song.my_rating ? `rated ${song.my_rating}/10` : "rate"}
        </button>
        <button className="tab" onClick={share}>{copied ? "link copied" : "share"}</button>
        {(["announced", "teased", "snippet", "rumored"].includes(statusOf(t)) ||
          (t.release_date && t.release_date >= new Date().toISOString().slice(0, 10))) && <RemindMe trackId={t.id} />}
        <AddToList trackId={t.id} />
      </div>

      {rateOpen && (
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

      {VOTEABLE_STATUSES.includes(statusOf(t)) && <RealOrFake trackId={t.id} />}

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

      {song.history.length > 0 && (
        <>
          <div className="section-label">Status history</div>
          <ol className="song-history">
            {song.history.map((h, i) => (
              <li key={i}>
                <span className="comment-meta">{formatDate(h.at)}</span>{" "}
                {h.from ? <>{h.from} → <strong>{h.to}</strong></> : <>added as <strong>{h.to}</strong></>}
              </li>
            ))}
          </ol>
        </>
      )}

      <div className="section-label">Comments{song.comments > 0 ? ` (${song.comments})` : ""}</div>
      <TrackComments trackId={t.id} />

      <div className="comment-meta" style={{ marginTop: 30, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Link href={`/artist/${artistId}?highlight=${t.id}`} className="text-link">suggest an edit or a version</Link>
        <Link href={`/takedown?url=${encodeURIComponent(`https://static-cuts.com/song/${t.id}`)}`} className="text-link">takedown request</Link>
      </div>
    </div>
  );
}
