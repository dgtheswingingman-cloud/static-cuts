"use client";

// First visit: pick a few artists you're into, and the home page becomes
// about them. No account needed to look around; signing up keeps the picks
// (they're followed automatically) and turns on alerts.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useIsAdmin, usePersonalUser } from "../useIsAdmin";
import { readPicks, savePicks } from "../components/picks";

type A = { id: string; name: string; track_count: number; aliases: string[] | null };

export default function StartPage() {
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [artists, setArtists] = useState<A[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPicked(new Set(readPicks()));
    supabase.rpc("rpc_home_artists", { p_mine: false }).then(({ data }) => {
      const rows = ((data as A[]) ?? []).filter((a) => a.track_count > 0);
      rows.sort((a, b) => b.track_count - a.track_count);
      setArtists(rows);
    });
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (artists ?? []).filter((a) => !needle || a.name.toLowerCase().includes(needle) || (a.aliases ?? []).some((x) => x.toLowerCase().includes(needle)));
  }, [artists, q]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function done() {
    const ids = [...picked];
    setBusy(true);
    if (user) {
      await supabase.rpc("rpc_follow_many", { p_artist_ids: ids });
      savePicks([]);
    } else {
      savePicks(ids);
    }
    setBusy(false);
    router.push("/");
  }

  if (isAdmin) {
    return <div className="wrap"><div className="empty-state">This is the first-visit page for new fans. Switch to your account to try it.</div></div>;
  }

  return (
    <div className="wrap">
      <h1 className="detail-name page-title">Who are you into?</h1>
      <div className="detail-meta" style={{ marginBottom: 14 }}>
        Pick a few artists and your home page will be about them: their songs, leaks, releases and what changed.
        {!user && " No account needed to look around."}
      </div>
      <input className="search-input" style={{ width: "100%", marginBottom: 14 }} placeholder="Find an artist…" value={q} onChange={(e) => setQ(e.target.value)} />
      {artists === null && <div className="empty-state">loading…</div>}
      <div className="start-grid">
        {shown.map((a) => (
          <button key={a.id} className={`start-chip ${picked.has(a.id) ? "on" : ""}`} onClick={() => toggle(a.id)} aria-pressed={picked.has(a.id)}>
            <span>{picked.has(a.id) ? "✓ " : ""}{a.name}</span>
            <span className="comment-meta">{a.track_count.toLocaleString("en-GB")} songs</span>
          </button>
        ))}
      </div>
      <div className="start-bar">
        <span className="comment-meta">{picked.size} picked</span>
        <button className="tab active" disabled={busy || picked.size === 0} onClick={done}>
          {busy ? "…" : user ? "follow them" : "show me their songs"}
        </button>
        <Link href="/" className="text-link comment-meta">skip</Link>
      </div>
    </div>
  );
}
