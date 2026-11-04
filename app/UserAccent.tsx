"use client";

// Your profile colour (a supporter perk) becomes the site's accent for you:
// selected tabs, main buttons, the side menu, links. Artist and song pages
// still take their own colour from the art. Remembered in this browser so
// it shows straight away; the Edit profile panel announces changes.

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { local } from "@/lib/safeStorage";
import { useAuth } from "./AuthProvider";

const KEY = "static_cuts_accent";

function apply(hex: string | null) {
  const root = document.documentElement;
  if (hex && /^#[0-9a-f]{6}$/i.test(hex)) root.style.setProperty("--accent", hex);
  else root.style.removeProperty("--accent");
}

export default function UserAccent() {
  const { user, loading } = useAuth();
  useEffect(() => {
    apply(local.get(KEY));
    const onChange = (e: Event) => {
      const hex = (e as CustomEvent<string | null>).detail ?? null;
      if (hex) local.set(KEY, hex); else local.remove(KEY);
      apply(hex);
    };
    window.addEventListener("sc-accent", onChange);
    return () => window.removeEventListener("sc-accent", onChange);
  }, []);
  useEffect(() => {
    if (loading) return;
    if (!user) { local.remove(KEY); apply(null); return; }
    supabase.rpc("rpc_profile_style", { p_user: user.id }).then(({ data }) => {
      const hex = (data as { accent?: string | null } | null)?.accent ?? null;
      if (hex) local.set(KEY, hex); else local.remove(KEY);
      apply(hex);
    });
  }, [user?.id, loading]);
  return null;
}
