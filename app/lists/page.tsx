"use client";

// Browse lists ("best Carti leaks"), see your own and the ones you follow,
// and start a new one.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { ListRowView, type ListRow } from "./ListRow";

type Kind = "popular" | "new" | "mine" | "following";

export default function ListsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("popular");
  const [lists, setLists] = useState<ListRow[] | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if ((kind === "mine" || kind === "following") && !user) { setLists([]); return; }
    setLists(null);
    supabase.rpc("rpc_browse_lists", { p_kind: kind }).then(({ data, error: err }) => {
      if (err) setError(err.message);
      setLists((data as ListRow[]) ?? []);
    });
  }, [kind, authLoading, user?.id]);

  async function create() {
    if (!user) { router.push("/login"); return; }
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    const { data, error: err } = await supabase.from("song_lists").insert({ title }).select("id").single();
    setCreating(false);
    if (err) { setError(err.message); return; }
    router.push(`/list/${data.id}`);
  }

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← home</button>
      <h1 className="detail-name">Lists</h1>
      <div className="detail-meta">Lists people have made: favourite leaks, best features, where to start with an artist.</div>

      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <input className="search-input" style={{ flex: "1 1 240px" }} placeholder="Start a new list… e.g. Best Carti leaks"
          value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} maxLength={120} />
        <button className="tab active" disabled={creating || !newTitle.trim()} onClick={create}>
          {creating ? "creating…" : user ? "create list" : "sign in to create"}
        </button>
      </div>

      <div className="tabs">
        {([["popular", "popular"], ["new", "recently updated"], ["mine", "my lists"], ["following", "following"]] as [Kind, string][]).map(([k, label]) => (
          <button key={k} className={`tab ${kind === k ? "active" : ""}`} onClick={() => setKind(k)}>{label}</button>
        ))}
      </div>

      {error && <div className="empty-state">{error}</div>}
      {!lists && <div className="empty-state">loading…</div>}
      {lists && lists.length === 0 && (
        <div className="empty-state">
          {kind === "mine" ? (user ? "You haven't made a list yet. Start one above, or press “add to list” on any song." : "Sign in to make lists.")
            : kind === "following" ? (user ? "You're not following any lists yet." : "Sign in to follow lists.")
            : "No lists yet. Be the first."}
        </div>
      )}
      {lists?.map((l) => <ListRowView key={l.id} l={l} />)}
    </div>
  );
}
