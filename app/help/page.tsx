"use client";

// Help wanted: small jobs anyone can do, busiest artists first.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin } from "../useIsAdmin";
import AdminModeNote from "../components/AdminModeNote";

type Kind = "links" | "info" | "status" | "thin";
type Counts = Record<Kind, number>;
type LinkItem = {
  id: string; track_id: string; url: string; link_title: string | null; source_domain: string | null;
  title: string; artist_id: string; artist: string; score: number; votes: number;
};
type SongItem = { id: string; title: string; artist_id: string; artist: string; missing?: string[] };
type ArtistItem = { artist_id: string; artist: string; songs: number };

const TABS: { kind: Kind; label: string; blurb: string }[] = [
  { kind: "links", label: "check links", blurb: "Is this link the right song? Open it, listen, then vote. Once enough people agree, the link goes on the song." },
  { kind: "info", label: "missing info", blurb: "Released songs with no release date or album. Open the song, then use “suggest an edit or a version”." },
  { kind: "status", label: "unknown status", blurb: "Songs nobody has marked yet: released, leaked, snippet, rumoured? Open the song and suggest an edit." },
  { kind: "thin", label: "thin pages", blurb: "Artists with 10 songs or fewer. Open the page and press “import songs” to fill it in." },
];

export default function HelpWantedPage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("links");
  const [following, setFollowing] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [items, setItems] = useState<unknown[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchItems(from: number) {
    const { data, error: err } = await supabase.rpc("rpc_help_wanted", { p_kind: kind, p_following: following, p_offset: from });
    if (err) { setError(err.message); return null; }
    return data as { counts: Counts; items: unknown[] };
  }

  useEffect(() => {
    if (authLoading) return;
    setItems(null);
    setError(null);
    fetchItems(0).then((d) => {
      if (!d) return;
      setCounts(d.counts);
      setItems(d.items);
      setHasMore(d.items.length === 30);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, following, authLoading, user?.id]);

  async function more() {
    // Voted links drop out of the list on the server too, so continue from
    // what's still showing rather than a fixed page size.
    const from = items?.length ?? 0;
    const d = await fetchItems(from);
    if (!d) return;
    setItems((prev) => [...(prev ?? []), ...d.items]);
    setHasMore(d.items.length === 30);
  }

  async function vote(item: LinkItem, value: 1 | -1) {
    if (!user) { router.push("/login"); return; }
    const { error: err } = await supabase
      .from("track_link_candidate_votes")
      .upsert({ candidate_id: item.id, user_id: user.id, vote: value });
    if (err) { setError(err.message); return; }
    setItems((prev) => (prev ?? []).filter((x) => (x as LinkItem).id !== item.id));
    setCounts((c) => (c ? { ...c, links: Math.max(0, c.links - 1) } : c));
  }

  const tab = TABS.find((t) => t.kind === kind)!;
  const visibleTabs = TABS.filter((t) => t.kind === kind || !counts || counts[t.kind] > 0);

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← home</button>
      <h1 className="detail-name">Help wanted</h1>
      <div className="detail-meta">Quick jobs that make the archive better. The artists people follow most come first.</div>

      <div className="tabs" style={{ alignItems: "center" }}>
        {visibleTabs.map((t) => (
          <button key={t.kind} className={`tab ${kind === t.kind ? "active" : ""}`} onClick={() => setKind(t.kind)}>
            {t.label}{counts ? ` (${counts[t.kind].toLocaleString("en-GB")})` : ""}
          </button>
        ))}
        <button className={`tab ${following ? "active" : ""}`} onClick={() => (user ? setFollowing(!following) : router.push("/login"))}>
          {following ? "✓ " : ""}artists I follow
        </button>
      </div>
      <div className="comment-meta" style={{ marginBottom: 14 }}>{tab.blurb}</div>
      {isAdmin && <div style={{ marginBottom: 14 }}><AdminModeNote what="vote on links or suggest fixes" /></div>}

      {error && <div className="empty-state">Something went wrong: {error}</div>}
      {!error && !items && <div className="empty-state">loading…</div>}
      {items && items.length === 0 && <div className="empty-state">Nothing to do here right now. Nice.</div>}

      {kind === "links" && (items as LinkItem[] | null)?.map((c) => (
        <div key={c.id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">
              <Link href={`/song/${c.track_id}`}>{c.title}</Link>
              <span className="comment-meta"> · {c.artist}</span>
            </div>
            <div className="review-row-meta">
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-link help-link">
                {c.link_title || c.url}
              </a>
              {c.source_domain && <span className="feature-tag">{c.source_domain.replace(/^(www|m)\./, "")}</span>}
              {c.votes > 0 && <span>{c.votes} vote{c.votes === 1 ? "" : "s"} so far</span>}
            </div>
          </div>
          {!isAdmin && (
            <div style={{ display: "flex", gap: 6 }}>
              <button className="rating-chip" title="This is the right song" onClick={() => vote(c, 1)}>✓ right</button>
              <button className="rating-chip" title="Wrong song, or not a listen link" onClick={() => vote(c, -1)}>✗ wrong</button>
            </div>
          )}
        </div>
      ))}

      {(kind === "info" || kind === "status") && (items as SongItem[] | null)?.map((s) => (
        <div key={s.id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title"><Link href={`/song/${s.id}`}>{s.title}</Link></div>
            <div className="review-row-meta">
              <Link href={`/artist/${s.artist_id}`}>{s.artist}</Link>
              {(s.missing ?? []).map((m) => <span key={m} className="feature-tag">no {m}</span>)}
            </div>
          </div>
          <Link href={`/artist/${s.artist_id}?highlight=${s.id}`} className="rating-chip">
            suggest edit
          </Link>
        </div>
      ))}

      {kind === "thin" && (items as ArtistItem[] | null)?.map((a) => (
        <div key={a.artist_id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title"><Link href={`/artist/${a.artist_id}`}>{a.artist}</Link></div>
            <div className="review-row-meta"><span>{a.songs} song{a.songs === 1 ? "" : "s"}</span></div>
          </div>
          <Link href={`/artist/${a.artist_id}`} className="rating-chip">import songs</Link>
        </div>
      ))}

      {hasMore && (
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button className="tab" onClick={more}>more</button>
        </div>
      )}
    </div>
  );
}
