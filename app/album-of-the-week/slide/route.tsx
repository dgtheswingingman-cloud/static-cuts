// Album of the week as Instagram/TikTok slides (1080×1350), in the
// STATIC-CUTS// look.
//   /album-of-the-week/slide?n=1   the cover, cut through; title and blurb
//   /album-of-the-week/slide?n=2   inside the vault: the era's unreleased count and songs
// Add &week=2026-11-09 for a given week (once that week has started).

import { ImageResponse } from "next/og";
import { supabase } from "@/lib/supabase";
import { Frame, Sliced, SlicedImage, Mono, Label, Rule, Tag, Spacer, CREAM, DIM, INK, LINE, DISPLAY, MONO, niceDate, weekNo, pad, tidy, clip, safeImage, slideOptions } from "@/lib/slides";

type Aotw = { week_start: string; artist: string; title: string; year: number | null; cover: string | null; unreleased: number; highlights: string[] | null; blurb: string | null };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const n = url.searchParams.get("n") === "2" ? 2 : 1;
  const week = url.searchParams.get("week");
  const [{ data }, options] = await Promise.all([
    supabase.rpc("rpc_album_of_week", week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? { p_week: week } : {}),
    slideOptions(),
  ]);
  const found = data as Aotw | null;

  if (!found) {
    return new ImageResponse(
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: INK, color: DIM, fontSize: 40 }}>
        No album of the week picked yet
      </div>,
      options,
    );
  }
  // Pictures checked first (a dead link or WebP would break the slide).
  const a = { ...found, cover: await safeImage(found.cover) };
  const code = `AOTW / ${pad(weekNo(a.week_start), 2)} · ${n}/2`;
  const footer = `W/C ${niceDate(a.week_start, false)}`;

  if (n === 1) {
    const blurb = a.blurb ?? "";
    // Condensed letters are about half as wide as they are tall: fit 960px.
    const titleSize = Math.max(64, Math.min(156, Math.floor(960 / (a.title.length * 0.52))));
    return new ImageResponse(
      <Frame code={code} footer={footer}>
        <div style={{ display: "flex", marginTop: 40, justifyContent: "space-between", alignItems: "center" }}>
          <Label>Album of the week</Label>
          <Mono size={20} color={DIM}>{a.artist}{a.year ? ` · ${a.year}` : ""}</Mono>
        </div>
        <div style={{ display: "flex", marginTop: 28 }}>
          {a.cover
            ? <SlicedImage src={a.cover} w={960} h={blurb.length > 200 ? 520 : 580} at={0.66} />
            : <div style={{ display: "flex", width: 960, height: 520, background: "#151515" }} />}
        </div>
        <div style={{ display: "flex", marginTop: 30 }}>
          <Sliced size={titleSize}>{a.title.toUpperCase()}</Sliced>
        </div>
        {blurb && <div style={{ display: "flex", fontFamily: MONO, fontSize: blurb.length > 240 ? 21 : 23, lineHeight: 1.5, marginTop: 22, color: CREAM }}>{blurb}</div>}
        <Spacer />
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}><Mono size={20}>Inside the vault &gt;&gt;</Mono></div>
      </Frame>,
      options,
    );
  }

  const songs = (a.highlights ?? []).map(tidy).filter(Boolean).slice(0, 5);
  return new ImageResponse(
    <Frame code={code} footer={footer} bg={a.cover} fade={0.3}>
      <div style={{ display: "flex", marginTop: 44 }}><Label>Inside the vault</Label></div>
      <div style={{ display: "flex", marginTop: 26 }}>
        <Sliced size={300}>{a.unreleased.toLocaleString("en-GB")}</Sliced>
      </div>
      <div style={{ display: "flex", marginTop: 14 }}><Sliced size={92} lines={false}>UNRELEASED SONGS</Sliced></div>
      <Mono size={22} color={DIM} style={{ marginTop: 14 }}>From the {a.title} era · {a.artist}</Mono>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 40 }}>
        {songs.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", padding: "16px 0", borderTop: `1px solid ${LINE}` }}>
            <Mono size={20} color={DIM} style={{ width: 70 }}>{pad(i + 1, 2)}</Mono>
            <div style={{ display: "flex", fontFamily: DISPLAY, fontStyle: "italic", fontWeight: 900, fontSize: 54, lineHeight: 1, flex: 1, textTransform: "uppercase" }}>{clip(s, 24)}</div>
            <Tag size={16}>Unreleased</Tag>
          </div>
        ))}
        {songs.length > 0 && <Rule />}
      </div>
      <Spacer />
      <div style={{ display: "flex", marginBottom: 24 }}>
        <div style={{ display: "flex", background: CREAM, color: INK, fontFamily: MONO, fontWeight: 700, fontSize: 22, letterSpacing: 3, padding: "12px 20px" }}>
          + {Math.max(0, a.unreleased - songs.length).toLocaleString("en-GB")} MORE &gt; STATIC-CUTS.COM
        </div>
      </div>
    </Frame>,
    options,
  );
}
