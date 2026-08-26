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
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [about, setAbout] = useState("");
  const [uploading, setUploading] = useState(false);
  const [savingAbout, setSavingAbout] = useState(false);
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
      while (next) {
        const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${providerToken}` } });
        if (!res.ok) throw new Error(`Spotify API error (${res.status}) — try reconnecting.`);
        const data: any = await res.json();
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
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.provider_token) {
      // Already have a live Spotify token from this session -- just try
      // it directly first, no need to force a fresh re-auth every time.
      runSpotifyImport();
      return;
    }
    localStorage.setItem("static_cuts_spotify_import_pending", "true");
    await supabase.auth.signInWithOAuth({
      provider: "spotify",
      options: { redirectTo: window.location.origin + "/settings", scopes: "user-library-read" },
    });
  }

  useEffect(() => {
    if (!user) return;
    if (localStorage.getItem("static_cuts_spotify_import_pending") === "true") {
      localStorage.removeItem("static_cuts_spotify_import_pending");
      runSpotifyImport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("show_completion_pct, show_collected_tracks, show_ratings, show_followed_artists, avatar_url, about")
        .eq("id", user.id)
        .single();
      if (data) {
        setPrefs(data as Prefs);
        setAvatarUrl(data.avatar_url ?? null);
        setAbout(data.about ?? "");
      }
    }
    load();
  }, [user]);

  async function uploadAvatar(file: File) {
    if (!user) return;

    const MAX_SIZE = 5 * 1024 * 1024; // 5MB, matches the bucket limit
    const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

    if (!ALLOWED_TYPES.includes(file.type)) {
      alert("Please upload a PNG, JPEG, WEBP, or GIF image.");
      return;
    }
    if (file.size > MAX_SIZE) {
      alert("Image is too large — 5MB max.");
      return;
    }

    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${user.id}/avatar.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true });
    if (uploadErr) {
      alert(uploadErr.message);
      setUploading(false);
      return;
    }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    // Cache-bust so the new image shows immediately instead of a stale cached version.
    const freshUrl = `${data.publicUrl}?t=${Date.now()}`;
    await supabase.from("profiles").update({ avatar_url: freshUrl }).eq("id", user.id);
    setAvatarUrl(freshUrl);
    setUploading(false);
  }

  async function saveAbout() {
    if (!user) return;
    setSavingAbout(true);
    await supabase.from("profiles").update({ about: about.trim() }).eq("id", user.id);
    setSavingAbout(false);
  }

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
        Profile
      </h1>

      <div style={{ maxWidth: 520, marginBottom: 30 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              overflow: "hidden",
              background: "var(--surface)",
              border: "1.5px solid var(--hair)",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="Your avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ color: "var(--smoke)", fontFamily: "var(--font-mono)", fontSize: "0.65rem" }}>none</span>
            )}
          </div>
          <div>
            <input
              type="file"
              accept="image/*"
              id="avatarInput"
              style={{ display: "none" }}
              onChange={(e) => { if (e.target.files?.[0]) uploadAvatar(e.target.files[0]); }}
            />
            <label htmlFor="avatarInput" className="tab" style={{ cursor: "pointer", display: "inline-block" }}>
              {uploading ? "uploading…" : "upload photo"}
            </label>
          </div>
        </div>

        <div className="comments-count" style={{ marginBottom: 6 }}>About</div>
        <textarea
          className="comment-textarea"
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          placeholder="A short bio, what you're into, whatever you want…"
          maxLength={500}
          style={{ marginBottom: 8 }}
        />
        <button className="comment-post-btn" disabled={savingAbout} onClick={saveAbout}>
          {savingAbout ? "…" : "save about"}
        </button>
      </div>

      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>
        Import from Spotify
      </h1>
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

      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>
        Privacy
      </h1>
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
