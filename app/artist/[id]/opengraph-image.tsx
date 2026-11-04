// The picture shown when an artist link is shared on Discord, Reddit, X or
// in a group chat, in the STATIC-CUTS// look: their photo cut through, the
// name in the sliced type, how many songs and how many unreleased.

import { ImageResponse } from "next/og";
import { supabase } from "@/lib/supabase";
import { Sliced, SlicedImage, Mono, Label, Wordmark, staticOverlay, safeImage, slideOptions, clip, CREAM, DIM, INK, LINE, DISPLAY } from "@/lib/slides";

export const alt = "Artist on STATIC-CUTS//";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data: artist }, { count }, { count: unreleased }, options] = await Promise.all([
    supabase.from("artists").select("name, image_url").eq("id", id).maybeSingle(),
    supabase.from("tracks").select("id", { count: "exact", head: true }).eq("artist_id", id),
    supabase.from("tracks").select("id", { count: "exact", head: true }).eq("artist_id", id).neq("release_status", "released"),
    slideOptions(1200, 630),
  ]);
  const name = clip((artist?.name as string | undefined) ?? "Artist not found", 24);
  const photo = await safeImage(artist?.image_url as string | null | undefined);
  const n = (x: number | null) => (x ?? 0).toLocaleString("en-GB");
  const nameSize = Math.max(64, Math.min(150, Math.floor(620 / (name.length * 0.52))));

  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", position: "relative", background: INK, color: CREAM }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={staticOverlay()} width={1200} height={630} alt="" style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630 }} />
        <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, display: "flex", padding: 48 }}>
          {photo
            ? <SlicedImage src={photo} w={430} h={534} at={0.6} />
            : <div style={{ display: "flex", width: 430, height: 534, background: "#151515", alignItems: "center", justifyContent: "center" }}><Wordmark size={60} /></div>}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: 48 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Label size={18}>Artist</Label>
              <Wordmark size={30} />
            </div>
            <div style={{ display: "flex", flex: 1, alignItems: "center" }}>
              <Sliced size={nameSize}>{name.toUpperCase()}</Sliced>
            </div>
            <div style={{ display: "flex", borderTop: `1px solid ${LINE}`, paddingTop: 18 }}>
              {[{ v: n(count), l: "Songs" }, ...((unreleased ?? 0) > 0 ? [{ v: n(unreleased), l: "Unreleased" }] : [])].map((s) => (
                <div key={s.l} style={{ display: "flex", flexDirection: "column", marginRight: 56 }}>
                  <div style={{ display: "flex", fontFamily: DISPLAY, fontStyle: "italic", fontWeight: 900, fontSize: 72, lineHeight: 1 }}>{s.v}</div>
                  <Mono size={18} color={DIM}>{s.l}</Mono>
                </div>
              ))}
            </div>
            <Mono size={16} color={DIM} style={{ marginTop: 18 }}>Every song · leak · version — static-cuts.com</Mono>
          </div>
        </div>
      </div>
    ),
    options,
  );
}
