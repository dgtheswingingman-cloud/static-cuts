"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";

type Prefs = {
  show_completion_pct: boolean;
  show_collected_tracks: boolean;
  show_ratings: boolean;
  show_followed_artists: boolean;
};

const LABELS: Record<keyof Prefs, string> = {
  show_completion_pct: "Show my completion % publicly",
  show_collected_tracks: "Show my collected tracks publicly",
  show_ratings: "Show my ratings publicly",
  show_followed_artists: "Show artists I follow publicly",
};

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<{ checked: number; matched: number; newlyCollected: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  function extractSpotifyTrackId(url: string): string | null {
    const match = url.match(/track\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  async function runSpotifyImport() {
    if (!user) return;
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const providerToken = sessionData.session?.provider_token;
      console.log("Spotify import — provider_token present:", !!providerToken, providerToken ? `(length ${providerToken.length})` : "");
      if (!providerToken) {
        throw new Error("Your Spotify session expired — click the button again to reconnect.");
      }

      // Every Static Cuts track with a confirmed link, mapped by the
      // Spotify track ID embedded in its URL -- paginated since this
      // could be a few thousand rows.
      const idMap: Record<string, string> = {};
      let from = 0;
      const PAGE_SIZE = 1000;
      while (true) {
        const { data: page, error: err } = await supabase
          .from("tracks")
          .select("id, spotify_url")
          .not("spotify_url", "is", null)
          .range(from, from + PAGE_SIZE - 1);
        if (err) throw err;
        (page ?? []).forEach((t: any) => {
          const sid = extractSpotifyTrackId(t.spotify_url);
          if (sid) idMap[sid] = t.id;
        });
        if (!page || page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      // Page through the user's actual Spotify library.
      let checked = 0;
      const matchedTrackIds = new Set<string>();
      let next: string | null = "https://api.spotify.com/v1/me/tracks?limit=50";
      let pageCount = 0;
      while (next) {
        const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${providerToken}` } });
        const data: any = await res.json();
        pageCount++;
        console.log(`Spotify import — page ${pageCount}, status ${res.status}:`, data);
        if (!res.ok) {
          throw new Error(`Spotify API error (${res.status}): ${data?.error?.message ?? "unknown error"} — check the browser console for the full response.`);
        }
        for (const item of data.items ?? []) {
          checked++;
          const sid = item.track?.id;
          if (sid && idMap[sid]) matchedTrackIds.add(idMap[sid]);
        }
        next = data.next;
      }

      // Mark matches as collected -- upsert so already-collected ones are a no-op.
      const rows = Array.from(matchedTrackIds).map((trackId) => ({ user_id: user.id, track_id: trackId }));
      let newlyCollected = 0;
      if (rows.length > 0) {
        const { data: already } = await supabase
          .from("track_ownership")
          .select("track_id")
          .eq("user_id", user.id)
          .in("track_id", Array.from(matchedTrackIds));
        const alreadySet = new Set((already ?? []).map((r: any) => r.track_id));
        newlyCollected = rows.filter((r) => !alreadySet.has(r.track_id)).length;
        await supabase.from("track_ownership").upsert(rows, { onConflict: "user_id,track_id", ignoreDuplicates: true });
      }

      setImportResult({ checked, matched: matchedTrackIds.size, newlyCollected });
    } catch (e: any) {
      setImportError(e?.message ?? String(e));
    } finally {
      setImportBusy(false);
    }
  }

  async function startSpotifyImport() {
    // Always go through a fresh re-auth requesting the scope explicitly --
    // trying to reuse an existing session token first was the actual bug:
    // a stale token from before (even one Spotify-side revoked) still sits
    // in the local session and would short-circuit past the scope request
    // entirely, silently reusing insufficient access every time.
    localStorage.setItem("static_cuts_spotify_import_pending", "true");
    await supabase.auth.signInWithOAuth({
      provider: "spotify",
      options: { redirectTo: window.location.origin + "/settings", scopes: "user-library-read" },
    });
  }

  useEffect(() => {
    // Listen for the actual sign-in event completing, rather than reacting
    // to `user` becoming truthy -- that can happen before Supabase has
    // finished processing the OAuth callback and attaching the fresh
    // provider_token, causing the import to run against a stale session.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("Spotify import — auth event:", event, "provider_token present:", !!session?.provider_token);
      if (
        (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") &&
        localStorage.getItem("static_cuts_spotify_import_pending") === "true" &&
        session?.provider_token
      ) {
        localStorage.removeItem("static_cuts_spotify_import_pending");
        runSpotifyImport();
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("show_completion_pct, show_collected_tracks, show_ratings, show_followed_artists")
        .eq("id", user.id)
        .single();
      if (data) setPrefs(data as Prefs);
    }
    load();
  }, [user]);

  async function toggle(key: keyof Prefs) {
    if (!user || !prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaving(true);
    await supabase.from("profiles").update({ [key]: next[key] }).eq("id", user.id);
    setSaving(false);
  }

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 0",
    borderBottom: "1px solid var(--hair)",
  };

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>
        ← back to archive
      </button>
      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>
        Settings
      </h1>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        Looking to edit your name, avatar, or about section? That lives on{" "}
        {user ? <a href={`/profile/${user.id}`} style={{ color: "var(--bone)" }}>your profile</a> : "your profile"} —
        this page is just how the site behaves for you.
      </div>

      <div className="section-label">Import from Spotify</div>
      <div className="detail-meta" style={{ marginBottom: 16, maxWidth: 520 }}>
        Checks your actual Spotify library against tracks Static Cuts already has a confirmed link
        for, and marks any matches as collected. Exact ID matching, not a title guess — but it can
        only find tracks the archive already has a Spotify link for, so it'll only ever cover your
        official-release collection, not unreleased or leaked material.
      </div>
      <button className="comment-post-btn" disabled={importBusy} onClick={startSpotifyImport} style={{ marginBottom: 12 }}>
        {importBusy ? "checking your library…" : "import from Spotify"}
      </button>
      {importError && (
        <div className="empty-state" style={{ borderColor: "#a33", maxWidth: 520, marginBottom: 20 }}>{importError}</div>
      )}
      {importResult && (
        <div className="detail-meta" style={{ maxWidth: 520, marginBottom: 20 }}>
          Checked {importResult.checked} tracks in your Spotify library — {importResult.matched} matched
          something in the archive, {importResult.newlyCollected} newly marked collected
          {importResult.matched > importResult.newlyCollected && ` (${importResult.matched - importResult.newlyCollected} were already marked)`}.
        </div>
      )}

      <div className="section-label">Privacy</div>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        Nothing here is public until you turn it on. Your profile URL is{" "}
        {user ? `/profile/${user.id}` : "…"}.
      </div>

      {prefs && (
        <div style={{ maxWidth: 520 }}>
          {(Object.keys(LABELS) as (keyof Prefs)[]).map((key) => (
            <div key={key} style={rowStyle}>
              <span style={{ fontFamily: "var(--font-inter)", fontSize: "0.9rem" }}>
                {LABELS[key]}
              </span>
              <button
                className={`tab ${prefs[key] ? "active" : ""}`}
                onClick={() => toggle(key)}
              >
                {prefs[key] ? "on" : "off"}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="note">
        {saving ? "saving…" : "Changes save instantly."} These control what anyone can see on
        your public profile page — not what you see yourself, which always shows everything.
      </div>
    </div>
  );
}
