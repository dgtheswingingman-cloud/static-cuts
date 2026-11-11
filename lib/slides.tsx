// Shared look for the Instagram/TikTok slides (1080×1350): poster type
// (Anton) with an RGB-split glitch, tracker-style labels (Space Mono), TV
// static and scanlines over everything, and pictures made safe for the image
// maker.

import type { CSSProperties, ReactNode } from "react";
import { deflateSync } from "node:zlib";

export const W = 1080, H = 1350;
export const ACCENT = "#8B7CF6";
export const RED = "#FF3355";
export const GREEN = "#2BD67B";
export const CYAN = "#22D3EE";
export const MONO = "Space Mono";
export const POSTER = "Anton";

export const niceDate = (iso: string, year = true) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", year ? { day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "short" });

// Song titles as trackers write them, tidied for a slide: no "*" (tracker
// marks) or {notes}.
export const tidy = (t: string) => t.replace(/\s*\{[^}]*\}/g, "").replace(/\s*\*+\s*$/, "").trim();
export const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

// The RGB-split "glitch" on big type.
export const glitch = (px = 5): CSSProperties => ({ textShadow: `-${px}px 0 ${RED}, ${px}px 0 ${CYAN}` });

// ---- fonts (from Google Fonts, kept for the life of the server) ----------
async function googleFont(family: string, weight: number): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}`, { signal: AbortSignal.timeout(5000) })).text();
    const src = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
    if (!src) return null;
    const res = await fetch(src, { signal: AbortSignal.timeout(5000) });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}
type Font = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };
let fontsPromise: Promise<Font[]> | null = null;
export function slideFonts(): Promise<Font[]> {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      googleFont(POSTER, 400).then((d) => d && ({ name: POSTER, data: d, weight: 400 as const, style: "normal" as const })),
      googleFont(MONO, 400).then((d) => d && ({ name: MONO, data: d, weight: 400 as const, style: "normal" as const })),
      googleFont(MONO, 700).then((d) => d && ({ name: MONO, data: d, weight: 700 as const, style: "normal" as const })),
    ]).then((list) => {
      const ok = list.filter(Boolean) as Font[];
      if (ok.length < 3) fontsPromise = null; // try again next time
      return ok;
    });
  }
  return fontsPromise;
}
export async function slideOptions(width = W, height = H) {
  return { width, height, fonts: await slideFonts(), headers: { "Cache-Control": "public, max-age=600" } };
}

// ---- TV static + scanlines (made once, as a see-through PNG) --------------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
let staticPng: string | null = null;
export function staticOverlay(): string {
  if (staticPng) return staticPng;
  const w = 540, h = 675; // shown at 2×
  const raw = Buffer.alloc((w * 2 + 1) * h);
  let seed = 1234567;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 2 + 1);
    raw[row] = 0;
    const scan = y % 2 === 0; // every other line darker = scanlines
    for (let x = 0; x < w; x++) {
      const v = rand();
      raw[row + 1 + x * 2] = v > 0.5 ? 255 : 0;                                  // grey: white or black speck
      raw[row + 2 + x * 2] = scan ? 38 : Math.floor(v * 16);                     // alpha
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 4; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit grey + alpha
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0)),
  ]);
  staticPng = `data:image/png;base64,${png.toString("base64")}`;
  return staticPng;
}

// The image maker fails the whole slide on a picture it can't read (dead
// link, WebP). Fetch each one first; keep JPEG/PNG, drop the rest.
export async function safeImage(url: string | null | undefined): Promise<string | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  // Genius serves some art as WebP; the same picture is usually there as JPEG/PNG too.
  const tries = /\.webp(\?|$)/i.test(url) ? [url.replace(/\.webp/i, ".jpg"), url.replace(/\.webp/i, ".png")] : [url];
  for (const u of tries) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      if (type !== "image/jpeg" && type !== "image/png") continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 3_000_000) continue;
      return `data:${type};base64,${buf.toString("base64")}`;
    } catch {
      /* next */
    }
  }
  return null;
}

// A status chip like the trackers use.
export function Tag({ children, color, solid = true, size = 22 }: { children: ReactNode; color: string; solid?: boolean; size?: number }) {
  return (
    <div style={{
      display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: size, letterSpacing: 2, padding: "4px 12px",
      background: solid ? color : "transparent", color: solid ? "#0A0A0A" : color, border: `2px solid ${color}`,
    }}>{children}</div>
  );
}

// Every slide: optional picture behind (full-bleed or faded), static on top,
// tracker-style top bar and footer with the slide number.
// w/h default to the 1080×1350 post; stories are 1080×1920, X 1600×900.
export function Frame({ children, file, page, bg, backdrop, bgHeight, fade = 1, w = W, h = H, bgWidth }: {
  children: ReactNode; file: string; page: string; bg?: string | null; backdrop?: ReactNode; bgHeight?: number; fade?: number;
  w?: number; h?: number; bgWidth?: number;
}) {
  const W = w, H = h;
  bgHeight = bgHeight ?? H;
  const BW = bgWidth ?? W;
  const behind = !!(bg || backdrop);
  return (
    <div style={{ width: W, height: H, display: "flex", position: "relative", background: "#070707", color: "#EDEDED", fontFamily: MONO }}>
      {bg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bg} width={BW} height={bgHeight} alt="" style={{ position: "absolute", top: 0, left: 0, width: BW, height: bgHeight, objectFit: "cover", opacity: fade }} />
      )}
      {backdrop && <div style={{ position: "absolute", top: 0, left: 0, width: BW, height: bgHeight, display: "flex", opacity: fade }}>{backdrop}</div>}
      {behind && BW < W && (
        // picture on the left (X): fade it into the dark on the right
        <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex",
          backgroundImage: `linear-gradient(to right, rgba(7,7,7,0.1) 0%, rgba(7,7,7,0.2) ${Math.round(BW / W * 60)}%, #070707 ${Math.round(BW / W * 100)}%)` }} />
      )}
      {behind && BW >= W && (
        <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex",
          backgroundImage: bgHeight < H
            ? `linear-gradient(to bottom, rgba(7,7,7,0.55) 0%, rgba(7,7,7,0) 14%, rgba(7,7,7,0) ${Math.round(bgHeight / H * 55)}%, #070707 ${Math.round(bgHeight / H * 100)}%)`
            : "linear-gradient(to bottom, rgba(7,7,7,0.6) 0%, rgba(7,7,7,0.82) 40%, #070707 80%)" }} />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={staticOverlay()} width={W} height={H} alt="" style={{ position: "absolute", top: 0, left: 0, width: W, height: H }} />
      <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex", flexDirection: "column", padding: "56px 64px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 22, letterSpacing: 2 }}>
          <div style={{ display: "flex", alignItems: "center", background: "rgba(7,7,7,0.75)", padding: "6px 12px", border: "1px solid #3A3A3A" }}>
            <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, background: RED, marginRight: 12 }} />
            <span style={{ fontWeight: 700 }}>STATIC CUTS//</span>
            <span style={{ color: "#8A8A8A", marginLeft: 12 }}>{file}</span>
          </div>
          <div style={{ display: "flex", background: "rgba(7,7,7,0.75)", padding: "6px 12px", border: "1px solid #3A3A3A", color: "#BDBDBD" }}>{page}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>{children}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 22, color: "#8A8A8A", letterSpacing: 2 }}>
          <span>EVERY SONG · LEAK · VERSION</span>
          <span style={{ color: "#EDEDED", fontWeight: 700 }}>STATIC-CUTS.COM</span>
        </div>
      </div>
    </div>
  );
}

export const Spacer = () => <div style={{ display: "flex", flex: 1 }} />;
