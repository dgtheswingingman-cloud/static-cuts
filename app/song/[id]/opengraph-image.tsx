// The picture shown when a song link is shared on Discord, Reddit, Twitter
// or in a group chat: title, artist, status, album and versions, with the
// cover art, so people get the answer without opening the link.

import { ImageResponse } from "next/og";
import { supabase } from "@/lib/supabase";

export const alt = "Song on Static Cuts//";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

type Song = {
  track?: { title: string; release_status: string | null; album: string | null; cover_url?: string | null;
            release_date?: string | null; leak_date?: string | null; spotify_url?: string | null; status_source?: string | null };
  artist?: { name: string };
  family?: { id: string }[];
};

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await supabase.rpc("rpc_song_page", { p_id: id });
  const s = (data ?? {}) as Song;
  const t = s.track;
  const status = t?.release_status ?? "unconfirmed";
  const confirmed = status === "released" && /open\.spotify\.com/.test(t?.spotify_url ?? "");
  const facts = [
    t?.album,
    t?.release_date ? `released ${t.release_date.slice(0, 4)}` : t?.leak_date ? `leaked ${t.leak_date.slice(0, 4)}` : null,
    (s.family?.length ?? 0) > 1 ? `${(s.family?.length ?? 1) - 1} other version${(s.family?.length ?? 1) - 1 === 1 ? "" : "s"}` : null,
  ].filter(Boolean) as string[];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#0A0A0A", color: "#EDEDED", padding: 60, fontFamily: "sans-serif" }}>
        {t?.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.cover_url} width={360} height={360} style={{ borderRadius: 18, marginRight: 56, objectFit: "cover" }} alt="" />
        ) : (
          <div style={{ width: 360, height: 360, borderRadius: 18, marginRight: 56, background: "#1D1D1D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 120, color: "#565656" }}>SC//</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
          <div style={{ fontSize: t && t.title.length > 28 ? 56 : 72, fontWeight: 700, lineHeight: 1.05 }}>{t?.title ?? "Song not found"}</div>
          <div style={{ fontSize: 40, color: "#A3A3A3", marginTop: 14 }}>{s.artist?.name ?? ""}</div>
          <div style={{ display: "flex", gap: 14, marginTop: 30 }}>
            <div style={{ fontSize: 30, padding: "6px 20px", border: "2px solid #EDEDED", borderRadius: 999 }}>{status}</div>
            {confirmed && <div style={{ fontSize: 30, padding: "6px 20px", border: "2px solid #4caf6a", color: "#4caf6a", borderRadius: 999 }}>confirmed on Spotify</div>}
          </div>
          {facts.length > 0 && <div style={{ fontSize: 30, color: "#A3A3A3", marginTop: 26 }}>{facts.join(" · ")}</div>}
          <div style={{ fontSize: 26, color: "#565656", marginTop: 40 }}>static-cuts.com</div>
        </div>
      </div>
    ),
    size,
  );
}
