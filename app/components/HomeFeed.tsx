"use client";

// The top of the homepage: album of the week, latest updates (what just
// changed in the archive), recently added songs, what's coming up, the most
// active artists this week, this week's numbers and the artists you follow.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import AlbumOfWeek from "./AlbumOfWeek";

type Group = { kind: "added" | "status"; artist_id: string; artist: string | null; to_status: string | null; count: number; at: string; tracks: { id: string; title: string }[] };
type Added = { id: string; title: string; cover_url: string | null; release_status: string | null; album: string | null; created_at: string; artist_id: string; artists: { name: string } | null };
type Radar = { section: string; track_id: string; title: string; artist_id: string; artist: string; release_date: string | null; cover_url: string | null };
type Week = { leaked_n: number; released_n: number; added_total: number };

function ago(at: string) {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(at)) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
function when(d: string) {
  const days = Math.round((Date.parse(`${d}T12:00:00`) - Date.now()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1 && days < 14) return `in ${days} days`;
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function monday() {
  const x = new Date();
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}
const n0 = (x: number) => x.toLocaleString("en-GB");

function Head({ title, href, label = "View all" }: { title: string; href?: string; label?: string }) {
  return (
    <div className="sp-head hf-head">
      <h2>{title}</h2>
      {href && <Link href={href}>{label} →</Link>}
    </div>
  );
}

export default function HomeFeed({ photos, followed }: { photos: Record<string, string>; followed: string[] }) {
  const [updates, setUpdates] = useState<Group[] | null>(null);
  const [trending, setTrending] = useState<{ artist_id: string; artist: string; n: number }[]>([]);
  const [added, setAdded] = useState<Added[]>([]);
  const [soon, setSoon] = useState<Radar[]>([]);
  const [week, setWeek] = useState<Week | null>(null);

  useEffect(() => {
    const load = () => supabase.rpc("rpc_whats_new", { p_before: null, p_kind: "all", p_following: false, p_days: 7 }).then(({ data }) => {
      const groups = ((data as { days?: { groups: Group[] }[] } | null)?.days ?? []).flatMap((d) => d.groups);
      setUpdates(groups.slice(0, 9));
      // Most active this week: songs added or moved, per artist.
      const by = new Map<string, { artist_id: string; artist: string; n: number }>();
      for (const g of groups) {
        const r = by.get(g.artist_id) ?? { artist_id: g.artist_id, artist: g.artist ?? g.artist_id, n: 0 };
        r.n += g.count;
        by.set(g.artist_id, r);
      }
      setTrending([...by.values()].sort((a, b) => b.n - a.n).slice(0, 5));
    });
    load();
    const t = setInterval(load, 120000);
    supabase.from("tracks").select("id, title, cover_url, release_status, album, created_at, artist_id, artists(name)")
      .is("parent_track_id", null).not("cover_url", "is", null).order("created_at", { ascending: false }).limit(12)
      .then(({ data }) => setAdded((data as unknown as Added[]) ?? []));
    supabase.rpc("rpc_release_radar").then(({ data }) => {
      setSoon(((data as Radar[]) ?? []).filter((r) => r.section === "upcoming" && r.release_date)
        .sort((a, b) => a.release_date!.localeCompare(b.release_date!)).slice(0, 10));
    });
    supabase.rpc("rpc_weekly_slides", { p_week: monday() }).then(({ data }) => setWeek((data as Week | null) ?? null));
    return () => clearInterval(t);
  }, []);

  const followedWithPhotos = followed.filter((id) => photos[id]);

  return (
    <div className="hf">
      <AlbumOfWeek hero />

      <Head title="Latest updates" href="/new" />
      {updates && updates.length === 0 && <div className="comment-meta">Quiet for now.</div>}
      <div className="hf-strip hf-updates">
        {(updates ?? []).map((g, i) => {
          const st = g.kind === "added" ? "added" : g.to_status ?? "";
          const first = g.tracks[0];
          return (
            <Link key={i} href={g.count === 1 && first ? `/song/${first.id}` : `/artist/${g.artist_id}`} className="hf-update">
              <span className="hf-update-img">
                {photos[g.artist_id]
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={photos[g.artist_id]} alt="" loading="lazy" />
                  : <span>{(g.artist ?? "?").slice(0, 1)}</span>}
              </span>
              <span className="hf-update-body">
                <span className="hf-update-artist">{g.artist ?? g.artist_id}</span>
                <span className="hf-update-what">
                  {g.kind === "added"
                    ? (g.count === 1 && first ? <>New song &ldquo;{first.title}&rdquo;</> : <>{g.count} new songs</>)
                    : (g.count === 1 && first ? <>&ldquo;{first.title}&rdquo;</> : <>{g.count} songs</>)}
                </span>
                <span className="hf-update-foot">
                  <span className={`feature-tag st st-${st}`}>{g.kind === "added" ? "added" : st}</span>
                  <span className="hf-when">{ago(g.at)}</span>
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      {added.length > 0 && (
        <>
          <Head title="Recently added" href="/new" />
          <div className="hf-strip hf-covers">
            {added.map((t) => (
              <Link key={t.id} href={`/song/${t.id}`} className="hf-cover">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.cover_url!} alt="" loading="lazy" />
                <span className="hf-cover-artist">{t.artists?.name ?? ""}</span>
                <span className="hf-cover-title">{t.title}</span>
                <span className="hf-cover-meta">{[t.release_status, t.album ? "album" : "single"].filter(Boolean).join(" · ")}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {soon.length > 0 && (
        <>
          <Head title="Coming up" href="/radar/releases" label="Radar" />
          <div className="hf-strip hf-covers">
            {soon.map((r) => (
              <Link key={r.track_id} href={`/song/${r.track_id}`} className="hf-cover">
                {r.cover_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={r.cover_url} alt="" loading="lazy" />
                  : <span className="hf-cover-blank">SC//</span>}
                <span className="hf-cover-artist">{r.artist}</span>
                <span className="hf-cover-title">{r.title}</span>
                <span className="hf-cover-meta hf-soon">{when(r.release_date!)}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="hf-two">
        <section>
          <Head title="Most active" href="/new" />
          <div className="sp-versions hf-trending">
            {trending.map((a, i) => (
              <Link key={a.artist_id} href={`/artist/${a.artist_id}`} className="hf-trend">
                <span className="hf-rank">{i + 1}</span>
                {photos[a.artist_id]
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={photos[a.artist_id]} alt="" width={36} height={36} loading="lazy" />
                  : <span className="hf-trend-blank">{a.artist.slice(0, 1)}</span>}
                <span className="hf-trend-name">{a.artist}</span>
                <span className="hf-trend-n">▲ {n0(a.n)}</span>
                <span aria-hidden="true" className="hf-chev">›</span>
              </Link>
            ))}
            {trending.length === 0 && <div className="comment-meta" style={{ padding: 12 }}>Nothing yet this week.</div>}
          </div>
        </section>
        <section>
          <Head title="This week" href="/weekly" />
          <div className="sp-versions hf-week">
            <Link href="/weekly" className="hf-week-row"><span className="hf-week-icon" style={{ color: "var(--red)" }}>●</span><strong>{week ? n0(week.leaked_n) : "…"}</strong><span>new leaks</span></Link>
            <Link href="/weekly" className="hf-week-row"><span className="hf-week-icon" style={{ color: "var(--green)" }}>●</span><strong>{week ? n0(week.released_n) : "…"}</strong><span>released</span></Link>
            <Link href="/weekly" className="hf-week-row"><span className="hf-week-icon" style={{ color: "var(--accent)" }}>●</span><strong>{week ? n0(week.added_total) : "…"}</strong><span>songs added</span></Link>
          </div>
          {followed.length > 0 && (
            <>
              <Link href="/library" className="hf-sub-head">Followed artists ({followed.length}) →</Link>
              <div className="hf-followed">
                {followedWithPhotos.slice(0, 6).map((id) => (
                  <Link key={id} href={`/artist/${id}`} aria-label="Artist">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photos[id]} alt="" width={40} height={40} loading="lazy" />
                  </Link>
                ))}
                {followed.length > Math.min(6, followedWithPhotos.length) && (
                  <a href="/library" className="hf-more">+{followed.length - Math.min(6, followedWithPhotos.length)}</a>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
