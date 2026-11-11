// The picture shown when an artist link is shared on Discord, Reddit,
// Twitter or in a group chat: photo, name and how many songs (and how many
// unreleased) the archive has for them.

import { ImageResponse } from "next/og";
import { supabase } from "@/lib/supabase";

export const alt = "Artist on Static-Cuts//";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data: artist }, { count }, { count: unreleased }] = await Promise.all([
    supabase.from("artists").select("name, image_url").eq("id", id).maybeSingle(),
    supabase.from("tracks").select("id", { count: "exact", head: true }).eq("artist_id", id),
    supabase.from("tracks").select("id", { count: "exact", head: true }).eq("artist_id", id).neq("release_status", "released"),
  ]);
  const name = (artist?.name as string | undefined) ?? "Artist not found";
  const photo = (artist?.image_url as string | null | undefined) ?? null;
  const n = (x: number | null) => (x ?? 0).toLocaleString("en-GB");

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#0A0A0A", color: "#EDEDED", padding: 60, fontFamily: "sans-serif", alignItems: "center" }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} width={380} height={380} style={{ borderRadius: 999, marginRight: 60, objectFit: "cover", border: "6px solid #6C5CE7" }} alt="" />
        ) : (
          <div style={{ width: 380, height: 380, borderRadius: 999, marginRight: 60, background: "#1D1D1D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 120, color: "#565656" }}>SC//</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: name.length > 18 ? 64 : 84, fontWeight: 700, lineHeight: 1.05 }}>{name}</div>
          <div style={{ display: "flex", gap: 40, marginTop: 34 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 64, fontWeight: 700, color: "#8B7CF6" }}>{n(count)}</div>
              <div style={{ fontSize: 26, color: "#A3A3A3", letterSpacing: 3 }}>SONGS</div>
            </div>
            {(unreleased ?? 0) > 0 && (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 64, fontWeight: 700, color: "#8B7CF6" }}>{n(unreleased)}</div>
                <div style={{ fontSize: 26, color: "#A3A3A3", letterSpacing: 3 }}>UNRELEASED</div>
              </div>
            )}
          </div>
          <div style={{ fontSize: 28, color: "#A3A3A3", marginTop: 34 }}>Every song, leak and version</div>
          <div style={{ fontSize: 30, color: "#EDEDED", marginTop: 14, fontWeight: 700 }}>STATIC-CUTS//</div>
        </div>
      </div>
    ),
    size,
  );
}
