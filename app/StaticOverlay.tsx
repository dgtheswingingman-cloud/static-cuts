"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "./ThemeProvider";

// Real per-frame TV static, drawn at low resolution and scaled up (pixelated)
// for a chunky, authentic old-TV texture. Verified working in the standalone
// mockup -- ported as-is. Hidden in light theme -- this texture is part of
// the underground/dark identity specifically, not a universal skin.
export default function StaticOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const RES_W = 180, RES_H = 120;
    canvas.width = RES_W;
    canvas.height = RES_H;

    function drawStaticFrame() {
      const imageData = ctx!.createImageData(RES_W, RES_H);
      const buf = imageData.data;
      for (let i = 0; i < buf.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        buf[i] = v; buf[i + 1] = v; buf[i + 2] = v;
        buf[i + 3] = 255;
      }
      ctx!.putImageData(imageData, 0, 0);
    }

    drawStaticFrame();
    let interval: ReturnType<typeof setInterval> | null = null;
    if (!reduceMotion) {
      interval = setInterval(drawStaticFrame, 80);
    } else {
      canvas.style.opacity = "0.08";
    }
    return () => { if (interval) clearInterval(interval); };
  }, []);

  if (theme === "light") return null;

  return <canvas id="staticCanvas" ref={canvasRef} />;
}
