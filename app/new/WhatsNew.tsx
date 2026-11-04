"use client";

// What's new: songs added and status changes, grouped per artist per day.

import { useEffect, useState } from "react";
import Link from "next/link";
import RadarTabs from "../components/RadarTabs";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { usePersonalUser } from "../useIsAdmin";

type Group = {
  kind: "added" | "status";
  artist_id: string;
  artist: string | null;
  to_status: string | null;
  count: number;
  at: string;
  tracks: { id: string; title: string; from: string | null }[];
};
type Day = { day: string; groups: Group[] };
type Kind = "all" | "status" | "added";

const KINDS: [Kind, string][] = [["all", "everything"], ["status", "status changes"], ["added", "new songs"]];

function dayLabel(day: string) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const y = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  if (day === today) return "Today";
  if (day === y) return "Yesterday";
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function headline(g: Group) {
  const n = g.count;
  if (g.kind === "added") return `${n} song${n === 1 ? "" : "s"} added`;
  return `${n === 1 ? "1 song" : `${n} songs`} now ${g.to_status}`;
}

// Also the Radar "Following" tab (/new/following), for artists you follow only.
export default function WhatsNew({ followingOnly }: { followingOnly: boolean }) {
  const { loading: authLoading } = useAuth();
  const user = usePersonalUser();
  const [kind, setKind] = useState<Kind>("all");
  const following = followingOnly;
  const [days, setDays] = useState<Day[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});

  // Artist photos for the rows.
  useEffect(() => {
    const ids = [...new Set((days ?? []).flatMap((d) => d.groups.map((g) => g.artist_id)))].filter((id) => !(id in photos)).slice(0, 200);
    if (!ids.length) return;
    supabase.from("artists").select("id, image_url").in("id", ids).then(({ data }) => {
      const m: Record<string, string> = {};
      for (const id of ids) m[id] = "";
      for (const a of (data ?? []) as { id: string; image_url: string | null }[]) m[a.id] = a.image_url ?? "";
      setPhotos((p) => ({ ...p, ...m }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  async function fetchPage(before: string | null) {
    const { data, error: err } = await supabase.rpc("rpc_whats_new", {
      p_before: before, p_kind: kind, p_following: following, p_days: 3,
    });
    if (err) { setError(err.message); return null; }
    return data as { days: Day[]; next: string | null };
  }

  useEffect(() => {
    if (authLoading) return;
    setDays(null);
    setError(null);
    fetchPage(null).then((d) => {
      if (!d) return;
      setDays(d.days);
      setNext(d.next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, following, authLoading, user?.id]);

  async function loadMore() {
    if (!next) return;
    setLoadingMore(true);
    const d = await fetchPage(next);
    setLoadingMore(false);
    if (!d) return;
    setDays((prev) => [...(prev ?? []), ...d.days]);
    setNext(d.next);
  }

  return (
    <div className="wrap">
      <RadarTabs active={following ? "following" : "new"} />
      <h1 className="detail-name page-title">{following ? "Following" : "What\u2019s new"}</h1>
      <div className="detail-meta">Songs added to the archive and status changes, newest first.</div>

      <nav className="rd-chips rd-subchips" aria-label="Show">
        {KINDS.map(([k, label]) => (
          <button key={k} className={kind === k ? "on" : undefined} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
        ))}
      </nav>

      {following && !authLoading && !user && (
        <div className="empty-state"><Link href="/login" className="text-link">Log in</Link> and follow artists to see their updates here.</div>
      )}
      {error && <div className="empty-state">Couldn&apos;t load the feed: {error}</div>}
      {!error && !days && <div className="empty-state">loading…</div>}
      {days && days.length === 0 && (
        <div className="empty-state">
          {following ? "Nothing new from the artists you follow lately." : "Nothing new lately."}
        </div>
      )}

      {days?.map((d) => (
        <div key={d.day}>
          <div className="section-label">{dayLabel(d.day)}</div>
          {d.groups.map((g, i) => (
            <div key={i} className="feed-item rd-feed" data-st={g.kind === "added" ? "added" : g.to_status ?? ""}>
              <Link href={`/artist/${g.artist_id}`} className="rd-feed-photo" aria-hidden="true" tabIndex={-1}>
                {photos[g.artist_id]
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={photos[g.artist_id]} alt="" loading="lazy" />
                  : <span>{(g.artist ?? "?").slice(0, 1)}</span>}
              </Link>
              <div className="rd-feed-body">
              <div className="feed-head">
                <Link href={`/artist/${g.artist_id}`} className="feed-artist">{g.artist ?? "Unknown artist"}</Link>
                <span className="comment-meta">{headline(g)}</span>
                <span className={`feature-tag st st-${g.kind === "added" ? "added" : g.to_status}`}>{g.kind === "added" ? "added" : g.to_status}</span>
              </div>
              <div className="feed-tracks">
                {g.tracks.map((t) => (
                  <Link key={t.id} href={`/song/${t.id}`} className="feed-track">
                    {t.title}
                    {g.kind === "status" && t.from && t.from !== "unconfirmed" && (
                      <span className="comment-meta"> (was {t.from})</span>
                    )}
                  </Link>
                ))}
                {g.count > g.tracks.length && (
                  <Link href={`/artist/${g.artist_id}`} className="feed-track comment-meta">
                    +{g.count - g.tracks.length} more
                  </Link>
                )}
              </div>
              </div>
            </div>
          ))}
        </div>
      ))}

      {next && (
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <button className="tab" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "loading…" : "older"}</button>
        </div>
      )}
    </div>
  );
}
