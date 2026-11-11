"use client";

// Help wanted: small jobs anyone can do, busiest artists first. Your impact
// at the top, a quick yes/no question, then the jobs: check links, fill in
// missing info, set a status, add art for leaks, add songs to thin pages.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../useIsAdmin";
import AdminModeNote from "../components/AdminModeNote";
import VersionQuestions from "./VersionQuestions";
import { thumb } from "@/lib/thumb";

type Kind = "links" | "info" | "status" | "covers" | "thin";
type Counts = Record<Kind, number>;
type LinkItem = {
  id: string; track_id: string; url: string; link_title: string | null; source_domain: string | null;
  title: string; artist_id: string; artist: string; score: number; votes: number;
};
type SongItem = { id: string; title: string; artist_id: string; artist: string; missing?: string[]; status?: string };
type ArtistItem = { artist_id: string; artist: string; songs: number };
type Stats = { helped: number | null; week: number | null; link_votes: number | null; linked_pct: number };

const STATUSES = ["released", "leaked", "snippet", "teased", "rumored"];
const I = (d: ReactNode) => <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const TABS: { kind: Kind; label: string; title: string; blurb: string; icon: ReactNode }[] = [
  { kind: "links", label: "Check links", title: "Check links", blurb: "Is this link the right song? Open it, listen, then vote. Once enough people agree, the link goes on the song.",
    icon: I(<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />) },
  { kind: "info", label: "Missing info", title: "Missing info", blurb: "Released songs missing details. Fill in what you know.",
    icon: I(<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></>) },
  { kind: "status", label: "Unknown status", title: "Unknown status", blurb: "Songs nobody has marked yet. Tap what it is now; a moderator checks it.",
    icon: I(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01" /></>) },
  { kind: "covers", label: "Missing covers", title: "Missing covers", blurb: "Leaks and snippets with no artwork. Know the art that went with one? Add it on the song's page.",
    icon: I(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>) },
  { kind: "thin", label: "Thin pages", title: "Thin pages", blurb: "Artists with 10 songs or fewer. Add the ones you know.",
    icon: I(<><path d="M12 3 3 8l9 5 9-5z" /><path d="m3 13 9 5 9-5" /></>) },
];

export default function HelpWantedPage() {
  const { loading: authLoading } = useAuth();
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("links");
  const [following, setFollowing] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [items, setItems] = useState<unknown[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [faces, setFaces] = useState<Record<string, string>>({});
  const [statusInfo, setStatusInfo] = useState<Record<string, string | null>>({});
  const [sent, setSent] = useState<Record<string, string>>({});

  const loadStats = () => supabase.rpc("rpc_help_stats").then(({ data }) => setStats((data as Stats) ?? null));
  useEffect(() => { loadStats(); }, [user?.id]);

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

  // Covers for songs and photos for artists on screen.
  useEffect(() => {
    if (!items?.length) return;
    if (kind === "thin") {
      const ids = (items as ArtistItem[]).map((a) => a.artist_id).filter((id) => !(id in faces));
      if (ids.length) supabase.from("artists").select("id, image_url").in("id", ids).then(({ data }) => {
        const m: Record<string, string> = {};
        for (const id of ids) m[id] = "";
        for (const r of (data ?? []) as { id: string; image_url: string | null }[]) if (r.image_url) m[r.id] = r.image_url;
        setFaces((p) => ({ ...p, ...m }));
      });
      return;
    }
    const ids = (items as (LinkItem | SongItem)[]).map((x) => ("track_id" in x ? x.track_id : x.id)).filter((id) => !(id in covers));
    if (ids.length) supabase.from("tracks").select("id, cover_url, release_status").in("id", ids).then(({ data }) => {
      const m: Record<string, string> = {};
      const st: Record<string, string | null> = {};
      for (const id of ids) m[id] = "";
      for (const r of (data ?? []) as { id: string; cover_url: string | null; release_status: string | null }[]) { if (r.cover_url) m[r.id] = r.cover_url; st[r.id] = r.release_status; }
      setCovers((p) => ({ ...p, ...m }));
      setStatusInfo((p) => ({ ...p, ...st }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, kind]);

  async function more() {
    // Voted links drop out of the list on the server too, so continue from
    // what's still showing rather than a fixed page size.
    const d = await fetchItems(items?.length ?? 0);
    if (!d) return;
    setItems((prev) => [...(prev ?? []), ...d.items]);
    setHasMore(d.items.length === 30);
  }

  async function vote(item: LinkItem, value: 1 | -1) {
    if (!user) { if (!isAdmin) router.push("/login"); return; }
    const { error: err } = await supabase.from("track_link_candidate_votes").upsert({ candidate_id: item.id, user_id: user.id, vote: value });
    if (err) { setError(err.message); return; }
    setItems((prev) => (prev ?? []).filter((x) => (x as LinkItem).id !== item.id));
    setCounts((c) => (c ? { ...c, links: Math.max(0, c.links - 1) } : c));
    loadStats();
  }

  async function setStatus(s: SongItem, to: string) {
    if (!user) { if (!isAdmin) router.push("/login"); return; }
    const { error: err } = await supabase.from("submissions").insert({
      type: "status_change", artist_id: s.artist_id, submitted_by: user.id,
      payload: { track_id: s.id, from_status: statusInfo[s.id] ?? null, to_status: to },
    });
    if (err) { setError(err.message); return; }
    setSent((p) => ({ ...p, [s.id]: to }));
    loadStats();
  }

  const tab = TABS.find((t) => t.kind === kind)!;
  const n0 = (x: number) => x.toLocaleString("en-GB");
  const Cover = ({ id, round }: { id: string; round?: boolean }) => {
    const u = round ? faces[id] : covers[id];
    return u
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={thumb(u)} alt="" className={`hw-cover ${round ? "round" : ""}`} loading="lazy" />
      : <span className={`hw-cover blank ${round ? "round" : ""}`}>SC//</span>;
  };

  return (
    <div className="wrap hw-page">
      <h1 className="ls-title hw-title">HELP WANTED<span>//</span></h1>
      <p className="sb-lead">Quick jobs that make the archive better. The artists people follow most come first.</p>

      {stats && (
        <div className="hw-impact">
          {user && stats.helped !== null && (
            <span className="hw-impact-you">You&apos;ve helped <b>{n0(stats.helped)}</b> time{stats.helped === 1 ? "" : "s"}{stats.week ? <> · <b>{n0(stats.week)}</b> this week</> : null}</span>
          )}
          <span className="hw-impact-bar">
            <span>Songs with a listen link <b>{stats.linked_pct}%</b></span>
            <span className="sb-trust-bar"><span style={{ width: `${stats.linked_pct}%` }} /></span>
          </span>
        </div>
      )}

      {user && !isAdmin && <VersionQuestions />}

      <nav className="hw-tabs" aria-label="Jobs">
        {TABS.map((t) => (
          <button key={t.kind} className={kind === t.kind ? "on" : undefined} aria-pressed={kind === t.kind} onClick={() => setKind(t.kind)}>
            {t.icon}
            <span>{t.label}</span>
            {counts && <em>({n0(counts[t.kind])})</em>}
          </button>
        ))}
        {!isAdmin && (
          <button className={`hw-follow ${following ? "on" : ""}`} aria-pressed={following} onClick={() => (user ? setFollowing(!following) : router.push("/login"))}>
            {I(<path d="M4 5h16l-6 7v6l-4 2v-8z" />)}
            <span>{following ? "✓ " : ""}Artists I follow//</span>
          </button>
        )}
      </nav>

      <section className="nw-panel hw-panel">
        <h2 className="nw-h hw-h">{tab.title}<span>//</span></h2>
        <p className="hw-blurb">{tab.blurb}</p>
        {isAdmin && <div style={{ marginBottom: 14 }}><AdminModeNote what="vote on links or suggest fixes" /></div>}

        {error && <div className="sb-error">Something went wrong: {error}</div>}
        {!error && !items && <div className="comment-meta">loading…</div>}
        {items && items.length === 0 && <div className="hw-done">All done here. Nice.</div>}

        {kind === "links" && (items as LinkItem[] | null)?.map((c) => (
          <div key={c.id} className="hw-row hw-link">
            <Cover id={c.track_id} />
            <div className="hw-main">
              <Link href={`/song/${c.track_id}`} className="hw-song">{c.title}</Link>
              <span className="hw-artist">{c.artist}</span>
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="hw-source">
                <span className="hw-source-text">
                  <span>{c.link_title || c.url}</span>
                  {c.source_domain && <small>{c.source_domain.replace(/^(www|m)\./, "")}</small>}
                </span>
                <span className="hw-open">Open ↗</span>
              </a>
              {stats?.link_votes ? (
                <span className="hw-votes">
                  <span>{Math.max(0, c.score)} of {stats.link_votes} votes</span>
                  <span className="sb-trust-bar"><span style={{ width: `${Math.min(100, (Math.max(0, c.score) / stats.link_votes) * 100)}%` }} /></span>
                </span>
              ) : c.votes > 0 ? <span className="hw-votes"><span>{c.votes} vote{c.votes === 1 ? "" : "s"} so far</span></span> : null}
            </div>
            {!isAdmin && (
              <div className="hw-vote">
                <button className="hw-right" onClick={() => vote(c, 1)}>✓ Right//</button>
                <button className="hw-wrong" onClick={() => vote(c, -1)}>✗ Wrong//</button>
              </div>
            )}
          </div>
        ))}

        {kind === "info" && (items as SongItem[] | null)?.map((s) => (
          <div key={s.id} className="hw-row">
            <Cover id={s.id} />
            <div className="hw-main">
              <Link href={`/song/${s.id}`} className="hw-song">{s.title}</Link>
              <Link href={`/artist/${s.artist_id}`} className="hw-artist">{s.artist}</Link>
              {(s.missing ?? []).length > 0 && (
                <span className="hw-missing"><small>Missing:</small>{(s.missing ?? []).map((m) => <span key={m} className="hw-chip">{m}</span>)}</span>
              )}
            </div>
            {!isAdmin && <Link href={`/submit?type=correction&track_id=${s.id}`} className="ms-say hw-act">Fill in//</Link>}
          </div>
        ))}

        {kind === "status" && (items as SongItem[] | null)?.map((s) => (
          <div key={s.id} className="hw-row">
            <Cover id={s.id} />
            <div className="hw-main">
              <Link href={`/song/${s.id}`} className="hw-song">{s.title}</Link>
              <Link href={`/artist/${s.artist_id}`} className="hw-artist">{s.artist}</Link>
              {sent[s.id] ? (
                <span className="hw-sent">Sent: <span className={`feature-tag st st-${sent[s.id]}`}>{sent[s.id]}</span>. Thanks!</span>
              ) : !isAdmin && (
                <span className="sb-chips hw-status">
                  {STATUSES.map((x) => <button key={x} className={`feature-tag st st-${x}`} onClick={() => setStatus(s, x)}>{x}//</button>)}
                </span>
              )}
            </div>
          </div>
        ))}

        {kind === "covers" && (items as SongItem[] | null)?.map((s) => (
          <div key={s.id} className="hw-row">
            <Cover id={s.id} />
            <div className="hw-main">
              <Link href={`/song/${s.id}`} className="hw-song">{s.title}</Link>
              <Link href={`/artist/${s.artist_id}`} className="hw-artist">{s.artist}</Link>
              {s.status && <span className="hw-missing"><span className={`feature-tag st st-${s.status}`}>{s.status}</span></span>}
            </div>
            {!isAdmin && <Link href={`/song/${s.id}#covers`} className="ms-say hw-act">Add a cover//</Link>}
          </div>
        ))}

        {kind === "thin" && (items as ArtistItem[] | null)?.map((a) => (
          <div key={a.artist_id} className="hw-row">
            <Cover id={a.artist_id} round />
            <div className="hw-main">
              <Link href={`/artist/${a.artist_id}`} className="hw-song">{a.artist}</Link>
              <span className="hw-artist">Only {a.songs} song{a.songs === 1 ? "" : "s"}</span>
            </div>
            {!isAdmin && <Link href={`/submit?type=new_track&artist_id=${a.artist_id}&artist_name=${encodeURIComponent(a.artist)}`} className="ms-say hw-act">Add songs//</Link>}
          </div>
        ))}

        {hasMore && (
          <div style={{ textAlign: "center", marginTop: 16 }}><button className="st-btn" onClick={more}>More</button></div>
        )}
      </section>
    </div>
  );
}
