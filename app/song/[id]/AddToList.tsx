"use client";

// "Add to list" on a song page: tick the lists it should be on, or start a
// new one. Also shows public lists the song is already on.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../../useIsAdmin";
import type { ListRow } from "../../lists/ListRow";

export default function AddToList({ trackId }: { trackId: string }) {
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<ListRow[] | null>(null);
  const [onLists, setOnLists] = useState<ListRow[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("rpc_browse_lists", { p_kind: "song", p_track: trackId }).then(({ data }) => setOnLists((data as ListRow[]) ?? []));
  }, [trackId]);

  async function loadMine() {
    const { data } = await supabase.rpc("rpc_browse_lists", { p_kind: "mine", p_track: trackId });
    setMine((data as ListRow[]) ?? []);
  }

  function toggleOpen() {
    if (!user) { if (!isAdmin) router.push("/login"); return; }
    if (!open) loadMine();
    setOpen(!open);
  }

  async function toggle(l: ListRow) {
    setBusy(l.id);
    setError(null);
    const { error: err } = l.has_track
      ? await supabase.from("song_list_items").delete().eq("list_id", l.id).eq("track_id", trackId)
      : await supabase.from("song_list_items").insert({ list_id: l.id, track_id: trackId });
    setBusy(null);
    if (err) { setError(err.message); return; }
    loadMine();
  }

  async function createAndAdd() {
    const t = title.trim();
    if (!t) return;
    setBusy("new");
    setError(null);
    const { data, error: err } = await supabase.from("song_lists").insert({ title: t }).select("id").single();
    if (!err && data) await supabase.from("song_list_items").insert({ list_id: data.id, track_id: trackId });
    setBusy(null);
    if (err) { setError(err.message); return; }
    setTitle("");
    loadMine();
  }

  const onMine = (mine ?? []).filter((l) => l.has_track).length;

  return (
    <>
      <button className={`tab ${onMine > 0 ? "active" : ""}`} onClick={toggleOpen}>
        {onMine > 0 ? `✓ on ${onMine} list${onMine === 1 ? "" : "s"}` : "add to list"}
      </button>
      {open && (
        <div className="comments-panel add-to-list">
          {!mine && <div className="comment-meta">loading…</div>}
          {mine?.map((l) => (
            <label key={l.id} className="comment-body" style={{ display: "flex", gap: 10, alignItems: "center", padding: "4px 0" }}>
              <input type="checkbox" checked={!!l.has_track} disabled={busy === l.id} onChange={() => toggle(l)} />
              <span>{l.title} <span className="comment-meta">({l.songs})</span></span>
            </label>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input className="search-input" style={{ flex: 1 }} placeholder="New list…" value={title} maxLength={120}
              onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createAndAdd()} />
            <button className="rating-chip" disabled={!title.trim() || busy === "new"} onClick={createAndAdd}>create + add</button>
          </div>
          {error && <div className="comment-meta error-text">{error}</div>}
        </div>
      )}
      {onLists.length > 0 && !open && (
        <div className="comment-meta" style={{ width: "100%", marginTop: 4 }}>
          On {onLists.length === 1 ? "a list" : `${onLists.length} lists`}:{" "}
          {onLists.slice(0, 3).map((l, i) => (
            <span key={l.id}>{i > 0 && ", "}<Link href={`/list/${l.id}`} className="text-link">{l.title}</Link></span>
          ))}
          {onLists.length > 3 && ` and ${onLists.length - 3} more`}
        </div>
      )}
    </>
  );
}
