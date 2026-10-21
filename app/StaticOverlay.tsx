"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "./ThemeProvider";

// Old-TV texture, drawn at low resolution and scaled up (pixelated). It used
// to flicker constantly, which people found tiring, so now:
//   - normally: one still frame of faint grain (with the TV lines from
//     .scanlines on top) -- nothing moves
//   - when a page opens: half a second of moving static, then it settles
// Reduced motion: just the still grain. Hidden in light theme -- this texture
// is part of the underground/dark identity, not a universal skin.
const RES_W = 180, RES_H = 120;
const BURST_MS = 500;
const STILL_OPACITY = "0.06";
const BURST_OPACITY = "0.16";

export default function StaticOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
  const path = usePathname();

  function frame(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    const imageData = ctx.createImageData(RES_W, RES_H);
    const buf = imageData.data;
    for (let i = 0; i < buf.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v;
      buf[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  // A short burst of moving static each time a page opens, then still grain.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = RES_W;
    canvas.height = RES_H;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      frame(canvas);
      canvas.style.opacity = STILL_OPACITY;
      return;
    }
    canvas.style.transition = "none";
    canvas.style.opacity = BURST_OPACITY;
    frame(canvas);
    const interval = setInterval(() => frame(canvas), 70);
    const settle = setTimeout(() => {
      clearInterval(interval);
      frame(canvas);
      canvas.style.transition = "opacity 0.4s ease";
      canvas.style.opacity = STILL_OPACITY;
    }, BURST_MS);
    return () => { clearInterval(interval); clearTimeout(settle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, theme]);

  if (theme === "light") return null;

  return <canvas id="staticCanvas" ref={canvasRef} />;
}
