// Album of the week as Instagram/TikTok slides (1080×1350, portrait).
//   /album-of-the-week/slide?n=1   poster: cover full-bleed, title, blurb
//   /album-of-the-week/slide?n=2   inside the vault: the era's unreleased count and a few titles
// Add &week=2026-11-09 for a given week (once that week has started).

import { ImageResponse } from "next/og";
import { supabase } from "@/lib/supabase";
import { Frame, Tag, Spacer, ACCENT, RED, MONO, POSTER, W, glitch, niceDate, tidy, clip, safeImage, slideOptions } from "@/lib/slides";

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
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#070707", color: "#A3A3A3", fontSize: 40 }}>
        No album of the week picked yet
      </div>,
      options,
    );
  }
  // Pictures checked first (a dead link or WebP would break the slide).
  const a = { ...found, cover: await safeImage(found.cover) };
  const wc = `W/C ${niceDate(a.week_start, false).toUpperCase()}`;
  const page = `0${n}/02`;

  if (n === 1) {
    const blurb = a.blurb ?? "";
    const titleSize = a.title.length > 22 ? 104 : a.title.length > 14 ? 136 : 176;
    return new ImageResponse(
      <Frame file="ALBUM_OF_THE_WEEK" page={page} bg={a.cover} bgHeight={W}>
        <Spacer />
        <div style={{ display: "flex", marginBottom: 14 }}>
          <Tag color={ACCENT}>ALBUM OF THE WEEK</Tag>
          <div style={{ display: "flex", marginLeft: 12 }}><Tag color="#EDEDED" solid={false}>{wc}</Tag></div>
        </div>
        <div style={{ display: "flex", fontFamily: POSTER, fontSize: titleSize, lineHeight: 0.88, textTransform: "uppercase", ...glitch(6) }}>{a.title}</div>
        <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 32, color: ACCENT, marginTop: 14, letterSpacing: 1 }}>
          {a.artist.toUpperCase()}{a.year ? ` // ${a.year}` : ""}
        </div>
        {blurb && <div style={{ display: "flex", fontFamily: MONO, fontSize: blurb.length > 240 ? 22 : 24, lineHeight: 1.45, marginTop: 18, color: "#D6D6D6" }}>{blurb}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 24, color: ACCENT, letterSpacing: 4, marginTop: 18, marginBottom: 26 }}>INSIDE THE VAULT &gt;&gt;</div>
      </Frame>,
      options,
    );
  }

  const songs = (a.highlights ?? []).map(tidy).filter(Boolean).slice(0, 5);
  return new ImageResponse(
    <Frame file={`VAULT/${a.artist.toUpperCase().replace(/\s+/g, "_")}`} page={page} bg={a.cover} fade={0.5}>
      <div style={{ display: "flex", marginTop: 40 }}><Tag color={RED}>INSIDE THE VAULT</Tag></div>
      <div style={{ display: "flex", fontFamily: POSTER, fontSize: 280, lineHeight: 0.86, color: ACCENT, marginTop: 18, ...glitch(8) }}>{a.unreleased.toLocaleString("en-GB")}</div>
      <div style={{ display: "flex", fontFamily: POSTER, fontSize: 84, lineHeight: 0.95, ...glitch(4) }}>UNRELEASED SONGS</div>
      <div style={{ display: "flex", fontSize: 26, color: "#BDBDBD", marginTop: 10 }}>from the {a.title} era</div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: 34 }}>
        {songs.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", marginBottom: 12, background: "rgba(14,14,14,0.88)", border: "1px solid #2A2A2A", borderLeft: `8px solid ${RED}`, padding: "14px 20px" }}>
            <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 26, color: "#6A6A6A", width: 64 }}>{String(i + 1).padStart(2, "0")}</div>
            <div style={{ display: "flex", fontFamily: POSTER, fontSize: 46, flex: 1, textTransform: "uppercase" }}>{clip(s, 26)}</div>
            <Tag color={RED} size={18}>UNRELEASED</Tag>
          </div>
        ))}
      </div>
      <Spacer />
      <div style={{ display: "flex", marginBottom: 26 }}>
        <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, background: ACCENT, color: "#070707", fontSize: 26, padding: "12px 22px", letterSpacing: 2 }}>
          + {Math.max(0, a.unreleased - songs.length).toLocaleString("en-GB")} MORE &gt; STATIC-CUTS.COM
        </div>
      </div>
    </Frame>,
    options,
  );
}
