"use client";

// Radar overview: updates from artists you follow, this week's numbers, the
// archive's size, what's new everywhere and the next releases. The chips at
// the top go to the full lists.

import { useEffect, useState } from "react";
import Link from "next/link";
import RadarTabs from "../components/RadarTabs";
import OnThisDay from "../OnThisDay";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { usePersonalUser } from "../useIsAdmin";

type Group = { kind: "added" | "status"; artist_id: string; artist: string | null; to_status: string | null; count: number; at: string; tracks: { id: string; title: string }[] };
type Radar = { section: string; track_id: string; title: string; artist_id: string; artist: string; album: string | null; release_date: string | null; cover_url?: string | null };
type Week = { leaked_n: number; released_n: number; added_total: number };

const n0 = (x: number | null | undefined) => (x ?? 0).toLocaleString("en-GB");
const day = (at: string) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
function monday() {
  const x = new Date();
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}
const flatten = (data: unknown) => ((data as { days?: { groups: Group[] }[] } | null)?.days ?? []).flatMap((d) => d.groups);

// "SLIDING (V2) — leaked" / "3 new songs"
function what(g: Group) {
  const first = g.tracks[0];
  if (g.kind === "added") return g.count === 1 && first ? <><b>{first.title}</b> — added</> : <><b>{g.count} new songs</b>{first ? <> incl. {first.title}</> : null}</>;
  return g.count === 1 && first ? <><b>{first.title}</b> — {g.to_status}</> : <><b>{g.count} songs</b> now {g.to_status}</>;
}

function Head({ title, href }: { title: string; href?: string }) {
  return (
    <div className="sp-head hf-head">
      <h2>{title}</h2>
      {href && <Link href={href}>View all →</Link>}
    </div>
  );
}

export default function RadarOverview() {
  const { loading: authLoading } = useAuth();
  const user = usePersonalUser();
  const [mine, setMine] = useState<Group[] | null>(null);
  const [all, setAll] = useState<Group[] | null>(null);
  const [soon, setSoon] = useState<Radar[] | null>(null);
  const [week, setWeek] = useState<Week | null>(null);
  const [archive, setArchive] = useState<{ tracks: number; unreleased: number; artists: number } | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});

  useEffect(() => {
    if (authLoading) return;
    if (user) {
      supabase.rpc("rpc_whats_new", { p_before: null, p_kind: "all", p_following: true, p_days: 7 }).then(({ data }) => setMine(flatten(data).slice(0, 6)));
    } else setMine([]);
  }, [authLoading, user?.id]);

  useEffect(() => {
    supabase.rpc("rpc_whats_new", { p_before: null, p_kind: "all", p_following: false, p_days: 3 }).then(({ data }) => setAll(flatten(data).slice(0, 8)));
    supabase.rpc("rpc_release_radar").then(({ data }) => {
      setSoon(((data as Radar[]) ?? []).filter((r) => r.section === "upcoming" && r.release_date)
        .sort((a, b) => a.release_date!.localeCompare(b.release_date!)).slice(0, 5));
    });
    supabase.rpc("rpc_weekly_slides", { p_week: monday() }).then(({ data }) => setWeek((data as Week | null) ?? null));
    Promise.all([
      supabase.from("tracks").select("id", { count: "exact", head: true }).is("parent_track_id", null),
      supabase.from("tracks").select("id", { count: "exact", head: true }).is("parent_track_id", null).neq("release_status", "released"),
      supabase.from("artists").select("id", { count: "exact", head: true }),
    ]).then(([a, b, c]) => setArchive({ tracks: a.count ?? 0, unreleased: b.count ?? 0, artists: c.count ?? 0 }));
  }, []);

  // Artist photos for the followed updates.
  useEffect(() => {
    const ids = [...new Set((mine ?? []).map((g) => g.artist_id))].filter((id) => !photos[id]);
    if (!ids.length) return;
    supabase.from("artists").select("id, image_url").in("id", ids).then(({ data }) => {
      const m: Record<string, string> = {};
      for (const a of (data ?? []) as { id: string; image_url: string | null }[]) if (a.image_url) m[a.id] = a.image_url;
      setPhotos((p) => ({ ...p, ...m }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine]);

  return (
    <div className="wrap">
      <RadarTabs active="all" />

      <Head title={`Followed artist updates${mine && mine.length ? ` (${mine.length})` : ""}`} href={user ? "/new/following" : undefined} />
      {!user && !authLoading && (
        <div className="comment-meta"><Link href="/login" className="text-link">Log in</Link> and follow artists to see their updates here.</div>
      )}
      {user && mine && mine.length === 0 && <div className="comment-meta">Nothing new from artists you follow this week.</div>}
      {mine && mine.length > 0 && (
        <div className="sp-versions">
          {mine.map((g, i) => {
            const st = g.kind === "added" ? "added" : g.to_status ?? "";
            return (
              <Link key={i} href={g.count === 1 && g.tracks[0] ? `/song/${g.tracks[0].id}` : `/artist/${g.artist_id}`} className="rd-follow">
                {photos[g.artist_id]
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={photos[g.artist_id]} alt="" width={52} height={52} loading="lazy" />
                  : <span className="rd-follow-blank">{(g.artist ?? "?").slice(0, 1)}</span>}
                <span className="sp-version-text">
                  <span className="rd-follow-artist">{g.artist ?? g.artist_id}</span>
                  <span className="rd-follow-what">· {what(g)} ({day(g.at)})</span>
                </span>
                <span className={`feature-tag st st-${st}`}>{st}</span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="hf-two">
        <section>
          <Head title="This week" href="/weekly" />
          <div className="sp-versions hf-week">
            <Link href="/weekly" className="hf-week-row"><span className="hf-week-icon" style={{ color: "var(--red)" }}>●</span><strong>{week ? n0(week.leaked_n) : "…"}</strong><span>new leaks</span></Link>
            <Link href="/weekly" className="hf-week-row"><span className="hf-week-icon" style={{ color: "var(--green)" }}>●</span><strong>{week ? n0(week.released_n) : "…"}</strong><span>released</span></Link>
            <Link href="/weekly" className="hf-week-row"><span className="hf-week-icon" style={{ color: "var(--accent)" }}>●</span><strong>{week ? n0(week.added_total) : "…"}</strong><span>songs added</span></Link>
          </div>
        </section>
        <section>
          <Head title="Archive" />
          <div className="sp-versions hf-week">
            <div className="hf-week-row"><span className="hf-week-icon">◎</span><strong>{archive ? n0(archive.tracks) : "…"}</strong><span>songs</span></div>
            <div className="hf-week-row"><span className="hf-week-icon">◎</span><strong>{archive ? n0(archive.unreleased) : "…"}</strong><span>unreleased</span></div>
            <div className="hf-week-row"><span className="hf-week-icon">◎</span><strong>{archive ? n0(archive.artists) : "…"}</strong><span>artists</span></div>
          </div>
        </section>
      </div>

      <Head title="What's new" href="/new" />
      {all && all.length === 0 && <div className="comment-meta">Quiet for now.</div>}
      {all && all.length > 0 && (
        <div className="sp-versions">
          {all.map((g, i) => (
            <Link key={i} href={g.count === 1 && g.tracks[0] ? `/song/${g.tracks[0].id}` : `/artist/${g.artist_id}`}
              className="sp-version rd-new" data-st={g.kind === "added" ? "snippet" : g.to_status ?? ""}>
              <span className="rd-new-artist">{g.artist ?? g.artist_id}</span>
              <span className="rd-new-what">— {what(g)}</span>
              <span className="ap-date">{day(g.at)}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="rd-otd"><OnThisDay limit={6} /></div>

      <Head title="Upcoming releases" href="/radar/releases" />
      {soon && soon.length === 0 && <div className="comment-meta">Nothing dated on the radar right now. <Link href="/radar/releases" className="text-link">Announced, no date yet →</Link></div>}
      {soon && soon.length > 0 && (
        <div className="sp-versions">
          {soon.map((r) => (
            <Link key={r.track_id} href={`/song/${r.track_id}`} className="rd-follow">
              {r.cover_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={r.cover_url} alt="" width={52} height={52} loading="lazy" />
                : <span className="rd-follow-blank">SC//</span>}
              <span className="sp-version-text">
                <span className="rd-follow-artist">{r.artist}</span>
                <span className="rd-follow-what">{r.album ?? r.title}</span>
              </span>
              <span className="rd-date">{new Date(`${r.release_date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
