// The STATIC-CUTS// look for every image the site makes (slides, link
// previews): black and off-white only, a heavy condensed italic sliced
// horizontally (the "cut"), mono labels with catalogue numbers
// (ARCHIVE / 014, SC-032), thin rules, photocopy grain and TV static.

import type { CSSProperties, ReactNode } from "react";
import { deflateSync } from "node:zlib";

export const W = 1080, H = 1350;
export const INK = "#0A0A0A";
export const CREAM = "#EDE6D8";
export const DIM = "#9C968B";
export const LINE = "#3A3733";
export const DISPLAY = "SC Display";
export const MONO = "SC Mono";
// Kept for older callers.
export const ACCENT = CREAM, RED = CREAM, GREEN = CREAM, CYAN = CREAM, POSTER = DISPLAY;

export const niceDate = (iso: string, year = true) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", year ? { day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "short" });

// ISO week number, for catalogue codes (WEEK / 45).
export function weekNo(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - first.getTime()) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}
export const pad = (n: number, w = 3) => String(n).padStart(w, "0");

// Song titles as trackers write them, tidied: no "*" marks or {notes}.
export const tidy = (t: string) => t.replace(/\s*\{[^}]*\}/g, "").replace(/\s*\*+\s*$/, "").trim();
export const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
export const glitch = (_px = 0): CSSProperties => ({});

// ---- fonts (from Google Fonts, kept for the life of the server) ----------
async function googleFont(spec: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${spec}`, { signal: AbortSignal.timeout(5000) })).text();
    const src = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
    if (!src) return null;
    const res = await fetch(src, { signal: AbortSignal.timeout(5000) });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}
type Font = { name: string; data: ArrayBuffer; weight: 400 | 700 | 900; style: "normal" | "italic" };
let fontsPromise: Promise<Font[]> | null = null;
export function slideFonts(): Promise<Font[]> {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      googleFont("Archivo:ital,wdth,wght@1,62,900").then((d) => d && ({ name: DISPLAY, data: d, weight: 900 as const, style: "italic" as const })),
      googleFont("IBM+Plex+Mono:wght@400").then((d) => d && ({ name: MONO, data: d, weight: 400 as const, style: "normal" as const })),
      googleFont("IBM+Plex+Mono:wght@700").then((d) => d && ({ name: MONO, data: d, weight: 700 as const, style: "normal" as const })),
    ]).then((list) => {
      const ok = list.filter(Boolean) as Font[];
      if (ok.length < 3) fontsPromise = null; // try again next time
      return ok;
    });
  }
  return fontsPromise;
}
export async function slideOptions(w = W, h = H) {
  return { width: w, height: h, fonts: await slideFonts(), headers: { "Cache-Control": "public, max-age=600" } };
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
    const scan = y % 2 === 0;
    for (let x = 0; x < w; x++) {
      const v = rand();
      raw[row + 1 + x * 2] = v > 0.5 ? 255 : 0;
      raw[row + 2 + x * 2] = scan ? 30 : Math.floor(v * 20);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 4; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0)),
  ]);
  staticPng = `data:image/png;base64,${png.toString("base64")}`;
  return staticPng;
}

// The image maker fails the whole picture on one it can't read (dead link,
// WebP). Fetch each first; keep JPEG/PNG (WebP: try the JPEG/PNG twin).
export async function safeImage(url: string | null | undefined): Promise<string | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
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
    } catch { /* next */ }
  }
  return null;
}

// ---- pieces ----------------------------------------------------------------

// Big type, cut through horizontally: the lower half slides left a little,
// with a hairline sticking out of the cut. `at` = where the cut is (0–1).
export function Sliced({ children, size, color = CREAM, at = 0.54, shift, lines = true }: {
  children: string; size: number; color?: string; at?: number; shift?: number; lines?: boolean;
}) {
  const h = Math.round(size * 0.92);
  const cut = Math.round(h * at);
  const dx = shift ?? Math.max(4, Math.round(size * 0.07));
  const text: CSSProperties = { display: "flex", fontFamily: DISPLAY, fontStyle: "italic", fontWeight: 900, fontSize: size, lineHeight: `${h}px`, color, whiteSpace: "nowrap", letterSpacing: -size * 0.01 };
  return (
    <div style={{ display: "flex", position: "relative", height: h }}>
      <div style={{ ...text, opacity: 0 }}>{children}</div>
      <div style={{ position: "absolute", top: 0, left: 0, right: -dx, height: cut, overflow: "hidden", display: "flex" }}>
        <div style={text}>{children}</div>
      </div>
      <div style={{ position: "absolute", top: cut, left: -dx, right: 0, height: h - cut, overflow: "hidden", display: "flex" }}>
        <div style={{ ...text, marginTop: -cut }}>{children}</div>
      </div>
      {lines && <div style={{ position: "absolute", top: cut - 1, left: -size * 0.25, width: size * 1.1, height: Math.max(2, size * 0.02), background: color, display: "flex" }} />}
      {lines && <div style={{ position: "absolute", top: cut, right: -size * 0.4, width: size * 1.3, height: Math.max(1, size * 0.012), background: color, display: "flex" }} />}
    </div>
  );
}

export const Wordmark = ({ size = 34, color = CREAM }: { size?: number; color?: string }) => (
  <Sliced size={size} color={color} lines={size > 60}>STATIC-CUTS//</Sliced>
);

// A photo cut the same way: the lower part slides sideways.
export function SlicedImage({ src, w, h, at = 0.62, shift = 18 }: { src: string; w: number; h: number; at?: number; shift?: number }) {
  const cut = Math.round(h * at);
  return (
    <div style={{ display: "flex", position: "relative", width: w, height: h, overflow: "hidden", background: "#151515" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} width={w} height={h} alt="" style={{ position: "absolute", top: 0, left: 0, width: w, height: h, objectFit: "cover" }} />
      <div style={{ position: "absolute", top: cut, left: 0, width: w, height: h - cut, overflow: "hidden", display: "flex", background: INK }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={w} height={h} alt="" style={{ position: "absolute", top: -cut, left: -shift, width: w, height: h, objectFit: "cover" }} />
      </div>
      <div style={{ position: "absolute", top: cut - 1, left: 0, width: w, height: 3, background: INK, display: "flex" }} />
      <div style={{ position: "absolute", top: cut + 3, left: w * 0.08, width: w * 0.5, height: 1, background: CREAM, opacity: 0.7, display: "flex" }} />
    </div>
  );
}

export const Mono = ({ children, size = 22, color = CREAM, bold = false, style }: { children: ReactNode; size?: number; color?: string; bold?: boolean; style?: CSSProperties }) => (
  <div style={{ display: "flex", fontFamily: MONO, fontWeight: bold ? 700 : 400, fontSize: size, letterSpacing: size * 0.12, color, textTransform: "uppercase", ...style }}>{children}</div>
);

// A small square + label, like the identity sheet's section heads.
export const Label = ({ children, size = 22 }: { children: ReactNode; size?: number }) => (
  <div style={{ display: "flex", alignItems: "center" }}>
    <div style={{ display: "flex", width: size * 0.6, height: size * 0.6, background: CREAM, marginRight: size * 0.7 }} />
    <Mono size={size}>{children}</Mono>
  </div>
);

export const Rule = ({ style }: { style?: CSSProperties }) => <div style={{ display: "flex", height: 1, background: LINE, ...style }} />;

// An outlined status box (no colours: the identity is black and cream).
export function Tag({ children, color = CREAM, solid = false, size = 18 }: { children: ReactNode; color?: string; solid?: boolean; size?: number }) {
  return (
    <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: size, letterSpacing: size * 0.14, padding: "4px 10px", textTransform: "uppercase",
      background: solid ? color : "transparent", color: solid ? INK : color, border: `1.5px solid ${color}` }}>{children}</div>
  );
}

export const Spacer = () => <div style={{ display: "flex", flex: 1 }} />;

// Every slide: optional faded picture behind, static over it, the small
// wordmark + catalogue code on top, a label + rule at the bottom.
export function Frame({ children, code, footer, bg, fade = 0.35, w = W, h = H }: {
  children: ReactNode; code: string; footer?: string; bg?: string | null; fade?: number; w?: number; h?: number;
  // older callers
  file?: string; page?: string; backdrop?: ReactNode; bgHeight?: number;
}) {
  return (
    <div style={{ width: w, height: h, display: "flex", position: "relative", background: INK, color: CREAM, fontFamily: MONO }}>
      {bg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bg} width={w} height={h} alt="" style={{ position: "absolute", top: 0, left: 0, width: w, height: h, objectFit: "cover", opacity: fade }} />
      )}
      {bg && <div style={{ position: "absolute", top: 0, left: 0, width: w, height: h, display: "flex", backgroundImage: `linear-gradient(to bottom, rgba(10,10,10,0.55) 0%, rgba(10,10,10,0.85) 45%, ${INK} 85%)` }} />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={staticOverlay()} width={w} height={h} alt="" style={{ position: "absolute", top: 0, left: 0, width: w, height: h }} />
      <div style={{ position: "absolute", top: 0, left: 0, width: w, height: h, display: "flex", flexDirection: "column", padding: "52px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Wordmark size={40} />
          <Mono size={20} color={DIM}>{code}</Mono>
        </div>
        <Rule style={{ marginTop: 22 }} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>{children}</div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Mono size={18} color={DIM}>{footer ?? "Every song · leak · version"}</Mono>
          <div style={{ display: "flex", flex: 1, height: 1, background: LINE, margin: "0 20px" }} />
          <Mono size={18}>static-cuts.com</Mono>
        </div>
      </div>
    </div>
  );
}
