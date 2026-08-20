"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import { useIsAdmin, useIsRealAdmin } from "./useIsAdmin";
import { useAdminView } from "./AdminViewContext";

export default function AuthBar() {
  const { user, loading, signOut } = useAuth();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const isAdmin = useIsAdmin();
  const isRealAdmin = useIsRealAdmin();
  const { viewAsNonAdmin, setViewAsNonAdmin } = useAdminView();

  useEffect(() => {
    async function loadProfile() {
      if (!user) { setDisplayName(null); return; }
      const { data } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
      setDisplayName(data?.display_name ?? user.email ?? "");
    }
    loadProfile();
  }, [user]);

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

  return (
    <>
      <div style={barStyle}>
        <span>signed in as {displayName ?? user.email}</span>
        <Link href={`/profile/${user.id}`} style={smallBtn}>
          my profile
        </Link>
        <Link href="/my-submissions" style={smallBtn}>
          my submissions
        </Link>
        {isAdmin && (
          <Link href="/review" style={smallBtn}>
            review queue
          </Link>
        )}
        {isAdmin && (
          <Link href="/admin/spotify-matcher" style={smallBtn}>
            spotify matcher
          </Link>
        )}
        <button onClick={() => signOut()} style={smallBtn}>
          log out
        </button>
      </div>

      {isRealAdmin && (
        <div style={{ ...barStyle, marginTop: 8 }}>
          <span style={{ color: "var(--hair-strong)" }}>role:</span>
          <select
            className="sort-select"
            value={viewAsNonAdmin ? "user" : "admin"}
            onChange={(e) => setViewAsNonAdmin(e.target.value === "user")}
            style={{ fontSize: "0.68rem" }}
          >
            <option value="admin">Administrator</option>
            <option value="user">Regular user (preview)</option>
          </select>
        </div>
      )}
    </>
  );
}
