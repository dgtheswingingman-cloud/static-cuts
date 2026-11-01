"use client";

// Guests: people songs here are credited to who don't have a page yet.
// Most are sorted automatically (checked against Spotify every 10 minutes);
// the ones it couldn't confirm wait here. Add makes a page and moves their
// songs onto it (they stay on the other artist's page as a feature); skip
// leaves them as a note.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";
import { ModPage, ModRow, ModButton, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

type Guest = { name_key: string; name: string; songs: number; state: "review" | "pending"; note: string | null; sample: string[] | null };

export default function GuestsPage() {
  const { user, loading: authLoading } = useAuth();
  const canModerate = useIsModerator();
  const [rows, setRows] = useState<Guest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<{ id: string; name: string }[]>([]);

  async function load() {
    const { data, error } = await supabase.rpc("admin_guest_artists");
    if (error) setMessage(error.message);
    setRows((data as Guest[]) ?? []);
  }
  useEffect(() => {
    if (canModerate) load();
  }, [canModerate]);

  useEffect(() => {
    if (q.trim().length < 2) { setMatches([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("artists").select("id, name").ilike("name", `%${q.trim()}%`).limit(8);
      setMatches(data ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function act(g: Guest, action: "create" | "skip" | "link", artistId?: string) {
    setBusy(g.name_key);
    setMessage(null);
    const { data, error } = await supabase.rpc("admin_guest_action", { p_key: g.name_key, p_action: action, p_artist: artistId ?? null });
    setBusy(null);
    if (error) { setMessage(error.message); return; }
    if (action !== "skip") setMessage(`${g.name}: ${g.songs} song${g.songs === 1 ? "" : "s"} moved.`);
    setLinking(null);
    setQ("");
    setRows((prev) => (prev ?? []).filter((x) => x.name_key !== g.name_key));
    void data;
  }

  // Fix a misspelt or oddly written name before adding them.
  async function rename(g: { name_key: string; name: string }) {
    const name = prompt("Their name as it should appear:", g.name);
    if (!name || name.trim() === g.name) return;
    const { error } = await supabase.rpc("admin_guest_edit", { p_key: g.name_key, p_name: name.trim() });
    if (error) { setMessage(error.message); return; }
    setRows((prev) => (prev ?? []).map((x) => (x.name_key === g.name_key ? { ...x, name: name.trim() } : x)));
  }

  const review = useMemo(() => (rows ?? []).filter((r) => r.state === "review").map((r) => ({ ...r, id: r.name_key })), [rows]);
  const pending = (rows ?? []).filter((r) => r.state === "pending");

  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;

  return (
    <ModPage
      title="Guest artists"
      intro={<>
        People songs are credited to who don&apos;t have a page yet. Every 10 minutes a few are checked on Spotify: matches
        get a page automatically (once the artists you follow are filled in first). These are the ones it couldn&apos;t
        confirm. <b>Add</b> makes a page and moves their songs there (they still show as features); <b>dismiss</b> leaves
        them as a note. Everything is in the <UndoHistoryLink />.
      </>}
    >
      {message && <ModNotice onClose={() => setMessage(null)}>{message}</ModNotice>}
      {!rows && <ModLoading />}
      {rows && review.length === 0 && <ModEmpty>Nothing to check right now.</ModEmpty>}

      {review.map((g) => (
        <ModRow
          key={g.name_key}
          title={g.name}
          meta={<>
            <span>{g.songs} song{g.songs === 1 ? "" : "s"}</span>
            {g.note && <span>{g.note}</span>}
            {g.sample && <span>{g.sample.join(" · ")}</span>}
          </>}
          actions={<>
            <ModButton kind="approve" busy={busy === g.name_key} onClick={() => act(g, "create")}>add</ModButton>
            <ModButton busy={busy === g.name_key} onClick={() => { setLinking(linking === g.name_key ? null : g.name_key); setQ(""); }}>same as…</ModButton>
            <ModButton busy={busy === g.name_key} onClick={() => rename(g)}>edit name</ModButton>
            <ModButton kind="dismiss" busy={busy === g.name_key} onClick={() => act(g, "skip")}>dismiss</ModButton>
          </>}
        >
          {linking === g.name_key && (
            <div style={{ marginTop: 8 }}>
              <input className="search-input" placeholder="Which artist here is this?" value={q} onChange={(e) => setQ(e.target.value)} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {matches.map((m) => (
                  <ModButton key={m.id} onClick={() => act(g, "link", m.id)}>{m.name}</ModButton>
                ))}
              </div>
            </div>
          )}
        </ModRow>
      ))}

      {pending.length > 0 && (
        <div className="comment-meta" style={{ marginTop: 18 }}>
          {pending.length} more waiting for their Spotify check (next: {pending.slice(0, 5).map((p) => p.name).join(", ")}…).
        </div>
      )}
    </ModPage>
  );
}
