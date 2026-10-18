"use client";

// Guests: people songs here are credited to who don't have a page yet.
// Most are sorted automatically (checked against Spotify every 10 minutes);
// the ones it couldn't confirm wait here. Add makes a page and moves their
// songs onto it (they stay on the other artist's page as a feature); skip
// leaves them as a note.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";
import { useReviewKeys } from "../../components/useReviewKeys";

type Guest = { name_key: string; name: string; songs: number; state: "review" | "pending"; note: string | null; sample: string[] | null };

export default function GuestsPage() {
  const { user, loading: authLoading } = useAuth();
  const canModerate = useIsModerator();
  const router = useRouter();
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

  const review = useMemo(() => (rows ?? []).filter((r) => r.state === "review").map((r) => ({ ...r, id: r.name_key })), [rows]);
  const pending = (rows ?? []).filter((r) => r.state === "pending");
  const { focusedId } = useReviewKeys(review, {
    yes: (g) => act(g, "create"),
    no: (g) => act(g, "skip"),
  }, busy !== null);

  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;

  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <button className="back-btn" onClick={() => router.push("/review")}>← moderation</button>
      <h1 className="detail-name page-title">Guest artists</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        People songs are credited to who don&apos;t have a page yet. Every 10 minutes a few are checked on Spotify: matches
        get a page automatically. These are the ones it couldn&apos;t confirm. <b>Add</b> makes a page and moves their songs
        there (they still show as features); <b>skip</b> leaves them as a note. Everything is in the{" "}
        <UndoHistoryLink />.
      </div>
      {message && <div className="comments-panel" style={{ marginBottom: 12 }}>{message}</div>}
      {!rows && <div className="empty-state">loading…</div>}
      {rows && review.length === 0 && <div className="empty-state">Nothing to check right now.</div>}
      {review.length > 0 && <div className="comment-meta kb-hint" style={{ marginBottom: 8 }}>Keys: J / K move · Y add · N skip</div>}

      {review.map((g) => (
        <div key={g.name_key} data-row-id={g.name_key} className={`review-row ${focusedId === g.name_key ? "kb-focus" : ""}`}
          style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">{g.name}</div>
            <div className="review-row-meta">
              <span>{g.songs} song{g.songs === 1 ? "" : "s"}</span>
              {g.note && <span>{g.note}</span>}
            </div>
            {g.sample && <div className="comment-meta" style={{ marginTop: 2 }}>{g.sample.join(" · ")}</div>}
            {linking === g.name_key && (
              <div style={{ marginTop: 8 }}>
                <input className="search-input" placeholder="Which artist here is this?" value={q} onChange={(e) => setQ(e.target.value)} />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {matches.map((m) => (
                    <button key={m.id} className="rating-chip" onClick={() => act(g, "link", m.id)}>{m.name}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="rating-chip" disabled={busy === g.name_key} onClick={() => act(g, "create")}>add</button>
            <button className="rating-chip" disabled={busy === g.name_key}
              onClick={() => { setLinking(linking === g.name_key ? null : g.name_key); setQ(""); }}>same as…</button>
            <button className="rating-chip" disabled={busy === g.name_key} onClick={() => act(g, "skip")}>skip</button>
          </span>
        </div>
      ))}

      {pending.length > 0 && (
        <div className="comment-meta" style={{ marginTop: 18 }}>
          {pending.length} more waiting for their Spotify check{pending.length > 0 ? ` (next: ${pending.slice(0, 5).map((p) => p.name).join(", ")}…)` : ""}.
        </div>
      )}
    </div>
  );
}
