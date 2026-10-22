"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import ChatGPTRoutine from "./ChatGPTRoutine";
import ExportCollection from "./ExportCollection";
import Link from "next/link";
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
  const [importResult, setImportResult] = useState<{ checked: number; collected: number; added: number; waiting: number; skipped: string[]; suggested: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // After coming back from Spotify: the listener picks what to import —
  // Liked Songs and/or their own playlists (Spotify only lets apps read
  // playlists you made or collaborate on).
  type Source = { id: string; name: string; count: number | null };
  const [sources, setSources] = useState<Source[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  async function spotifyToken() {
    // Works from the session itself: straight after coming back from
    // Spotify, the page may not know who's signed in yet.
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) throw new Error("Log in first, then try the import again.");
    const token = sessionData.session.provider_token;
    if (!token) throw new Error("Your Spotify session expired — press the button again to reconnect.");
    return token;
  }

  async function spotifyGet(url: string, token: string) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data: any = await res.json().catch(() => null);
    if (res.status === 403) {
      throw Object.assign(new Error("Spotify won't let this account in yet. Spotify limits new sites to a few invited accounts, so ask us to add yours."), { status: 403 });
    }
    if (res.status === 401) throw new Error("Your Spotify session expired — press the button again to reconnect.");
    if (!res.ok) throw new Error(`Spotify said no (${res.status}): ${data?.error?.message ?? "unknown error"}. Try again in a minute.`);
    return data;
  }

  async function loadSources() {
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const token = await spotifyToken();
      const me = await spotifyGet("https://api.spotify.com/v1/me", token);
      const liked = await spotifyGet("https://api.spotify.com/v1/me/tracks?limit=1", token);
      const list: Source[] = [{ id: "liked", name: "Liked Songs", count: liked?.total ?? null }];
      let next: string | null = "https://api.spotify.com/v1/me/playlists?limit=50";
      for (let page = 0; next && page < 10; page++) {
        const data = await spotifyGet(next, token);
        for (const pl of data?.items ?? []) {
          if (!pl?.id) continue;
          if (pl.owner?.id !== me?.id && !pl.collaborative) continue; // Spotify won't share other people's playlists
          list.push({ id: pl.id, name: pl.name || "Untitled playlist", count: pl.items?.total ?? pl.tracks?.total ?? null });
        }
        next = data?.next ?? null;
      }
      setSources(list);
      setPicked(new Set(["liked"]));
    } catch (e: any) {
      setImportError(e?.message ?? String(e));
    } finally {
      setImportBusy(false);
    }
  }

  // Songs already here get collected; songs by artists in the archive that
  // aren't here yet get added once our own reading of that release confirms
  // them (rpc_import_liked_songs).
  async function runSpotifyImport() {
    if (!sources || picked.size === 0) return;
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    setImportProgress(0);
    try {
      const token = await spotifyToken();
      let checked = 0;
      const skipped: string[] = [];
      const seen = new Set<string>();
      // Main artist of every song, so artists not in the archive yet can be
      // suggested as new artists (rpc_suggest_library_artists).
      const byArtist = new Map<string, { id: string; name: string; songs: number }>();
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
      for (const src of sources.filter((x) => picked.has(x.id))) {
        let next: string | null = src.id === "liked"
          ? "https://api.spotify.com/v1/me/tracks?limit=50"
          : `https://api.spotify.com/v1/playlists/${src.id}/items?limit=50`;
        try {
          while (next) {
            const data = await spotifyGet(next, token);
            for (const item of data?.items ?? []) {
              checked++;
              const t = item?.track ?? item?.item;
              if (!t || t.type === "episode" || t.is_local || !t.external_urls?.spotify) continue;
              if (seen.has(t.external_urls.spotify)) continue;
              seen.add(t.external_urls.spotify);
              const main = t.artists?.[0];
              if (main?.id && main?.name) {
                const cur = byArtist.get(main.id) ?? { id: main.id, name: main.name, songs: 0 };
                cur.songs++;
                byArtist.set(main.id, cur);
              }
              chunk.push({
                spotify_url: t.external_urls.spotify,
                album_id: t.album?.id ?? null,
                album_type: t.album?.album_type ?? null,
                artist_ids: (t.artists ?? []).map((a: any) => a.id).filter(Boolean),
              });
            }
            if (chunk.length >= 1000) await send();
            setImportProgress(checked);
            next = data?.next ?? null;
          }
        } catch (e: any) {
          // One playlist Spotify won't share shouldn't stop the rest.
          if (src.id !== "liked" && e?.status === 403) { skipped.push(src.name); continue; }
          throw e;
        }
      }
      await send();
      const { data: suggested } = await supabase.rpc("rpc_suggest_library_artists", { p_artists: [...byArtist.values()] });
      setImportResult({ checked, ...totals, skipped, suggested: typeof suggested === "number" ? suggested : 0 });
      setSources(null);
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
      options: { redirectTo: window.location.origin + "/settings", scopes: "user-library-read playlist-read-private playlist-read-collaborative" },
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
        loadSources();
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
        Goes through your Liked Songs and any of your own playlists you pick. Songs already in the archive are marked as collected. Songs by
        artists in the archive that aren&apos;t here yet get added (and collected): straight away if we&apos;ve already
        read that release on Spotify, otherwise once we have (usually within a day, Spotify only lets us ask a few times a minute). Songs by artists who aren&apos;t in the
        archive are suggested as new artists (once they have a few songs), for a moderator to add.
      </div>
      <div className="comment-meta" style={{ marginBottom: 12, maxWidth: 520 }}>
        Invited testers only for now: Spotify limits new sites like ours to a few Spotify accounts.
      </div>
      {sources ? (
        <div style={{ maxWidth: 520, marginBottom: 12 }}>
          <div className="comment-meta" style={{ marginBottom: 8 }}>
            Pick what to import. Only playlists you made (or collaborate on) are listed: Spotify won&apos;t share other people&apos;s.
          </div>
          {sources.map((src) => (
            <label key={src.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--hair)", cursor: "pointer" }}>
              <input type="checkbox" checked={picked.has(src.id)} disabled={importBusy}
                onChange={() => setPicked((cur) => { const n = new Set(cur); if (n.has(src.id)) n.delete(src.id); else n.add(src.id); return n; })} />
              <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-inter)", fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{src.name}</span>
              {src.count !== null && <span className="comment-meta">{src.count.toLocaleString("en-GB")}</span>}
            </label>
          ))}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button className="comment-post-btn" disabled={importBusy || picked.size === 0} onClick={runSpotifyImport}>
              {importBusy
                ? `importing… (${importProgress ?? 0} songs so far)`
                : `import ${picked.size} ${picked.size === 1 ? "choice" : "choices"}`}
            </button>
            {sources.length > 1 && !importBusy && (
              <button className="tab" onClick={() => setPicked(picked.size === sources.length ? new Set() : new Set(sources.map((x) => x.id)))}>
                {picked.size === sources.length ? "none" : "all"}
              </button>
            )}
            {!importBusy && <button className="tab" onClick={() => setSources(null)}>cancel</button>}
          </div>
        </div>
      ) : (
        <button className="comment-post-btn" disabled={importBusy} onClick={startSpotifyImport} style={{ marginBottom: 12 }}>
          {importBusy ? "connecting to Spotify…" : "import from Spotify"}
        </button>
      )}
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
          Checked {importResult.checked} songs. {importResult.collected} newly marked collected
          {importResult.added > 0 && `, ${importResult.added} added to the archive`}
          {importResult.waiting > 0 && `, ${importResult.waiting} more will be added once we've read their releases (usually within a day)`}.
          {importResult.suggested > 0 && ` ${importResult.suggested} artist${importResult.suggested === 1 ? "" : "s"} you listen to that aren't here yet ${importResult.suggested === 1 ? "has" : "have"} been suggested as new artists.`}
          {importResult.skipped.length > 0 && ` Spotify wouldn't share: ${importResult.skipped.join(", ")}.`}
        </div>
      )}

      <div className="comment-meta" style={{ marginBottom: 24 }}>
        Other ways to fill your collection (a spreadsheet, ticking songs off by artist):{" "}
        <Link href="/collection/import" className="text-link">more import options</Link>
      </div>

      <div className="section-label" id="export" style={{ scrollMarginTop: 20 }}>Export to Spotify</div>
      <div className="detail-meta" style={{ marginBottom: 10, maxWidth: 520 }}>
        Makes a private Spotify playlist of everything you&apos;ve collected that&apos;s on Spotify (unreleased songs
        can&apos;t go on Spotify). Lists have their own export button. Invited testers only for now.
      </div>
      {user && <ExportCollection userId={user.id} />}

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
