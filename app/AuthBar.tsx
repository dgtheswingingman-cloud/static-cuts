"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";

// Bootstrapped reviewer -- same account hardcoded in the SQL functions.
// Swap this out once real per-artist trust/reputation exists.
const ADMIN_EMAIL = "dg.theswingingman@gmail.com";

export default function AuthBar() {
  const { user, loading, signOut } = useAuth();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      if (!user) {
        setDisplayName(null);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();
      setDisplayName(data?.display_name ?? user.email ?? "");
    }
    loadProfile();
  }, [user]);

  async function saveDisplayName() {
    if (!user) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: trimmed })
      .eq("id", user.id);
    setSaving(false);
    if (!error) {
      setDisplayName(trimmed);
      setEditing(false);
    }
  }

  if (loading) return null;

  const barStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "center",
    gap: 10,
    alignItems: "center",
    marginTop: 14,
    fontFamily: "var(--font-mono)",
    fontSize: "0.72rem",
    color: "var(--smoke)",
    flexWrap: "wrap",
  };

  const smallBtn: React.CSSProperties = {
    background: "none",
    border: "1px solid var(--hair)",
    color: "var(--smoke)",
    padding: "4px 10px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "inherit",
    textDecoration: "none",
  };

  if (!user) {
    return (
      <div style={barStyle}>
        <Link href="/login" style={{ color: "var(--smoke)" }}>
          log in / sign up
        </Link>
      </div>
    );
  }

  if (editing) {
    return (
      <div style={barStyle}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveDisplayName();
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="display name"
          style={{
            fontFamily: "inherit",
            fontSize: "inherit",
            background: "var(--surface)",
            border: "1px solid var(--hair)",
            color: "var(--bone)",
            padding: "4px 8px",
            width: 160,
          }}
        />
        <button
          onClick={saveDisplayName}
          disabled={saving}
          style={{
            background: "var(--bone)",
            border: "1px solid var(--bone)",
            color: "var(--void)",
            padding: "4px 10px",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: "inherit",
          }}
        >
          {saving ? "…" : "save"}
        </button>
        <button onClick={() => setEditing(false)} style={smallBtn}>
          cancel
        </button>
      </div>
    );
  }

  return (
    <div style={barStyle}>
      <span>signed in as {displayName ?? user.email}</span>
      <Link href={`/profile/${user.id}`} style={smallBtn}>
        my profile
      </Link>
      <Link href="/my-submissions" style={smallBtn}>
        my submissions
      </Link>
      {user.email === ADMIN_EMAIL && (
        <Link href="/review" style={smallBtn}>
          review queue
        </Link>
      )}
      <Link href="/settings" style={smallBtn}>
        privacy
      </Link>
      <button
        onClick={() => {
          setDraft(displayName ?? "");
          setEditing(true);
        }}
        style={smallBtn}
      >
        edit name
      </button>
      <button onClick={() => signOut()} style={smallBtn}>
        log out
      </button>
    </div>
  );
}
