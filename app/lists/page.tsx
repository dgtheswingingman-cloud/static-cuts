"use client";

// Lists: what people have put together (favourite leaks, best features,
// where to start with an artist), your own and the ones you follow. Cards
// show the first covers on the list; the bookmark follows a list.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../useIsAdmin";
import AdminModeNote from "../components/AdminModeNote";
import type { ListRow } from "./ListRow";

type Kind = "popular" | "new" | "mine" | "following";
const KINDS: [Kind, string][] = [["popular", "All lists//"], ["new", "Recently updated"], ["mine", "My lists"], ["following", "Following"]];
const n0 = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(x >= 10000 ? 0 : 1)}K` : String(x));

export default function ListsPage() {
  const { loading: authLoading } = useAuth();
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("popular");
  const [lists, setLists] = useState<ListRow[] | null>(null);
  const [more, setMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [covers, setCovers] = useState<Record<string, string[]>>({});
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"default" | "songs" | "followers" | "az">("default");
  const [view, setView] = useState<"grid" | "rows">("grid");
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if ((kind === "mine" || kind === "following") && !user) { setLists([]); setMore(false); return; }
    setLists(null);
    supabase.rpc("rpc_browse_lists", { p_kind: kind, p_offset: 0 }).then(({ data, error: err }) => {
      if (err) setError(err.message);
      const l = (data as ListRow[]) ?? [];
      setLists(l);
      setMore(l.length >= 50);
    });
  }, [kind, authLoading, user?.id]);

  // Lists you follow (for the bookmarks).
  useEffect(() => {
    if (!user) { setFollowed(new Set()); return; }
    supabase.from("song_list_follows").select("list_id").eq("user_id", user.id).then(({ data }) =>
      setFollowed(new Set(((data ?? []) as { list_id: string }[]).map((r) => r.list_id))));
  }, [user?.id]);

  // The first few covers on each list.
  useEffect(() => {
    const ids = (lists ?? []).map((l) => l.id).filter((id) => !covers[id]);
    if (!ids.length) return;
    supabase.from("song_list_items").select("list_id, tracks(cover_url)").in("list_id", ids.slice(0, 60)).limit(1500).then(({ data }) => {
      const m: Record<string, string[]> = {};
      for (const id of ids) m[id] = [];
      for (const it of (data ?? []) as unknown as { list_id: string; tracks: { cover_url: string | null } | null }[]) {
        const u = it.tracks?.cover_url;
        if (u && m[it.list_id] && m[it.list_id].length < 4 && !m[it.list_id].includes(u)) m[it.list_id].push(u);
      }
      setCovers((p) => ({ ...p, ...m }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists]);

  async function loadMore() {
    setLoadingMore(true);
    const { data } = await supabase.rpc("rpc_browse_lists", { p_kind: kind, p_offset: lists?.length ?? 0 });
    setLoadingMore(false);
    const l = (data as ListRow[]) ?? [];
    setLists((p) => [...(p ?? []), ...l.filter((x) => !(p ?? []).some((y) => y.id === x.id))]);
    setMore(l.length >= 50);
  }

  async function toggleFollow(id: string) {
    if (!user) { router.push("/login"); return; }
    const on = followed.has(id);
    const { error: err } = on
      ? await supabase.from("song_list_follows").delete().eq("list_id", id).eq("user_id", user.id)
      : await supabase.from("song_list_follows").insert({ list_id: id });
    if (err) { setError(err.message); return; }
    setFollowed((p) => { const s = new Set(p); if (on) s.delete(id); else s.add(id); return s; });
    setLists((p) => (p ?? []).map((l) => (l.id === id ? { ...l, followers: l.followers + (on ? -1 : 1) } : l)));
  }

  async function create() {
    if (!user) { if (!isAdmin) router.push("/login"); return; }
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    const { data, error: err } = await supabase.from("song_lists").insert({ title }).select("id").single();
    setCreating(false);
    if (err) { setError(err.message); return; }
    router.push(`/list/${data.id}`);
  }

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let l = (lists ?? []).filter((x) => !needle || x.title.toLowerCase().includes(needle) || (x.description ?? "").toLowerCase().includes(needle)
      || (x.artists ?? []).some((a) => a.toLowerCase().includes(needle)) || x.owner_name.toLowerCase().includes(needle));
    if (sort === "songs") l = [...l].sort((a, b) => b.songs - a.songs);
    if (sort === "followers") l = [...l].sort((a, b) => b.followers - a.followers);
    if (sort === "az") l = [...l].sort((a, b) => a.title.localeCompare(b.title));
    return l;
  }, [lists, q, sort]);

  const heroImg = (lists ?? []).map((l) => covers[l.id]?.[0]).find(Boolean);
  const Bookmark = ({ on }: { on: boolean }) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg>
  );

  return (
    <div className="wrap ls-page">
      <header className="ls-hero" style={heroImg ? ({ "--ls-img": `url("${heroImg}")` } as CSSProperties) : undefined}>
        <div className="ls-crumb"><Link href="/library">My Library</Link> / <span>Lists</span></div>
        <h1 className="ls-title">LISTS<span>//</span></h1>
        <p className="ls-sub">Collections people have made from the archive. Favourite leaks, deep cuts, where to start.</p>
      </header>

      <div className="ls-bar">
        <nav className="rd-chips ls-chips" aria-label="Which lists">
          {KINDS.map(([k, label]) => (
            <button key={k} className={kind === k ? "on" : undefined} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
          ))}
        </nav>
        {!isAdmin && (
          <button className="ls-new" onClick={() => (user ? setCreatingOpen(!creatingOpen) : router.push("/login"))}>+ New list//</button>
        )}
      </div>

      {isAdmin && <div style={{ margin: "10px 0" }}><AdminModeNote what="make or follow lists" /></div>}
      {creatingOpen && user && (
        <div className="ls-create">
          <input className="sr-select" autoFocus placeholder="Name it… e.g. Best Carti leaks" value={newTitle} maxLength={120}
            onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          <button className="tab active" disabled={creating || !newTitle.trim()} onClick={create}>{creating ? "creating…" : "Create"}</button>
        </div>
      )}

      <div className="ls-tools">
        <div className="sr-box ls-search">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input placeholder="Search lists…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search lists" />
        </div>
        <select className="sr-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="default">Sort: {kind === "new" ? "recent" : "popular"}</option>
          <option value="songs">Sort: most songs</option>
          <option value="followers">Sort: most followed</option>
          <option value="az">Sort: A–Z</option>
        </select>
        <div className="ls-views">
          <button className={view === "grid" ? "on" : undefined} aria-label="Grid" aria-pressed={view === "grid"} onClick={() => setView("grid")}>▦</button>
          <button className={view === "rows" ? "on" : undefined} aria-label="List" aria-pressed={view === "rows"} onClick={() => setView("rows")}>☰</button>
        </div>
      </div>

      {error && <div className="empty-state">{error}</div>}
      {!lists && <div className="empty-state">loading…</div>}
      {lists && shown.length === 0 && (
        <div className="empty-state">
          {q ? `No lists match “${q}”.`
            : kind === "mine" ? (user ? "You haven't made a list yet. Hit + New list, or “add to list” on any song." : "Sign in to make lists.")
            : kind === "following" ? (user ? "You're not following any lists yet. Tap the bookmark on one." : "Sign in to follow lists.")
            : "No lists yet. Be the first."}
        </div>
      )}

      <div className={view === "grid" ? "ls-grid" : "ls-rows"}>
        {shown.map((l) => {
          const c = covers[l.id] ?? [];
          const mine = user?.id === l.owner_id;
          return (
            <article key={l.id} className="ls-card">
              <Link href={`/list/${l.id}`} className="ls-card-link" aria-label={l.title}>
                <span className={`ls-art ls-art-${Math.min(c.length, 4)}`}>
                  {c.length === 0 && <span className="ls-art-blank">SC//</span>}
                  {c.slice(0, c.length >= 4 ? 4 : 1).map((u, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={u} alt="" loading="lazy" />
                  ))}
                </span>
                <span className="ls-card-body">
                  <span className="ls-card-title">{l.title}<span>//</span></span>
                  <span className="ls-card-desc">{l.description || (l.artists && l.artists.length ? l.artists.slice(0, 3).join(", ") : `by ${l.owner_name}`)}</span>
                </span>
              </Link>
              <div className="ls-card-foot">
                <span>☰ {l.songs} track{l.songs === 1 ? "" : "s"}</span>
                <span className="ls-slash">/</span>
                <span title="followers">☺ {n0(l.followers)}</span>
                <Link href={`/profile/${l.owner_id}`} className="ls-owner">{l.owner_name}</Link>
                {!l.is_public && <span className="feature-tag">private</span>}
                {!mine && !isAdmin && (
                  <button className={`ls-follow ${followed.has(l.id) ? "on" : ""}`} aria-pressed={followed.has(l.id)}
                    aria-label={followed.has(l.id) ? "Unfollow list" : "Follow list"} onClick={() => toggleFollow(l.id)}>
                    <Bookmark on={followed.has(l.id)} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {lists && more && !q && (
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button className="tab" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "loading…" : "More lists"}</button>
        </div>
      )}
    </div>
  );
}
