"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import ChatGPTRoutine from "./ChatGPTRoutine";
import PhoneAlerts from "./PhoneAlerts";
import YourData from "./YourData";
import LastfmLink from "./LastfmLink";
import { useIsAdmin } from "../useIsAdmin";
import { AdminModePage } from "../components/AdminModeNote";
import { local } from "@/lib/safeStorage";

type Prefs = {
  show_completion_pct: boolean;
  show_collected_tracks: boolean;
  show_ratings: boolean;
  show_followed_artists: boolean;
  show_contributions: boolean;
  notify_followed_daily: boolean;
  notify_collected: boolean;
};

const LABELS: Record<keyof Prefs, string> = {
  show_completion_pct: "Show my completion % publicly",
  show_collected_tracks: "Show my collected tracks publicly",
  show_ratings: "Show my ratings publicly",
  show_followed_artists: "Show artists I follow publicly",
  show_contributions: "Show my contributions publicly (songs I've added, finds, corrections)",
  notify_followed_daily: "Daily summary of what changed for artists I follow",
  notify_collected: "Tell me when songs I've collected change status (leaked, released…)",
};
const NOTIFY_KEYS: (keyof Prefs)[] = ["notify_followed_daily", "notify_collected"];

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [importResult, setImportResult] = useState<{ checked: number; collected: number; added: number; waiting: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Runs straight after coming back from Spotify, usually before the page
  // knows who's signed in (useAuth's user is still empty then), so it works
  // from the session itself. It used to stop silently at that point.
  async function runSpotifyImport() {
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    setImportProgress(0);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Log in first, then try the import again.");
      const providerToken = sessionData.session.provider_token;
      if (!providerToken) {
        throw new Error("Your Spotify session expired — click the button again to reconnect.");
      }

      // Page through the listener's Liked Songs and send them to the
      // archive in chunks: songs already here get collected, and songs from
      // artists in the archive that aren't here yet get added once our own
      // reading of that release confirms them (rpc_import_liked_songs).
      let checked = 0;
      const totals = { collected: 0, added: 0, waiting: 0 };
      let chunk: { spotify_url: string; album_id: string | null; album_type: string | null; artist_ids: string[] }[] = [];
      const send = async () => {
        if (chunk.length === 0) return;
        const { data, error: err } = await supabase.rpc("rpc_import_liked_songs", { p_items: chunk });
        if (err) throw new Error(err.message);
        totals.collected += data?.collected ?? 0;
        totals.added += data?.added ?? 0;
        totals.waiting += data?.waiting ?? 0;
        chunk = [];
      };
      let next: string | null = "https://api.spotify.com/v1/me/tracks?limit=50";
      while (next) {
        const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${providerToken}` } });
        const data: any = await res.json().catch(() => null);
        if (res.status === 403) {
          throw new Error("Spotify won't let this account in yet. Spotify limits new sites to a few invited accounts, so ask us to add yours.");
        }
        if (!res.ok) {
          throw new Error(`Spotify API error (${res.status}): ${data?.error?.message ?? "unknown error"}. Try again in a minute.`);
        }
        for (const item of data.items ?? []) {
          checked++;
          const t = item.track;
          if (!t?.external_urls?.spotify) continue;
          chunk.push({
            spotify_url: t.external_urls.spotify,
            album_id: t.album?.id ?? null,
            album_type: t.album?.album_type ?? null,
            artist_ids: (t.artists ?? []).map((a: any) => a.id).filter(Boolean),
          });
        }
        if (chunk.length >= 1000) await send();
        setImportProgress(checked);
        next = data.next;
      }
      await send();

      setImportResult({ checked, ...totals });
    } catch (e: any) {
      setImportError(e?.message ?? String(e));
    } finally {
      setImportBusy(false);
      setImportProgress(null);
    }
  }

  async function startSpotifyImport() {
    // Always go through a fresh re-auth requesting the scope explicitly --
    // trying to reuse an existing session token first was the actual bug:
    // a stale token from before (even one Spotify-side revoked) still sits
    // in the local session and would short-circuit past the scope request
    // entirely, silently reusing insufficient access every time.
    local.set("static_cuts_spotify_import_pending", "true");
    const { data, error: err } = await supabase.auth.signInWithOAuth({
      provider: "spotify",
      options: { redirectTo: window.location.origin + "/settings", scopes: "user-library-read" },
    });
    if (err) {
      local.remove("static_cuts_spotify_import_pending");
      setImportError(err.message);
    }
  }

  useEffect(() => {
    // Don't depend on catching one specific auth event at exactly the
    // right moment -- that proved unreliable when the OAuth round-trip
    // completes near-instantly (already-authorized, silent re-auth).
    // Instead, actively poll for the token to actually show up.
    if (local.get("static_cuts_spotify_import_pending") !== "true") return;

    let cancelled = false;
    let attempts = 0;

    async function poll() {
      if (cancelled) return;
      attempts++;
      const { data } = await supabase.auth.getSession();
      if (data.session?.provider_token) {
        local.remove("static_cuts_spotify_import_pending");
        runSpotifyImport();
        return;
      }
      if (attempts < 15) {
        setTimeout(poll, 400);
      } else {
        local.remove("static_cuts_spotify_import_pending");
        setImportError("Couldn't detect a valid Spotify session after waiting — try clicking the button again.");
      }
    }
    poll();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authLoading && !user && !isAdmin) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("show_completion_pct, show_collected_tracks, show_ratings, show_followed_artists, show_contributions, notify_followed_daily, notify_collected")
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

  if (isAdmin) return <AdminModePage title="Settings" />;

  return (
    <div className="wrap">
      <h1 className="detail-name page-title">
        Settings
      </h1>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        Looking to edit your name, avatar, or about section? That lives on{" "}
        {user ? <a href={`/profile/${user.id}`} style={{ color: "var(--bone)" }}>your profile</a> : "your profile"} —
        this page is just how the site behaves for you.
      </div>

      <div className="section-label" id="spotify-import" style={{ scrollMarginTop: 20 }}>Import from Spotify</div>
      <div className="detail-meta" style={{ marginBottom: 16, maxWidth: 520 }}>
        Goes through your Liked Songs on Spotify. Songs already in the archive are marked as collected. Songs by
        artists in the archive that aren&apos;t here yet get added (and collected): straight away if we&apos;ve already
        read that release on Spotify, otherwise once we have (usually within a day, Spotify only lets us ask a few times a minute). Songs by artists who aren&apos;t in the
        archive are left alone.
      </div>
      <div className="comment-meta" style={{ marginBottom: 12, maxWidth: 520 }}>
        Invited testers only for now: Spotify limits new sites like ours to a few Spotify accounts.
      </div>
      <button className="comment-post-btn" disabled={importBusy} onClick={startSpotifyImport} style={{ marginBottom: 12 }}>
        {importBusy
          ? importProgress !== null
            ? `checking your library… (${importProgress} so far)`
            : "starting…"
          : "import from Spotify"}
      </button>
      {importBusy && importProgress !== null && (
        <div className="bar-track" style={{ height: 4, maxWidth: 520, marginBottom: 12 }}>
          <div className="bar-fill" style={{ width: importProgress > 0 ? "100%" : "8%", transition: "width 0.3s" }} />
        </div>
      )}
      {importError && (
        <div className="empty-state error" style={{ maxWidth: 520, marginBottom: 20 }}>{importError}</div>
      )}
      {importResult && (
        <div className="detail-meta" style={{ maxWidth: 520, marginBottom: 20 }}>
          Checked {importResult.checked} liked songs. {importResult.collected} newly marked collected
          {importResult.added > 0 && `, ${importResult.added} added to the archive`}
          {importResult.waiting > 0 && `, ${importResult.waiting} more will be added once we've read their releases (usually within a day)`}.
        </div>
      )}

      {user && <ChatGPTRoutine userId={user.id} />}

      <div className="section-label">Notifications</div>
      <div className="detail-meta" style={{ marginBottom: 8 }}>
        These show under &ldquo;notifications&rdquo; at the top of the homepage. &ldquo;Remind me&rdquo; on the release radar always
        notifies you.
      </div>
      {prefs && (
        <div style={{ maxWidth: 520, marginBottom: 10 }}>
          {NOTIFY_KEYS.map((key) => (
            <div key={key} style={rowStyle}>
              <span style={{ fontFamily: "var(--font-inter)", fontSize: "0.9rem" }}>{LABELS[key]}</span>
              <button className={`tab ${prefs[key] ? "active" : ""}`} onClick={() => toggle(key)}>
                {prefs[key] ? "on" : "off"}
              </button>
            </div>
          ))}
        </div>
      )}

      <PhoneAlerts />

      <div className="section-label">Privacy</div>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        Nothing here is public until you turn it on. Your profile URL is{" "}
        {user ? `/profile/${user.id}` : "…"}.
      </div>

      {prefs && (
        <div style={{ maxWidth: 520 }}>
          {(Object.keys(LABELS) as (keyof Prefs)[]).filter((k) => !NOTIFY_KEYS.includes(k)).map((key) => (
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

      <LastfmLink />

      <YourData />
    </div>
  );
}
