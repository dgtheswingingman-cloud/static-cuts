"use client";

// Premium: download an artist's full tracklist as a spreadsheet (every song
// and version with status, era, dates, credits, links and Static-Cuts code).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { saveCsv, fileSafe } from "@/lib/csv";
import { usePersonalUser } from "../../useIsAdmin";
import { usePremium } from "../../usePremium";

type R = { title: string; version_of: string | null; status: string; era: string | null; track_number: number | null; release_date: string | null;
  leak_date: string | null; length_sec: number | null; producers: string | null; featured_artists: string | null;
  spotify_url: string | null; apple_url: string | null; deezer_url: string | null; code: string | null; url: string };
const mmss = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");

export default function ExportArtist({ artistId, name }: { artistId: string; name: string }) {
  const user = usePersonalUser();
  const { premium } = usePremium();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function go() {
    if (!user) { router.push("/login"); return; }
    if (!premium) { router.push("/premium"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("rpc_export_artist", { p_artist: artistId });
    setBusy(false);
    if (error) { setFailed(true); setTimeout(() => setFailed(false), 3000); return; }
    const rows = (data as R[]) ?? [];
    saveCsv(`static-cuts-${fileSafe(name)}-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Title", "Version of", "Status", "Era / album", "Track", "Released", "Leaked", "Length", "Producers", "Featuring", "Spotify", "Apple Music", "Deezer", "Static-Cuts code", "Page"],
      ...rows.map((r) => [r.title, r.version_of, r.status, r.era, r.track_number, r.release_date, r.leak_date, mmss(r.length_sec), r.producers, r.featured_artists,
        r.spotify_url, r.apple_url, r.deezer_url, r.code, r.url]),
    ]);
  }
  return (
    <button className="tab" disabled={busy} onClick={go}
      title={premium ? "Download every song and version as a spreadsheet" : "Premium: download the full tracklist as a spreadsheet"}>
      {busy ? "Exporting…" : failed ? "Couldn't export, try again" : premium ? "⇩ Export" : "⇩ Export (premium)"}
    </button>
  );
}

