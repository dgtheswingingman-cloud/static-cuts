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

// Dark text on light colours, light text on dark ones.
function onColour(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.18 ? "#070707" : "#EDEDED";
}

function apply(hex: string | null) {
  const root = document.documentElement;
  if (hex && /^#[0-9a-f]{6}$/i.test(hex)) {
    root.style.setProperty("--accent", hex);
    root.style.setProperty("--on-accent", onColour(hex));
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--on-accent");
  }
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
