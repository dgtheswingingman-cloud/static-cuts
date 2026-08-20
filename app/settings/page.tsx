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
