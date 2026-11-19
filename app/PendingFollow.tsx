"use client";

// A follow asked for while signed out (the song page's "Sign up to follow"),
// made as soon as that person is signed in, on whatever page they land on.
// Kept for a week, then forgotten.

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { local } from "@/lib/safeStorage";
import { useAuth } from "./AuthProvider";

const KEY = "static_cuts_pending_follow";
const WEEK = 7 * 24 * 60 * 60 * 1000;

export function savePendingFollow(artistId: string, name: string) {
  local.set(KEY, JSON.stringify({ artist_id: artistId, name, at: Date.now() }));
}

export default function PendingFollow() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    const raw = local.get(KEY);
    if (!raw) return;
    let p: { artist_id?: string; at?: number } | null = null;
    try { p = JSON.parse(raw); } catch { /* bad value */ }
    if (!p?.artist_id || !p.at || Date.now() - p.at > WEEK) { local.remove(KEY); return; }
    supabase.from("follows").upsert({ user_id: user.id, artist_id: p.artist_id }, { onConflict: "user_id,artist_id", ignoreDuplicates: true })
      .then(({ error }) => {
        if (error) return;
        local.remove(KEY);
        window.dispatchEvent(new CustomEvent("sc-followed", { detail: p?.artist_id }));
      });
  }, [user]);
  return null;
}
