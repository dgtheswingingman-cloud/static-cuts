"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";

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
        <button
          onClick={() => setEditing(false)}
          style={{
            background: "none",
            border: "1px solid var(--hair)",
            color: "var(--smoke)",
            padding: "4px 10px",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: "inherit",
          }}
        >
          cancel
        </button>
      </div>
    );
  }

  return (
    <div style={barStyle}>
      <span>signed in as {displayName ?? user.email}</span>
      <button
        onClick={() => {
          setDraft(displayName ?? "");
          setEditing(true);
        }}
        style={{
          background: "none",
          border: "1px solid var(--hair)",
          color: "var(--smoke)",
          padding: "4px 10px",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: "inherit",
        }}
      >
        edit name
      </button>
      <button
        onClick={() => signOut()}
        style={{
          background: "none",
          border: "1px solid var(--hair)",
          color: "var(--smoke)",
          padding: "4px 10px",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: "inherit",
        }}
      >
        log out
      </button>
    </div>
  );
}
