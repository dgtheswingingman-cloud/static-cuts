"use client";

// First visit: pick a few artists you're into, and the home page becomes
// about them. No account needed to look around; signing up keeps the picks
// (they're followed automatically) and turns on alerts.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useIsAdmin, usePersonalUser } from "../useIsAdmin";
import { useAuth } from "../AuthProvider";
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
  const { session } = useAuth();
  const [fromSpotify, setFromSpotify] = useState<number | null>(null);

  useEffect(() => {
    setPicked(new Set(readPicks()));
    supabase.rpc("rpc_home_artists", { p_mine: false }).then(({ data }) => {
      const rows = ((data as A[]) ?? []).filter((a) => a.track_count > 0);
      rows.sort((a, b) => b.track_count - a.track_count);
      setArtists(rows);
    });
  }, []);

  // Signed in with Spotify: tick the artists you already follow there. Uses
  // your own Spotify sign-in (it lasts an hour), a few calls at most.
  const spotifyToken = session?.provider_token;
  useEffect(() => {
    if (!user || !spotifyToken || fromSpotify !== null) return;
    let cancelled = false;
    (async () => {
      const ids: string[] = [];
      let next: string | null = "https://api.spotify.com/v1/me/following?type=artist&limit=50";
      for (let page = 0; next && page < 4; page++) {
        const { data: ok } = await supabase.rpc("rpc_spotify_ticket");
        if (!ok) break;
        const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${spotifyToken}` } });
        if (!res.ok) break;
        const body = await res.json();
        ids.push(...(body?.artists?.items ?? []).map((a: { id: string }) => a.id));
        next = body?.artists?.next ?? null;
      }
      if (cancelled || ids.length === 0) { if (!cancelled) setFromSpotify(0); return; }
      const { data } = await supabase.rpc("rpc_artists_by_spotify", { p_ids: ids });
      const ours = ((data as string[]) ?? []);
      if (cancelled) return;
      setPicked((prev) => new Set([...prev, ...ours]));
      setFromSpotify(ours.length);
    })();
    return () => { cancelled = true; };
  }, [user?.id, spotifyToken, fromSpotify]);

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
      {fromSpotify !== null && fromSpotify > 0 && (
        <div className="comments-panel" style={{ marginBottom: 14 }}>
          Ticked {fromSpotify} artist{fromSpotify === 1 ? "" : "s"} you follow on Spotify. Untick any you don&apos;t want.
        </div>
      )}
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
