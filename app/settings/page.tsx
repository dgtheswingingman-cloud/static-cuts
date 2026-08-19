"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";

type Prefs = {
  show_completion_pct: boolean;
  show_collected_tracks: boolean;
  show_ratings: boolean;
};

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("show_completion_pct, show_collected_tracks, show_ratings")
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
        Privacy
      </h1>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        Nothing here is public until you turn it on. Your profile URL is{" "}
        {user ? `/profile/${user.id}` : "…"}.
      </div>

      {prefs && (
        <div style={{ maxWidth: 520 }}>
          <div style={rowStyle}>
            <span style={{ fontFamily: "var(--font-inter)", fontSize: "0.9rem" }}>
              Show my completion % publicly
            </span>
            <button
              className={`tab ${prefs.show_completion_pct ? "active" : ""}`}
              onClick={() => toggle("show_completion_pct")}
            >
              {prefs.show_completion_pct ? "on" : "off"}
            </button>
          </div>
          <div style={rowStyle}>
            <span style={{ fontFamily: "var(--font-inter)", fontSize: "0.9rem" }}>
              Show my collected tracks publicly
            </span>
            <button
              className={`tab ${prefs.show_collected_tracks ? "active" : ""}`}
              onClick={() => toggle("show_collected_tracks")}
            >
              {prefs.show_collected_tracks ? "on" : "off"}
            </button>
          </div>
          <div style={rowStyle}>
            <span style={{ fontFamily: "var(--font-inter)", fontSize: "0.9rem" }}>
              Show my ratings publicly
            </span>
            <button
              className={`tab ${prefs.show_ratings ? "active" : ""}`}
              onClick={() => toggle("show_ratings")}
            >
              {prefs.show_ratings ? "on" : "off"}
            </button>
          </div>
        </div>
      )}

      <div className="note">
        {saving ? "saving…" : "Changes save instantly."} These control what anyone can see on
        your public profile page — not what you see yourself, which always shows everything.
      </div>
    </div>
  );
}
