"use client";

// What's new: songs added and status changes, grouped per artist per day.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../useIsAdmin";

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

export default function WhatsNewPage() {
  const { loading: authLoading } = useAuth();
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("all");
  const [following, setFollowing] = useState(false);
  const [days, setDays] = useState<Day[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <h1 className="detail-name page-title">What&apos;s new</h1>
      <div className="detail-meta">Songs added to the archive and status changes, newest first.</div>

      <div className="tabs" style={{ alignItems: "center" }}>
        {KINDS.map(([k, label]) => (
          <button key={k} className={`tab ${kind === k ? "active" : ""}`} onClick={() => setKind(k)}>{label}</button>
        ))}
        {!isAdmin && (
          <button
            className={`tab ${following ? "active" : ""}`}
            onClick={() => (user ? setFollowing(!following) : router.push("/login"))}
            title="Only artists you follow"
          >
            {following ? "✓ " : ""}artists I follow
          </button>
        )}
      </div>

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
            <div key={i} className="feed-item">
              <div className="feed-head">
                <Link href={`/artist/${g.artist_id}`} className="feed-artist">{g.artist ?? "Unknown artist"}</Link>
                <span className="comment-meta">{headline(g)}</span>
                {g.kind === "status" && g.to_status && <span className="feature-tag">{g.to_status}</span>}
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
