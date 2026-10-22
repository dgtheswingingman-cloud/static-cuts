"use client";

// Everything worth a glance in one place: what needs reviewing, anything
// that's gone wrong, and what the automatic jobs have been doing.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin } from "../useIsAdmin";
import NoAccess from "../components/NoAccess";

type Health = {
  generated_at: string;
  catalogue: Record<string, number>;
  reviews: {
    submissions: number; discoveries: number; sub_versions: number; imported_songs: number;
    takedowns: number; oldest_takedown: string | null;
  };
  spotify_matching: { checked: number; left: number; last_checked_at: string | null; checked_last_hour: number };
  queue: { due: number; next: { artist_id: string; name: string; why: string[] }[] };
  routine_runs: { started_at: string; who: string; artists: number; findings: number | null; submitted: number | null; summary: string | null }[];
  routine_users_last_7_days: number;
  imports: { started_at: string; artist: string; artist_id: string; source: string; who: string; added: number; updated: number; suggested: number; skipped: number; error: string | null; running: boolean }[];
  problems: { at: string; what: string; error: string; rate_limited: boolean }[];
  batches: { created_at: string; label: string; kind: string; undone: boolean; changes: number }[];
};

const BACKUPS_URL = "https://github.com/dgtheswingingman-cloud/static-cuts/actions/workflows/database-backup.yml";
const SOURCE = { spotify: "Spotify", genius: "Genius", lastfm: "Last.fm" } as Record<string, string>;

function ago(iso: string | null) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const n = (x: number | null | undefined) => (x ?? 0).toLocaleString("en-GB");

function Tile({ label, value, href, alert }: { label: string; value: string; href?: string; alert?: boolean }) {
  const body = (
    <div className="health-tile" data-alert={alert ? "true" : undefined}>
      <div className={`health-tile-value ${value.length > 9 ? "long" : ""}`}>{value}</div>
      <div className="health-tile-label">{label}</div>
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: "none" }}>{body}</Link> : body;
}

type Timer = { name: string; schedule: string; active: boolean; last_run: string | null; last_status: string | null; failed_24h: number };

// What each timer does, in plain words.
const TIMER_INFO: Record<string, string> = {
  "genius-import": "imports an artist's songs from Genius (every 10 min)",
  "genius-credits": "fills producers, features, dates and artwork from Genius (every 10 min)",
  "fetch-covers": "fetches Spotify artwork (every 10 min)",
  "sheet-sync": "re-reads community sheets that are due (hourly)",
  "radar-daily": "release-day reminders (07:05 UTC)",
  "follow-digest": "daily summary for followed artists (07:07 UTC)",
  "background-check": "tells you if any of these failed or stopped running (hourly)",
  "guest-artists": "gives guest artists pages once Spotify confirms them (4 every 20 min)",
  "spotify-match": "finds Spotify links by reading artists' releases (followed artists first), then searching song by song for artists with no Spotify profile (a few calls every 5 min)",
  "api-budget-tidy": "clears old allowance counts, undo history over 6 months and old timer logs (daily)",
  "link-check": "checks YouTube and SoundCloud links still work, 15 every 30 min (re-checks monthly)",
  "spotify-verify": "re-checks Spotify links not seen in 90 days and clears removed ones (hourly)",
  "lastfm-import": "imports an artist's most-played songs from Last.fm for review (hourly, :41)",
  "youtube-search": "searches YouTube for songs with no link, into possible links (1 every 15 min, needs the YouTube key)",
  "collab-refresh": "works out the collab map (nightly)",
  "duplicate-refresh": "works out possible duplicate songs for the duplicates page (hourly, :17)",
  "leaderboard-refresh": "works out the contributors leaderboard (hourly, :23)",
  "push-alerts": "sends phone alerts (every 2 min)",
  "artist-info": "fills in artist photos (Spotify, else Genius) and about text (Last.fm), 8 artists twice an hour",
  "genius-auto-add": "adds clear-cut Genius songs without review (hourly, switch in Owner)",
};

type Budget = { today: number; last_hour: number; per_day: number | null; per_minute: number | null; paused_until: string | null };
type DeadLinks = { checked: number; dead: number; songs: { track_id: string; title: string; artist_id: string; artist: string; url: string }[] };
const SERVICE_NAMES: Record<string, string> = { spotify: "Spotify", genius: "Genius", lastfm: "Last.fm", youtube: "YouTube (link checks)", soundcloud: "SoundCloud", ytsearch: "YouTube search" };

type TrackerRow = {
  id: string; title: string; artist_id: string; artist: string; auto_sync: boolean; last_synced_at: string | null;
  next_check_at: string | null; error: string | null; statuses: number | null; details: number | null; disagree: number | null;
  suggested: number | null; open_disagreements: number;
};
type CheckedRow = { artist_id: string; artist: string; songs: number; checked: number; pct: number; followers: number; has_tracker: boolean };
type SiteStats = {
  accounts: number; new_7d: number; new_30d: number; active_7d: number; active_30d: number; returning: number;
  contributors_30d: number; missed_searches_7d: number; push_devices: number;
};
type Miss = { query: string; kind: string; times: number; last_at: string; now_found: boolean };

type Progress = {
  spotify: { left: number; searched: number; linked: number; links_checked_30d: number; paused_until: string | null };
  genius: { checked: number; left: number };
  covers: { have: number; left: number };
  guests: Record<string, number>;
};

// "about 7 days" at the rate a timer gets through them.
function eta(left: number, perDay: number) {
  if (left <= 0) return "done";
  const days = left / perDay;
  if (days < 1) return `about ${Math.max(1, Math.round(days * 24))} hours left`;
  return `about ${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"} left`;
}

// part "health": jobs, outside services, trackers, links. part "people":
// sign-ups, how checked each artist is, searches that found nothing.
export default function HealthPanel({ part }: { part: "health" | "people" }) {
  const { user, loading: authLoading } = useAuth();
  const isRealAdmin = useIsAdmin();
  const router = useRouter();
  const [h, setH] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timers, setTimers] = useState<Timer[]>([]);
  const [bg, setBg] = useState<{ calls_6h: number; failed_6h: number; last_error: string | null } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [budget, setBudget] = useState<Record<string, Budget> | null>(null);
  const [dead, setDead] = useState<DeadLinks | null>(null);
  const [trackers, setTrackers] = useState<TrackerRow[]>([]);
  const [checked, setChecked] = useState<CheckedRow[]>([]);
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [misses, setMisses] = useState<Miss[]>([]);

  async function load() {
    const { data, error: err } = await supabase.rpc("admin_health");
    if (err) { setError(err.message); return; }
    setError(null);
    setH(data as Health);
    const [{ data: t }, { data: b }, { data: p }, { data: sb }, { data: dl }] = await Promise.all([
      supabase.rpc("admin_timers"),
      supabase.rpc("admin_background_failures"),
      supabase.rpc("admin_job_progress"),
      supabase.rpc("admin_api_budget"),
      supabase.rpc("admin_dead_links"),
    ]);
    setBudget((sb as typeof budget) ?? null);
    setDead((dl as DeadLinks) ?? null);
    const [{ data: tr }, { data: ck }, { data: st }, { data: ms }] = await Promise.all([
      supabase.rpc("admin_tracker_status"),
      supabase.rpc("admin_artist_checked", { p_limit: 40 }),
      supabase.rpc("admin_site_stats"),
      supabase.rpc("admin_search_misses", { p_days: 30 }),
    ]);
    setTrackers((tr as TrackerRow[]) ?? []);
    setChecked((ck as CheckedRow[]) ?? []);
    setStats((st as SiteStats) ?? null);
    setMisses((ms as Miss[]) ?? []);
    setTimers((t as Timer[]) ?? []);
    setBg(b ?? null);
    setProgress((p as Progress) ?? null);
  }

  useEffect(() => {
    if (!isRealAdmin) return;
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [isRealAdmin]);

  if (!isRealAdmin) return <NoAccess loading={authLoading} who="admin" />;

  const r = h?.reviews;
  const toReview = r ? r.submissions + r.discoveries + r.takedowns : 0;
  const matcherRunning = (h?.spotify_matching.checked_last_hour ?? 0) > 0;

  return (
    <div>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        {part === "health"
          ? "What's gone wrong and what the automatic jobs have been doing. Refreshes every minute."
          : "Who's using the site, how checked each artist is, and what people searched for and didn't find."}
        {h && <> Updated {ago(h.generated_at)}.</>}
      </div>
      {error && <div className="comments-panel" style={{ marginBottom: 16 }}>Couldn&apos;t load: {error}</div>}
      {!h && !error && <div className="empty-state">loading…</div>}

      {h && r && (
        <>
          {part === "health" && (<>
          <div className="section-label" style={{ marginTop: 20 }}>Problems (last 7 days)</div>
          {h.problems.length === 0 ? (
            <div className="comment-meta" style={{ marginBottom: 16 }}>Nothing has gone wrong.</div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              {h.problems.map((p, i) => (
                <div key={i} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="review-row-title">{p.what}</div>
                    <div className="review-row-meta">
                      {p.rate_limited && <span className="feature-tag">rate limited</span>}
                      <span>{p.error}</span>
                    </div>
                  </div>
                  <span className="comment-meta">{ago(p.at)}</span>
                </div>
              ))}
            </div>
          )}

          {progress && (() => {
            const sp = progress.spotify;
            const pausedUntil = sp.paused_until && new Date(sp.paused_until) > new Date() ? new Date(sp.paused_until) : null;
            const total = sp.left + sp.searched;
            const guestsDone = (progress.guests.created ?? 0) + (progress.guests.linked ?? 0);
            return (
              <>
                <div className="section-label" style={{ marginTop: 20 }}>Background progress</div>
                <div className="health-tiles">
                  <Tile
                    label={pausedUntil
                      ? `Spotify paused until ${pausedUntil.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                      : `Spotify songs checked · ${eta(sp.left, 2880)}`}
                    value={`${n(sp.searched)} / ${n(total)}`}
                    alert={!!pausedUntil}
                  />
                  <Tile label="songs with a Spotify link" value={n(sp.linked)} />
                  <Tile label="links re-checked (30 days)" value={`${n(sp.links_checked_30d)} / ${n(sp.linked)}`} />
                  <Tile label={`Genius credits checked · ${eta(progress.genius.left, 2160)}`} value={`${n(progress.genius.checked)} / ${n(progress.genius.checked + progress.genius.left)}`} />
                  <Tile label={`artwork found${progress.covers.left ? ` · ${n(progress.covers.left)} to fetch` : ""}`} value={n(progress.covers.have)} />
                  <Tile
                    label={`guest artists sorted · ${n(progress.guests.pending ?? 0)} to check, ${n(progress.guests.review ?? 0)} for you`}
                    value={n(guestsDone)}
                    href="/review/guests"
                    alert={(progress.guests.review ?? 0) > 0}
                  />
                </div>
              </>
            );
          })()}

          {budget && (
            <>
              <div className="section-label" style={{ marginTop: 20 }}>Outside services (calls today, shared by every job)</div>
              <div className="health-tiles">
                {Object.entries(budget).map(([svc, b]) => {
                  const paused = b.paused_until ? new Date(b.paused_until) : null;
                  return (
                    <Tile key={svc}
                      label={paused
                        ? `${SERVICE_NAMES[svc] ?? svc} paused until ${paused.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                        : `${SERVICE_NAMES[svc] ?? svc} · max ${b.per_minute ?? "?"}/min · ${n(b.last_hour)} in the last hour`}
                      value={`${n(b.today)} / ${b.per_day != null ? n(b.per_day) : "?"}`}
                      alert={!!paused || (b.per_day != null && b.today >= b.per_day)} />
                  );
                })}
              </div>
            </>
          )}

          </>)}

          {part === "people" && (<>
          {stats && (
            <>
              <div className="section-label" style={{ marginTop: 20 }}>People</div>
              <div className="health-tiles">
                <Tile label={`accounts · ${n(stats.new_7d)} new this week, ${n(stats.new_30d)} this month`} value={n(stats.accounts)} />
                <Tile label={`active this week · ${n(stats.active_30d)} this month`} value={n(stats.active_7d)} />
                <Tile label="came back a week or more after their first visit" value={n(stats.returning)} />
                <Tile label="people who sent suggestions (30 days)" value={n(stats.contributors_30d)} />
                <Tile label="searches that found nothing (7 days)" value={n(stats.missed_searches_7d)} />
                <Tile label="devices with phone alerts on" value={n(stats.push_devices)} />
              </div>
              <div className="comment-meta" style={{ marginBottom: 8 }}>
                &ldquo;Active&rdquo; means they followed, collected, rated, commented, suggested or voted.
              </div>
            </>
          )}

          {checked.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 20 }}>How much is checked (most followed first)</div>
              <div className="comment-meta" style={{ marginBottom: 8 }}>
                Main songs with a real status (not &ldquo;unconfirmed&rdquo;). Good for picking launch artists, and for seeing
                which artists need a tracker.
              </div>
              {checked.map((c) => (
                <div key={c.artist_id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="review-row-title"><Link href={`/artist/${c.artist_id}`}>{c.artist}</Link></div>
                    <div className="review-row-meta">
                      <span>{n(c.checked)} of {n(c.songs)} songs</span>
                      <span>{n(c.followers)} follower{c.followers === 1 ? "" : "s"}</span>
                      {c.has_tracker ? <span className="feature-tag">tracker</span> : <span>no tracker yet</span>}
                    </div>
                  </div>
                  <span className="comment-meta" style={{ minWidth: 90, textAlign: "right" }}>
                    {c.pct}% <span className="completeness-bar" style={{ display: "inline-block", width: 50, verticalAlign: "middle" }}><span style={{ width: `${c.pct}%` }} /></span>
                  </span>
                </div>
              ))}
            </>
          )}

          {misses.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 20 }}>Searches that found nothing (30 days)</div>
              <div className="comment-meta" style={{ marginBottom: 8 }}>
                What people looked for and didn&apos;t find: songs or artists to add, or spellings to add as nicknames.
                Only the words are kept, not who searched.
              </div>
              {misses.map((m) => (
                <div key={`${m.kind}:${m.query}`} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="review-row-title">&ldquo;{m.query}&rdquo;</div>
                    <div className="review-row-meta">
                      <span>{m.kind === "artists" ? "artist search" : "song search"}</span>
                      <span>{m.times} time{m.times === 1 ? "" : "s"}</span>
                      {m.now_found && <span className="feature-tag">finds something now</span>}
                    </div>
                  </div>
                  <span className="comment-meta">{ago(m.last_at)}</span>
                </div>
              ))}
            </>
          )}

          </>)}

          {part === "health" && (<>
          {trackers.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 20 }}>Community trackers</div>
              {trackers.map((t) => (
                <div key={t.id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="review-row-title">{t.title}</div>
                    <div className="review-row-meta">
                      <Link href={`/artist/${t.artist_id}`}>{t.artist}</Link>
                      {t.error ? <span className="feature-tag disputed-tag">last check failed: {t.error}</span> : (
                        <>
                          {t.statuses != null && <span>{n(t.statuses)} statuses filled</span>}
                          {t.details != null && <span>{n(t.details)} songs given details</span>}
                          {t.suggested != null && <span>{n(t.suggested)} new songs suggested</span>}
                        </>
                      )}
                      {t.open_disagreements > 0 && <Link href="/review/tracker">{t.open_disagreements} disagreements waiting</Link>}
                      {!t.auto_sync && <span className="feature-tag">not re-checked</span>}
                    </div>
                  </div>
                  <span className="comment-meta">{t.last_synced_at ? `checked ${ago(t.last_synced_at)}` : "not checked yet"}</span>
                </div>
              ))}
            </>
          )}

          {dead && (
            <>
              <div className="section-label" style={{ marginTop: 20 }}>Dead links</div>
              <div className="comment-meta" style={{ marginBottom: 8 }}>
                {n(dead.checked)} YouTube and SoundCloud links checked, {n(dead.dead)} taken down. Possible links that were taken
                down are removed automatically (they&apos;re in the undo history).
                {dead.songs.length > 0 ? " These songs' main listen link no longer works:" : ""}
              </div>
              {dead.songs.map((d) => (
                <div key={d.track_id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="review-row-title">
                      <Link href={`/artist/${d.artist_id}?highlight=${d.track_id}`}>{d.title}</Link>
                    </div>
                    <div className="review-row-meta"><span>{d.artist}</span><span style={{ overflowWrap: "anywhere" }}>{d.url}</span></div>
                  </div>
                </div>
              ))}
            </>
          )}

          <div className="section-label" style={{ marginTop: 20 }}>Timers</div>
          {bg && bg.failed_6h > 0 && (
            <div className="comments-panel" style={{ marginBottom: 10 }}>
              {bg.failed_6h} of {bg.calls_6h} background calls failed in the last 6 hours.
              {bg.last_error && <div className="comment-meta" style={{ marginTop: 4, overflowWrap: "anywhere" }}>Latest: {bg.last_error}</div>}
            </div>
          )}
          {timers.map((t) => (
            <div key={t.name} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title">{t.name}</div>
                <div className="review-row-meta">
                  <span>{TIMER_INFO[t.name] ?? t.schedule}</span>
                  {!t.active && <span className="feature-tag">off</span>}
                  {t.failed_24h > 0 && <span className="feature-tag disputed-tag">{t.failed_24h} failed today</span>}
                </div>
              </div>
              <span className="comment-meta">{t.last_run ? `ran ${ago(t.last_run)}` : "not run yet"}</span>
            </div>
          ))}

          <div className="section-label" style={{ marginTop: 20 }}>Automatic jobs</div>
          <div className="health-tiles">
            <Tile label="artists due a check" value={n(h.queue.due)} href="/admin/queue" />
            <Tile label="people with ChatGPT routines (7 days)" value={n(h.routine_users_last_7_days)} />
          </div>
          <div className="comment-meta" style={{ marginBottom: 6 }}>
            Spotify matching is {matcherRunning ? "running" : "idle"}: last song checked {ago(h.spotify_matching.last_checked_at)}
            {matcherRunning && <> ({n(h.spotify_matching.checked_last_hour)} in the last hour)</>}.
            {" "}Backups run nightly: <a href={BACKUPS_URL} target="_blank" rel="noopener noreferrer" className="text-link">check the latest</a>.
          </div>
          {h.queue.next.length > 0 && (
            <div className="comment-meta" style={{ marginBottom: 16 }}>
              Next up: {h.queue.next.map((q, i) => (
                <span key={q.artist_id}>
                  {i > 0 && ", "}
                  <Link href={`/artist/${q.artist_id}`} className="text-link">{q.name}</Link>
                </span>
              ))}
            </div>
          )}

          <div className="health-columns">
            <div style={{ minWidth: 0 }}>
              <div className="section-label">ChatGPT runs</div>
              {h.routine_runs.length === 0 && <div className="comment-meta">None yet.</div>}
              {h.routine_runs.map((x, i) => (
                <div key={i} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="review-row-title">
                      {x.who} · {x.artists} artist{x.artists === 1 ? "" : "s"} · {n(x.submitted)} sent
                    </div>
                    <div className="review-row-meta">
                      <span>{ago(x.started_at)}</span>
                      {x.summary && <span>{x.summary.length > 140 ? x.summary.slice(0, 140) + "…" : x.summary}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="section-label">Imports</div>
              {h.imports.length === 0 && <div className="comment-meta">None yet.</div>}
              {h.imports.map((x, i) => (
                <div key={i} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="review-row-title">
                      <Link href={`/artist/${x.artist_id}`}>{x.artist}</Link> · {SOURCE[x.source] ?? x.source}
                    </div>
                    <div className="review-row-meta">
                      <span>{ago(x.started_at)} by {x.who}</span>
                      {x.running ? <span>running…</span> : x.error ? <span className="feature-tag">failed</span> : (
                        <span>
                          {x.source === "spotify" ? `${x.added} added, ${x.updated} filled in` : `${x.suggested} sent for review`}
                          {x.skipped ? `, ${x.skipped} already there` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="section-label" style={{ marginTop: 20 }}>Recent bulk changes</div>
          {h.batches.map((b, i) => (
            <div key={i} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title">{b.label}</div>
                <div className="review-row-meta">
                  <span>{n(b.changes)} changes</span>
                  {b.undone && <span className="feature-tag">undone</span>}
                </div>
              </div>
              <span className="comment-meta">{ago(b.created_at)}</span>
            </div>
          ))}
          <div className="comment-meta" style={{ marginTop: 8 }}>
            <Link href="/admin/batches" className="text-link">Full undo history</Link>
          </div>

          <div className="section-label" style={{ marginTop: 24 }}>Catalogue</div>
          <div className="health-tiles">
            <Tile label="artists" value={n(h.catalogue.artists)} />
            <Tile label="songs" value={n(h.catalogue.songs)} />
            <Tile label="versions" value={n(h.catalogue.versions)} />
            <Tile label="with a listen link" value={n(h.catalogue.with_link)} />
            <Tile label="released" value={n(h.catalogue.released)} />
            <Tile label="leaked" value={n(h.catalogue.leaked)} />
            <Tile label="status unknown" value={n(h.catalogue.unconfirmed)} />
            <Tile label="added this week" value={n(h.catalogue.added_last_7_days)} />
          </div>
          </>)}
        </>
      )}
    </div>
  );
}
