"use client";

// "Import from Spotify" (on the import page) goes away to Spotify and comes back. If
// Spotify sends the listener back somewhere other than the import page (Supabase
// falls back to the homepage when a return address isn't on its allowed
// list), take them back there so the import carries on.

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { local } from "@/lib/safeStorage";

export default function SpotifyImportResume() {
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (path !== "/collection/import" && local.get("static_cuts_spotify_import_pending") === "true") {
      router.replace("/collection/import#spotify");
    }
  }, [path, router]);
  return null;
}
