"use client";

// Possible duplicate tracks: the same title twice on one artist's page, or a
// collab copied onto each collaborator's page. Pick the copy to keep, untick
// anything that isn't really the same song, and merge. Collections, ratings,
// comments, sub-versions and link suggestions move to the kept copy, the old
// titles become aliases and the old pages redirect.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin } from "../../useIsAdmin";
import QuickMerge from "./QuickMerge";

type DupTrack = {
  track_id: string;
  artist_id: string;
  artist_name: string;
  title: string;
  status: string;
  link: string | null;
  release_date: string | null;
  aliases: string | null;
  versions: number;
  collected: number;
  ratings: number;
  comments: number;
  appears_on: string[];
};

type Report = { verdict: "same" | "different"; confidence: number | null; source_url: string | null; notes: string | null };

type Group = {
  group_id: string;
  key: string;
  same_artist: boolean;
  tracks: DupTrack[];
  reports: Report[];
};

const PAGE = 20;

export default function DuplicatesPage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [artists, setArtists] = useState<{ id: string; name: string }[]>([]);
  const [artistFilter, setArtistFilter] = useState("");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Record<string, Set<string>>>({});

  useEffect(() => {
    if (!authLoading && !user) router.push("/login?next=/review/duplicates");
  }, [authLoading, user, router]);

  useEffect(() => {
    supabase.from("artists").select("id, name").order("name").then(({ data }) => setArtists(data ?? []));
  }, []);

  async function load(reset: boolean) {
    const from = reset ? 0 : offset;
    const { data, error: err } = await supabase.rpc("find_duplicate_groups", {
      p_artist_id: artistFilter || null,
      p_limit: PAGE,
      p_offset: from,
    });
    if (err) { setError(err.message); setGroups([]); return; }
    setError(null);
    const page: Group[] = (data as any)?.groups ?? [];
    setTotal((data as any)?.total ?? 0);
    setGroups((prev) => (reset || !prev ? page : [...prev, ...page]));
    setOffset(from + page.length);
  }

  useEffect(() => {
    if (user) load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, artistFilter]);

  function removeGroup(groupId: string) {
    setGroups((prev) => (prev ?? []).filter((g) => g.group_id !== groupId));
    setTotal((t) => Math.max(0, t - 1));
    setOffset((o) => Math.max(0, o - 1));
  }

  function keptId(g: Group) {
    return keep[g.group_id] ?? g.tracks[0]?.track_id;
  }

  function isIncluded(g: Group, trackId: string) {
    return !(excluded[g.group_id]?.has(trackId));
  }

  function toggleIncluded(g: Group, trackId: string) {
    setExcluded((prev) => {
      const s = new Set(prev[g.group_id] ?? []);
      if (s.has(trackId)) s.delete(trackId); else s.add(trackId);
      return { ...prev, [g.group_id]: s };
    });
  }

  async function merge(g: Group) {
    const survivor = keptId(g);
    const dups = g.tracks.map((t) => t.track_id).filter((id) => id !== survivor && isIncluded(g, id));
    if (dups.length === 0) { alert("Tick at least one other copy to merge."); return; }
    const kept = g.tracks.find((t) => t.track_id === survivor)!;
    const ok = window.confirm(
      `Merge ${dups.length} cop${dups.length === 1 ? "y" : "ies"} into "${kept.title}" on ${kept.artist_name}'s page?\n\n` +
        "Collections, ratings, comments, versions and link suggestions move over. The other titles become aliases " +
        "and their pages redirect. This can't be undone from here."
    );
    if (!ok) return;
    setBusy(g.group_id);
    const { error: err } = await supabase.rpc("admin_merge_duplicates", { p_survivor: survivor, p_duplicates: dups });
    setBusy(null);
    if (err) { alert(err.message); return; }
    removeGroup(g.group_id);
  }

  async function dismiss(g: Group) {
    setBusy(g.group_id);
    const { error: err } = await supabase.rpc("dismiss_duplicate_group", { p_track_ids: g.tracks.map((t) => t.track_id) });
    setBusy(null);
    if (err) { alert(err.message); return; }
    removeGroup(g.group_id);
  }

  if (user && !isAdmin) {
    return (
      <div className="wrap">
        <div className="empty-state">Only the reviewer can merge duplicates.</div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/review")}>← back to review queue</button>
      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>Possible duplicates</h1>
      <div className="detail-meta" style={{ marginBottom: 14, maxWidth: 620 }}>
        The same song entered more than once: twice on one artist&apos;s page, or a collab copied onto each
        collaborator. Choose the copy to <b>keep</b> (the one on the main artist&apos;s page), untick anything that
        isn&apos;t really the same song, then merge. ChatGPT routines add their verdict when they&apos;ve checked a group.
      </div>

      {user && isAdmin && <QuickMerge onMerged={() => load(true)} />}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <select
          className="search-input"
          style={{ maxWidth: 260 }}
          value={artistFilter}
          onChange={(e) => setArtistFilter(e.target.value)}
        >
          <option value="">All artists</option>
          {artists.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <span className="comment-meta">{groups === null ? "" : `${total} group${total === 1 ? "" : "s"}`}</span>
      </div>

      {error && <div className="empty-state" style={{ borderColor: "#a33" }}>{error}</div>}
      {!error && groups === null && <div className="empty-state">loading…</div>}
      {!error && groups && groups.length === 0 && <div className="empty-state">No possible duplicates found.</div>}

      {groups?.map((g) => {
        const same = g.reports.filter((r) => r.verdict === "same");
        const diff = g.reports.filter((r) => r.verdict === "different");
        return (
          <div key={g.group_id} className="track-row" style={{ cursor: "default", flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="track-title">&quot;{g.tracks[0]?.title}&quot;</span>
              <span className="feature-tag">{g.same_artist ? "same artist" : "across collaborators"}</span>
              {same.length > 0 && (
                <span className="feature-tag">ChatGPT: same song ({same.length})</span>
              )}
              {diff.length > 0 && (
                <span className="feature-tag">ChatGPT: different ({diff.length})</span>
              )}
            </div>

            {g.reports.map((r, i) => (
              <div key={i} className="comment-meta" style={{ fontStyle: "italic", wordBreak: "break-word" }}>
                {r.verdict === "same" ? "Same" : "Different"}
                {r.confidence !== null && ` (${Math.round(r.confidence * 100)}%)`}
                {r.notes && `: ${r.notes}`}
                {r.source_url && (
                  <> · <a href={r.source_url} target="_blank" rel="noopener noreferrer">source</a></>
                )}
              </div>
            ))}

            {g.tracks.map((t) => {
              const isKept = keptId(g) === t.track_id;
              const included = isIncluded(g, t.track_id);
              return (
                <div
                  key={t.track_id}
                  style={{
                    display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap",
                    border: "1px solid var(--hair)", borderRadius: 4, padding: "6px 8px",
                    background: isKept ? "var(--surface2)" : "transparent",
                    opacity: !isKept && !included ? 0.5 : 1,
                  }}
                >
                  <label className="comment-meta" style={{ display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name={`keep-${g.group_id}`}
                      checked={isKept}
                      onChange={() => setKeep((p) => ({ ...p, [g.group_id]: t.track_id }))}
                    />
                    keep
                  </label>
                  {!isKept && (
                    <label className="comment-meta" style={{ display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
                      <input type="checkbox" checked={included} onChange={() => toggleIncluded(g, t.track_id)} />
                      same song
                    </label>
                  )}
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: "0.88rem" }}>
                      <Link href={`/artist/${t.artist_id}?highlight=${t.track_id}`} style={{ color: "var(--bone)" }}>
                        {t.title}
                      </Link>
                      <span className="comment-meta"> · {t.artist_name}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
                      <span className="feature-tag">{t.status}</span>
                      {t.link ? (
                        <a className="feature-tag" href={t.link} target="_blank" rel="noopener noreferrer">has link</a>
                      ) : (
                        <span className="feature-tag">no link</span>
                      )}
                      {t.release_date && <span className="feature-tag">{t.release_date}</span>}
                      {t.versions > 0 && <span className="feature-tag">{t.versions} version{t.versions === 1 ? "" : "s"}</span>}
                      {t.collected > 0 && <span className="feature-tag">{t.collected} collected</span>}
                      {t.ratings > 0 && <span className="feature-tag">{t.ratings} rating{t.ratings === 1 ? "" : "s"}</span>}
                      {t.comments > 0 && <span className="feature-tag">{t.comments} comment{t.comments === 1 ? "" : "s"}</span>}
                      {t.appears_on.length > 0 && <span className="feature-tag">linked: {t.appears_on.join(", ")}</span>}
                    </div>
                  </div>
                </div>
              );
            })}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="listen-link" disabled={busy === g.group_id} onClick={() => merge(g)}>
                {busy === g.group_id ? "…" : "merge"}
              </button>
              <button className="listen-link" disabled={busy === g.group_id} onClick={() => dismiss(g)}>
                not duplicates
              </button>
            </div>
          </div>
        );
      })}

      {groups && groups.length > 0 && groups.length < total && (
        <button className="tab" style={{ marginTop: 10 }} onClick={() => load(false)}>
          load more
        </button>
      )}
    </div>
  );
}
