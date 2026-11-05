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
import { thumb } from "@/lib/thumb";

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
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [shownN, setShownN] = useState(60);
  // Part of the welcome for new accounts: pick at least 5, then on to step 2.
  const [welcome, setWelcome] = useState(false);
  // Admin preview of the welcome: same page, nothing saved.
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setWelcome(q.get("welcome") === "1");
    setPreview(q.get("preview") === "1");
  }, []);
  const MIN = welcome ? 5 : 1;
  const nextUrl = welcome ? `/welcome?step=2${preview ? "&preview=1" : ""}` : "/";

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

  // Photos for the artists on screen.
  useEffect(() => {
    const ids = shown.slice(0, shownN).map((a) => a.id).filter((id) => !(id in photos));
    if (!ids.length) return;
    supabase.from("artists").select("id, image_url").in("id", ids.slice(0, 120)).then(({ data }) => {
      const m: Record<string, string> = {};
      for (const id of ids.slice(0, 120)) m[id] = "";
      for (const r of (data ?? []) as { id: string; image_url: string | null }[]) if (r.image_url) m[r.id] = r.image_url;
      setPhotos((p) => ({ ...p, ...m }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, shownN]);

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
    if (preview) {
      // nothing saved
    } else if (user) {
      await supabase.rpc("rpc_follow_many", { p_artist_ids: ids });
      savePicks([]);
    } else {
      savePicks(ids);
    }
    setBusy(false);
    router.push(nextUrl);
  }

  if (isAdmin && !preview) {
    return <div className="wrap"><div className="empty-state">This is the first-visit page for new fans. Switch to your account to try it.</div></div>;
  }

  return (
    <div className="wrap wl-page">
      <h1 className="ls-title wl-title">{welcome ? "PICK YOUR ARTISTS" : "WHO ARE YOU INTO?"}<span>//</span></h1>
      {preview && <div className="comments-panel" style={{ marginBottom: 14 }}>Preview of what new accounts see. Nothing here is saved.</div>}
      {welcome && (
        <div className="wl-steps">
          <span>Step 1 of 3</span>
          <Link href={nextUrl} className="wl-skip">Skip</Link>
          <span className="wl-progress"><span style={{ width: "33.3%" }} /></span>
        </div>
      )}
      <p className="wl-lead">
        {welcome ? "Follow a few artists: their new songs, leaks and releases show up on your home page and you get told when something lands." : "Pick a few artists and your home page will be about them."}
        {!user && " No account needed to look around."}
      </p>
      {fromSpotify !== null && fromSpotify > 0 && (
        <div className="wl-message">Ticked {fromSpotify} artist{fromSpotify === 1 ? "" : "s"} you follow on Spotify. Untick any you don&apos;t want.</div>
      )}
      <div className="sr-box wl-search">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input placeholder="Search artists…" value={q} onChange={(e) => { setQ(e.target.value); setShownN(60); }} aria-label="Search artists" />
        {q && <button aria-label="Clear" onClick={() => setQ("")}>✕</button>}
      </div>
      {artists === null && <div className="empty-state">loading…</div>}
      <div className="wl-grid">
        {shown.slice(0, shownN).map((a) => {
          const on = picked.has(a.id);
          return (
            <button key={a.id} className={`wl-artist ${on ? "on" : ""}`} onClick={() => toggle(a.id)} aria-pressed={on}>
              <span className="wl-face">
                {photos[a.id]
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={thumb(photos[a.id])} alt="" loading="lazy" />
                  : <span>{a.name.slice(0, 2).toUpperCase()}</span>}
                {on && <span className="wl-tick" aria-hidden="true">✓</span>}
              </span>
              <span className="wl-name">{a.name}</span>
            </button>
          );
        })}
      </div>
      {shown.length > shownN && (
        <div style={{ textAlign: "center", margin: "16px 0" }}><button className="st-btn" onClick={() => setShownN(shownN + 90)}>More artists</button></div>
      )}
      <div className="wl-bar">
        <span>{welcome ? <><b>{Math.min(picked.size, MIN)}</b> of {MIN} picked{picked.size > MIN ? ` (+${picked.size - MIN})` : ""}</> : <><b>{picked.size}</b> picked</>}</span>
        <button className="sb-submit wl-next" disabled={busy || picked.size < MIN} onClick={done}>
          {busy ? "…" : welcome ? "Next//" : user ? "Follow them//" : "Show me//"}
        </button>
      </div>
    </div>
  );
}
