"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";

export default function AuthBar() {
  const { user, loading, signOut } = useAuth();

  if (loading) return null;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        gap: 10,
        alignItems: "center",
        marginTop: 14,
        fontFamily: "var(--font-mono)",
        fontSize: "0.72rem",
        color: "var(--smoke)",
      }}
    >
      {user ? (
        <>
          <span>signed in as {user.email}</span>
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
        </>
      ) : (
        <Link href="/login" style={{ color: "var(--smoke)" }}>
          log in / sign up
        </Link>
      )}
    </div>
  );
}
