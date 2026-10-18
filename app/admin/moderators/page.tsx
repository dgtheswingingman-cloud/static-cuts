"use client";

// Choose moderators. They can work the review queue, edit, add, merge and
// delete songs; everything they do shows in the undo history with their name.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsRealAdmin } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";

type Mod = { user_id: string; display_name: string | null; added_at: string; note: string | null; actions: number };
type Person = { user_id: string; display_name: string | null; is_moderator: boolean; contributions: number };

export default function ModeratorsPage() {
  const { user, loading: authLoading } = useAuth();
  const isRealAdmin = useIsRealAdmin();
  const router = useRouter();
  const [mods, setMods] = useState<Mod[] | null>(null);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.rpc("admin_list_moderators");
    if (error) { setMessage(error.message); return; }
    setMods((data as Mod[]) ?? []);
  }

  useEffect(() => {
    if (isRealAdmin) load();
  }, [isRealAdmin]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setPeople([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("admin_find_people", { p_query: q });
      setPeople((data as Person[]) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function setModerator(userId: string, on: boolean, name: string | null) {
    if (!on && !confirm(`Stop ${name ?? "this person"} being a moderator?`)) return;
    setBusy(userId);
    setMessage(null);
    const { error } = await supabase.rpc("admin_set_moderator", { p_user: userId, p_on: on });
    setBusy(null);
    if (error) { setMessage(error.message); return; }
    setMessage(on ? `${name ?? "They"} can now moderate.` : `${name ?? "They"} is no longer a moderator.`);
    setPeople((prev) => prev.map((p) => (p.user_id === userId ? { ...p, is_moderator: on } : p)));
    load();
  }

  if (!isRealAdmin) return <NoAccess loading={authLoading} who="admin" />;

  return (
    <div className="wrap" style={{ maxWidth: 680 }}>
      <button className="back-btn" onClick={() => router.push("/review")}>← review</button>
      <h1 className="detail-name page-title">Moderators</h1>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        Moderators can work the review queue, edit and add songs, merge duplicates and delete songs. Artists,
        takedowns, settings and the undo history stay yours. Everything they do shows in the{" "}
        <UndoHistoryLink /> with their name.
      </div>

      {message && <div className="comments-panel" style={{ marginBottom: 14 }}>{message}</div>}

      <div className="section-label" style={{ marginTop: 0 }}>Current moderators</div>
      {!mods && <div className="empty-state">loading…</div>}
      {mods && mods.length === 0 && <div className="comment-meta">None yet. Find someone below.</div>}
      {mods?.map((m) => (
        <div key={m.user_id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">
              <Link href={`/profile/${m.user_id}`}>{m.display_name ?? "unnamed"}</Link>
            </div>
            <div className="review-row-meta">
              <span>since {new Date(m.added_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              <span>{m.actions} change{m.actions === 1 ? "" : "s"} made</span>
            </div>
          </div>
          <button className="rating-chip danger" disabled={busy === m.user_id} onClick={() => setModerator(m.user_id, false, m.display_name)}>
            remove
          </button>
        </div>
      ))}

      <div className="section-label">Add a moderator</div>
      <input
        className="search-input"
        style={{ width: "100%" }}
        placeholder="Search by display name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim().length >= 2 && people.length === 0 && <div className="comment-meta" style={{ marginTop: 8 }}>No one found.</div>}
      {people.filter((p) => p.user_id !== user?.id).map((p) => (
        <div key={p.user_id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title"><Link href={`/profile/${p.user_id}`}>{p.display_name ?? "unnamed"}</Link></div>
            <div className="review-row-meta"><span>{p.contributions} contribution{p.contributions === 1 ? "" : "s"}</span></div>
          </div>
          {p.is_moderator ? (
            <span className="feature-tag">moderator</span>
          ) : (
            <button className="rating-chip" disabled={busy === p.user_id} onClick={() => setModerator(p.user_id, true, p.display_name)}>
              make moderator
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
