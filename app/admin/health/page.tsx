"use client";

// Everything worth a glance in one place: what needs reviewing, anything
// that's gone wrong, and what the automatic jobs have been doing.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsRealAdmin } from "../../useIsAdmin";

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
      <div className="health-tile-value">{value}</div>
      <div className="health-tile-label">{label}</div>
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: "none" }}>{body}</Link> : body;
}

export default function HealthPage() {
  const { user, loading: authLoading } = useAuth();
  const isRealAdmin = useIsRealAdmin();
  const router = useRouter();
  const [h, setH] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && (!user || !isRealAdmin)) router.push("/");
  }, [authLoading, user, isRealAdmin, router]);

  async function load() {
    const { data, error: err } = await supabase.rpc("admin_health");
    if (err) { setError(err.message); return; }
    setError(null);
    setH(data as Health);
  }

  useEffect(() => {
    if (!isRealAdmin) return;
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [isRealAdmin]);

  if (!isRealAdmin) return null;

  const r = h?.reviews;
  const toReview = r ? r.submissions + r.discoveries + r.takedowns : 0;
  const matcherRunning = (h?.spotify_matching.checked_last_hour ?? 0) > 0;

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← back to archive</button>
      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>Site Health</h1>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        What needs looking at, what&apos;s gone wrong and what the automatic jobs have been doing. Refreshes every minute.
        {h && <> Updated {ago(h.generated_at)}.</>}
      </div>
      {error && <div className="comments-panel" style={{ marginBottom: 16 }}>Couldn&apos;t load: {error}</div>}
      {!h && !error && <div className="empty-state">loading…</div>}

      {h && r && (
        <>
          <div className="section-label">Needs you</div>
          <div className="health-tiles">
            <Tile label="takedown requests" value={n(r.takedowns)} href="/review/takedowns" alert={r.takedowns > 0} />
            <Tile label="submissions and finds" value={n(r.submissions + r.discoveries)} href="/review" alert={toReview > 25} />
            <Tile label="sub-versions to check" value={n(r.sub_versions)} href="/review/versions" />
            <Tile label="imported songs" value={n(r.imported_songs)} href="/review/imports" />
          </div>
          {r.takedowns > 0 && r.oldest_takedown && (
            <div className="comment-meta" style={{ marginBottom: 16 }}>Oldest takedown request is {ago(r.oldest_takedown)}.</div>
          )}

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

          <div className="section-label" style={{ marginTop: 20 }}>Automatic jobs</div>
          <div className="health-tiles">
            <Tile label={matcherRunning ? "Spotify matching: running" : "Spotify matching: idle"}
              value={`${n(h.spotify_matching.left)} left`} />
            <Tile label="artists due a check" value={n(h.queue.due)} href="/admin/queue" />
            <Tile label="people with ChatGPT routines (7 days)" value={n(h.routine_users_last_7_days)} />
          </div>
          <div className="comment-meta" style={{ marginBottom: 6 }}>
            Spotify: {n(h.spotify_matching.checked)} songs checked, last one {ago(h.spotify_matching.last_checked_at)}
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
        </>
      )}
    </div>
  );
}
