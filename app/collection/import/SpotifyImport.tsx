"use client";

// Import from Spotify: your Liked Songs and any of your own playlists. Songs
// already in the archive are marked collected; songs by artists here that
// aren't yet get added once we've read the release; artists who aren't here
// are suggested. Lives on the import page (it used to be in Settings).

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { importBatch, suggestArtists } from "@/lib/importBatch";
import { local } from "@/lib/safeStorage";

// Pull "(feat. X)", "(with X)", "ft. X" out of a song title (the archive keeps
// titles without them and the guests separately).
function splitCredits(t: string): { title: string; credits: string[] } {
  const credits: string[] = [];
  let title = t.replace(/\s*[\(\[]\s*(?:feat\.|ft\.|feat\s|ft\s|featuring\s|with\s)\s*([^\)\]]*)[\)\]]/gi, (_m, who) => {
    credits.push(String(who).trim());
    return "";
  });
  title = title.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+(.*)$/i, (_m, who) => {
    credits.push(String(who).trim());
    return "";
  });
  return { title: title.replace(/\s{2,}/g, " ").trim(), credits: credits.filter(Boolean) };
}

export default function SpotifyImport({ onDone }: { onDone?: () => void } = {}) {
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

  // Reading a big library is hundreds of requests. Spotify's limit is shared
  // by everyone using our Spotify app (the background jobs too), so go at a
  // steady pace, and when Spotify says "too many requests", wait as long as
  // it asks and carry on rather than giving up.
  const [waitNote, setWaitNote] = useState<string | null>(null);
  async function spotifyGet(url: string, token: string) {
    for (let attempt = 0; ; attempt++) {
      await new Promise((r) => setTimeout(r, 700));
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 429 && attempt < 6) {
        const wait = Math.max(parseInt(res.headers.get("Retry-After") || "30", 10) || 30, 5);
        if (wait > 15 * 60) {
          throw new Error(`Spotify asked us to wait ${Math.ceil(wait / 60)} minutes. Come back later and press import again: it carries on where it stopped.`);
        }
        for (let left = wait; left > 0; left--) {
          setWaitNote(`Spotify asked us to slow down. Carrying on in ${left}s…`);
          await new Promise((r) => setTimeout(r, 1000));
        }
        setWaitNote(null);
        continue;
      }
      const data: any = await res.json().catch(() => null);
      if (res.status === 403) {
        throw Object.assign(new Error("Spotify won't let this account in yet. Spotify limits new sites to a few invited accounts, so ask us to add yours."), { status: 403 });
      }
      if (res.status === 401) throw new Error("Your Spotify session expired — press the button again to reconnect. It carries on where it stopped.");
      if (res.status === 429) throw new Error("Spotify is very busy right now. Try again later: it carries on where it stopped.");
      if (!res.ok) throw new Error(`Spotify said no (${res.status}): ${data?.error?.message ?? "unknown error"}. Try again in a minute.`);
      return data;
    }
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
    let suggestNow: (() => Promise<number>) | null = null;
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
      // Suggest artists who aren't here yet from whatever was read, so an
      // import that stops part way still counts.
      suggestNow = async () => {
        if (byArtist.size === 0) return 0;
        return suggestArtists([...byArtist.values()]);
      };
      const suggest = suggestNow;
      const totals = { collected: 0, added: 0, waiting: 0 };
      let chunk: Record<string, unknown>[] = [];
      // Where each list got to, kept in this browser after every batch sent,
      // so a stopped import (Spotify saying slow down, a closed tab) carries
      // on instead of starting again from the first song.
      const PROGRESS_KEY = "static_cuts_spotify_import_progress";
      let progress: Record<string, string> = {};
      try { progress = JSON.parse(local.get(PROGRESS_KEY) ?? "{}") ?? {}; } catch { progress = {}; }
      const saveProgress = () => local.set(PROGRESS_KEY, JSON.stringify(progress));
      if (Object.keys(progress).length > 0) setWaitNote("Carrying on from where your last import stopped…");
      const send = async () => {
        if (chunk.length === 0) return;
        await importBatch(chunk, totals);
        chunk = [];
      };
      for (const src of sources.filter((x) => picked.has(x.id))) {
        if (progress[src.id] === "done") continue;
        let next: string | null = progress[src.id]?.startsWith("https://api.spotify.com/") ? progress[src.id] : src.id === "liked"
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
              const named = splitCredits(t.name || "");
              chunk.push({
                spotify_url: t.external_urls.spotify,
                album_id: t.album?.id ?? null,
                album_type: t.album?.album_type ?? null,
                artist_ids: (t.artists ?? []).map((a: any) => a.id).filter(Boolean),
                // Used to add the song straight away for trusted people.
                title: named.title.replace(/\s+-\s+(\d{4}\s+)?(remaster(ed)?( version)?|single version|radio edit|mono|stereo|bonus track)\b.*$/i, "").trim(),
                credits: named.credits,
                album_name: t.album?.name ?? null,
                total_tracks: t.album?.total_tracks ?? null,
                release_date: t.album?.release_date ?? null,
                release_precision: t.album?.release_date_precision ?? null,
                track_number: t.track_number ?? null,
                // Kept too: length, ISRC, explicit, album cover.
                duration_ms: typeof t.duration_ms === "number" ? String(t.duration_ms) : null,
                explicit: typeof t.explicit === "boolean" ? String(t.explicit) : null,
                isrc: t.external_ids?.isrc ?? null,
                cover: t.album?.images?.[0]?.url ?? null,
                artists: (t.artists ?? []).map((a: any) => ({ id: a.id, name: a.name })),
              });
            }
            setImportProgress(checked);
            if (checked > 0) setWaitNote(null);
            next = data?.next ?? null;
            if (chunk.length >= 500) {
              await send();
              progress[src.id] = next ?? "done";
              saveProgress();
            }
          }
          await send();
          progress[src.id] = "done";
          saveProgress();
        } catch (e: any) {
          // One playlist Spotify won't share shouldn't stop the rest.
          if (src.id !== "liked" && e?.status === 403) { skipped.push(src.name); progress[src.id] = "done"; saveProgress(); continue; }
          throw e;
        }
      }
      await send();
      const suggested = await suggest();
      local.remove(PROGRESS_KEY);
      setImportResult({ checked, ...totals, skipped, suggested });
      onDone?.();
      setSources(null);
    } catch (e: any) {
      const n = suggestNow ? await suggestNow().catch(() => 0) : 0;
      setImportError((e?.message ?? String(e)) + (n > 0 ? ` (Before it stopped: ${n} artist${n === 1 ? "" : "s"} suggested as new artists.)` : ""));
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
      options: { redirectTo: window.location.origin + "/collection/import", scopes: "user-library-read playlist-read-private playlist-read-collaborative" },
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

  return (
    <div id="spotify" style={{ scrollMarginTop: 20 }}>
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
      {waitNote && <div className="comment-meta" style={{ marginBottom: 10 }}>{waitNote}</div>}
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
    </div>
  );
}
