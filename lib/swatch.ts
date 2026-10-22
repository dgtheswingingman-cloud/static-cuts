// The main colour of a picture (an artist photo or a cover), for theming
// artist pages and eras. Read in the browser through /api/img (same site,
// so the canvas can see the pixels) and remembered in this browser.

import { local } from "./safeStorage";

export type Rgb = [number, number, number];

function toHsl([r, g, b]: Rgb): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

// Most common lively colour: pixels bucketed by hue, weighted by how
// saturated they are. Falls back to the plain average for grey pictures.
function pick(data: Uint8ClampedArray): Rgb | null {
  const buckets = new Map<number, { w: number; r: number; g: number; b: number }>();
  let ar = 0, ag = 0, ab = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const px: Rgb = [data[i], data[i + 1], data[i + 2]];
    ar += px[0]; ag += px[1]; ab += px[2]; n++;
    const [h, s, l] = toHsl(px);
    if (s < 0.22 || l < 0.12 || l > 0.9) continue;
    const key = Math.round(h / 20);
    const b = buckets.get(key) ?? { w: 0, r: 0, g: 0, b: 0 };
    const w = s * (1 - Math.abs(l - 0.5));
    b.w += w; b.r += px[0] * w; b.g += px[1] * w; b.b += px[2] * w;
    buckets.set(key, b);
  }
  if (!n) return null;
  const best = [...buckets.values()].sort((a, b) => b.w - a.w)[0];
  if (best && best.w > n * 0.02) return [best.r / best.w, best.g / best.w, best.b / best.w].map(Math.round) as Rgb;
  return [ar / n, ag / n, ab / n].map(Math.round) as Rgb;
}

export async function swatch(url: string | null | undefined): Promise<Rgb | null> {
  if (!url || typeof window === "undefined") return null;
  const key = `swatch:${url}`;
  const saved = local.get(key);
  if (saved) { try { return JSON.parse(saved) as Rgb; } catch { /* read again */ } }
  const rgb = await new Promise<Rgb | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 40; c.height = 40;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 40, 40);
        resolve(pick(ctx.getImageData(0, 0, 40, 40).data));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = `/api/img?u=${encodeURIComponent(url)}`;
  });
  if (rgb) local.set(key, JSON.stringify(rgb));
  return rgb;
}

// The colour made readable as an accent: same hue, bright enough on the
// dark theme (dark enough on the light one).
export function accentCss(rgb: Rgb, light = false): string {
  const [h, s] = toHsl(rgb);
  const sat = Math.min(0.85, Math.max(0.35, s));
  return light ? `hsl(${Math.round(h)} ${Math.round(sat * 100)}% 34%)` : `hsl(${Math.round(h)} ${Math.round(sat * 100)}% 66%)`;
}

// A deep, dark version for backgrounds behind white text.
export function deepCss(rgb: Rgb, alpha = 1): string {
  const [h, s] = toHsl(rgb);
  return `hsl(${Math.round(h)} ${Math.round(Math.min(0.7, s) * 100)}% 16% / ${alpha})`;
}
