"use client";

// "Import from Spotify" (Settings) goes away to Spotify and comes back. If
// Spotify sends the listener back somewhere other than Settings (Supabase
// falls back to the homepage when a return address isn't on its allowed
// list), take them back to Settings so the import carries on.

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { local } from "@/lib/safeStorage";

export default function SpotifyImportResume() {
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (path !== "/settings" && local.get("static_cuts_spotify_import_pending") === "true") {
      router.replace("/settings#spotify-import");
    }
  }, [path, router]);
  return null;
}
