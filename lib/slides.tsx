// Shared bits for the Instagram/TikTok slides (1080×1350): the frame
// (label, date, Static Cuts footer, optional faded picture behind), tidy song
// titles, and pictures made safe for the image maker.

import type { ReactNode } from "react";

export const W = 1080, H = 1350;
export const ACCENT = "#8B7CF6";
export const slideSize = { width: W, height: H, headers: { "Cache-Control": "public, max-age=600" } };

export const niceDate = (iso: string, year = true) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", year ? { day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "short" });

// Song titles as trackers write them, tidied for a slide: no "*" (tracker
// marks) or {notes}.
export const tidy = (t: string) => t.replace(/\s*\{[^}]*\}/g, "").replace(/\s*\*+\s*$/, "").trim();

export const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

// The image maker fails the whole slide on a picture it can't read (dead
// link, WebP). Fetch each one first; keep JPEG/PNG, drop the rest.
export async function safeImage(url: string | null | undefined): Promise<string | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (type !== "image/jpeg" && type !== "image/png") return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 3_000_000) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export function Frame({ children, label, right, bg, fade = 0.2 }: { children: ReactNode; label: string; right: string; bg?: string | null; fade?: number }) {
  return (
    <div style={{ width: W, height: H, display: "flex", position: "relative", background: "#0A0A0A", color: "#EDEDED", fontFamily: "sans-serif" }}>
      {bg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bg} width={H} height={H} alt="" style={{ position: "absolute", top: 0, left: (W - H) / 2, width: H, height: H, objectFit: "cover", opacity: fade }} />
      )}
      {bg && <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex", backgroundImage: "linear-gradient(to bottom, rgba(10,10,10,0.35) 0%, rgba(10,10,10,0.75) 45%, #0A0A0A 85%)" }} />}
      <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex", flexDirection: "column", padding: 70 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 30, letterSpacing: 6 }}>
          <div style={{ display: "flex", color: ACCENT, fontWeight: 700 }}>{label}</div>
          <div style={{ display: "flex", color: "#A3A3A3", letterSpacing: 1, fontSize: 26 }}>{right}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>{children}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "2px solid #3A3A3A", paddingTop: 28 }}>
          <div style={{ display: "flex", fontSize: 36, fontWeight: 700 }}>STATIC CUTS//</div>
          <div style={{ display: "flex", fontSize: 28, color: "#A3A3A3" }}>static-cuts.com</div>
        </div>
      </div>
    </div>
  );
}
