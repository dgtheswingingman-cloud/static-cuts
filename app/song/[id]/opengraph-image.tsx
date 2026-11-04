// The picture shown when a song link is shared on Discord, Reddit, X or in
// a group chat, in the STATIC-CUTS// look: the cover cut through, the title
// in the sliced type, artist, status, era and versions, so people get the
// answer without opening the link.

import { ImageResponse } from "next/og";
import { supabase } from "@/lib/supabase";
import { Sliced, SlicedImage, Mono, Label, Tag, Wordmark, staticOverlay, safeImage, slideOptions, clip, CREAM, DIM, INK, LINE } from "@/lib/slides";

export const alt = "Song on STATIC-CUTS//";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

type Song = {
  track?: { title: string; release_status: string | null; album: string | null; cover_url?: string | null; display_cover?: { url: string } | null;
            release_date?: string | null; leak_date?: string | null; spotify_url?: string | null; status_source?: string | null };
  artist?: { name: string };
  family?: { id: string }[];
};

const NICE: Record<string, string> = { leaked: "Leaked", snippet: "Snippet", released: "Released", unconfirmed: "Unreleased", rumored: "Rumoured", teased: "Teased", announced: "Announced" };

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data }, options] = await Promise.all([supabase.rpc("rpc_song_page", { p_id: id }), slideOptions(1200, 630)]);
  const s = (data ?? {}) as Song;
  const t = s.track;
  const status = t?.release_status ?? "unconfirmed";
  const cover = await safeImage(t?.display_cover?.url ?? t?.cover_url ?? null);
  const title = clip((t?.title ?? "Song not found").toUpperCase(), 24);
  const titleSize = Math.max(56, Math.min(140, Math.floor(620 / (title.length * 0.52))));
  const versions = (s.family?.length ?? 1) - 1;
  const facts = [
    t?.album ? `Era: ${t.album}` : null,
    t?.release_date ? `Released ${t.release_date.slice(0, 4)}` : t?.leak_date ? `Leaked ${t.leak_date.slice(0, 4)}` : null,
    versions > 0 ? `${versions} other version${versions === 1 ? "" : "s"}` : null,
  ].filter(Boolean) as string[];

  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", position: "relative", background: INK, color: CREAM }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={staticOverlay()} width={1200} height={630} alt="" style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630 }} />
        <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, display: "flex", padding: 48 }}>
          {cover
            ? <SlicedImage src={cover} w={534} h={534} at={0.64} />
            : <div style={{ display: "flex", width: 534, height: 534, background: "#151515", alignItems: "center", justifyContent: "center" }}><Wordmark size={64} /></div>}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: 44 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Label size={18}>{s.artist?.name ?? "Song"}</Label>
              <Wordmark size={28} />
            </div>
            <div style={{ display: "flex", flex: 1, alignItems: "center" }}>
              <Sliced size={titleSize}>{title}</Sliced>
            </div>
            <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${LINE}`, paddingTop: 18 }}>
              <div style={{ display: "flex" }}><Tag size={20} solid={status === "leaked"}>{NICE[status] ?? status}</Tag></div>
              {facts.length > 0 && <Mono size={18} color={DIM} style={{ marginTop: 16 }}>{facts.join(" · ")}</Mono>}
            </div>
          </div>
        </div>
      </div>
    ),
    options,
  );
}
