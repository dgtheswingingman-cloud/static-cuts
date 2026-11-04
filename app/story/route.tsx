// Story pictures (1080×1920: Instagram / TikTok / Snapchat stories) in the
// STATIC-CUTS// look, made on the server so they match the slides (same
// fonts, cut type, static). The "story" buttons on song and artist pages
// POST what to show; we send back the PNG. Text is length-capped and
// pictures are fetched here (no browser picture-blocking problems).

import { ImageResponse } from "next/og";
import { Frame, Sliced, SlicedImage, Mono, Label, CREAM, DIM, INK, LINE, DISPLAY, safeImage, slideOptions, clip } from "@/lib/slides";

type Story = { kicker?: string; title?: string; subtitle?: string; lines?: string[]; bigNumber?: string; imageUrl?: string | null; round?: boolean; footer?: string };

const SW = 1080, SH = 1920;
const str = (x: unknown, n: number) => (typeof x === "string" ? x.slice(0, n) : "");

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Story;
  const kicker = str(body.kicker, 60);
  const title = str(body.title, 80) || "STATIC-CUTS//";
  const subtitle = str(body.subtitle, 120);
  const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 6).map((l) => str(l, 60));
  const big = str(body.bigNumber, 12);
  const imageUrl = typeof body.imageUrl === "string" && /^https:\/\//.test(body.imageUrl) ? body.imageUrl : null;

  const [options, img] = await Promise.all([slideOptions(SW, SH), safeImage(imageUrl)]);
  const up = title.toUpperCase();
  // Condensed letters are about half as wide as tall: fit 960px, 2 lines at most.
  const words = up.split(/\s+/);
  const half = Math.ceil(words.length / 2);
  const twoLines = up.length > 16 && words.length > 1 ? [words.slice(0, half).join(" "), words.slice(half).join(" ")] : [up];
  const longest = Math.max(...twoLines.map((l) => l.length));
  const titleSize = Math.max(80, Math.min(220, Math.floor(960 / (longest * 0.52))));

  return new ImageResponse(
    <Frame code={clip(kicker.toUpperCase(), 34) || "STORY"} w={SW} h={SH}>
      <div style={{ display: "flex", marginTop: 50 }}><Label size={26}>{clip(kicker || "Static-Cuts//", 40)}</Label></div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 50 }}>
        {img
          ? (body.round
            ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img} width={760} height={760} alt="" style={{ objectFit: "cover", borderRadius: 380, border: `2px solid ${LINE}` }} />
            )
            : <SlicedImage src={img} w={960} h={860} at={0.64} shift={24} />)
          : big
            ? <Sliced size={Math.min(520, Math.floor(960 / (big.length * 0.55)))}>{big}</Sliced>
            : <div style={{ display: "flex", height: 200 }} />}
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 54 }}>
        {twoLines.map((l, i) => (
          <div key={i} style={{ display: "flex", marginTop: i ? 10 : 0 }}><Sliced size={titleSize} lines={i === 0}>{l}</Sliced></div>
        ))}
      </div>
      {subtitle && <Mono size={30} color={DIM} style={{ marginTop: 26 }}>{subtitle}</Mono>}
      {lines.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 34 }}>
          {lines.map((l, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", padding: "14px 0", borderTop: `1px solid ${LINE}` }}>
              <Mono size={24} color={DIM} style={{ width: 70 }}>{String(i + 1).padStart(2, "0")}</Mono>
              <div style={{ display: "flex", fontFamily: DISPLAY, fontStyle: "italic", fontWeight: 900, fontSize: 52, lineHeight: 1, textTransform: "uppercase" }}>{clip(l, 26)}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flex: 1 }} />
      <div style={{ display: "flex", marginBottom: 30 }}>
        <div style={{ display: "flex", background: CREAM, color: INK, fontSize: 28, fontWeight: 700, letterSpacing: 3, padding: "14px 22px" }}>FIND IT ON STATIC-CUTS.COM</div>
      </div>
    </Frame>,
    { ...options, headers: { "Cache-Control": "no-store" } },
  );
}
