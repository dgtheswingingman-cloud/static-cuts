// Album of the week as Instagram/TikTok slides (1080×1350, portrait).
//   /album-of-the-week/slide?n=1   the album: cover, title, artist, blurb
//   /album-of-the-week/slide?n=2   inside the vault: the era's unreleased count and a few titles
// Add &week=2026-11-09 for a given week (once that week has started).

import type { ReactNode } from "react";
import { ImageResponse } from "next/og";
import { supabase } from "@/lib/supabase";
import { safeImage } from "@/lib/slides";

const W = 1080, H = 1350;
const ACCENT = "#8B7CF6";

type Aotw = { week_start: string; artist: string; title: string; year: number | null; cover: string | null; unreleased: number; highlights: string[] | null; blurb: string | null };

const nice = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

// Song titles as trackers write them, tidied for a slide: no "*" (tracker
// marks) or {notes}.
const tidy = (t: string) => t.replace(/\s*\{[^}]*\}/g, "").replace(/\s*\*+\s*$/, "").trim();

function Frame({ children, week, bg, fade = 0.2 }: { children: ReactNode; week: string; bg?: string | null; fade?: number }) {
  return (
    <div style={{ width: W, height: H, display: "flex", position: "relative", background: "#0A0A0A", color: "#EDEDED", fontFamily: "sans-serif" }}>
      {bg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bg} width={H} height={H} alt="" style={{ position: "absolute", top: 0, left: (W - H) / 2, width: H, height: H, objectFit: "cover", opacity: fade }} />
      )}
      {bg && <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex", backgroundImage: "linear-gradient(to bottom, rgba(10,10,10,0.35) 0%, rgba(10,10,10,0.75) 45%, #0A0A0A 85%)" }} />}
      <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex", flexDirection: "column", padding: 70 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 30, letterSpacing: 6 }}>
          <div style={{ display: "flex", color: ACCENT, fontWeight: 700 }}>ALBUM OF THE WEEK</div>
          <div style={{ display: "flex", color: "#A3A3A3", letterSpacing: 1, fontSize: 26 }}>w/c {nice(week)}</div>
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const n = url.searchParams.get("n") === "2" ? 2 : 1;
  const week = url.searchParams.get("week");
  const { data } = await supabase.rpc("rpc_album_of_week", week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? { p_week: week } : {});
  const found = data as Aotw | null;
  // Pictures checked first (a dead link or WebP would break the slide).
  const a = found ? { ...found, cover: await safeImage(found.cover) } : null;
  const size = { width: W, height: H, headers: { "Cache-Control": "public, max-age=600" } };

  if (!a) {
    return new ImageResponse(
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0A0A0A", color: "#A3A3A3", fontSize: 40 }}>
        No album of the week picked yet
      </div>,
      size,
    );
  }

  const titleSize = a.title.length > 28 ? 60 : a.title.length > 16 ? 78 : 100;

  if (n === 1) {
    // The whole blurb fits: the cover shrinks a little for a long one.
    const blurb = a.blurb ?? "";
    const coverPx = blurb.length > 200 ? 540 : 620;
    const blurbSize = blurb.length > 260 ? 26 : 29;
    return new ImageResponse(
      <Frame week={a.week_start}>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 36 }}>
          {a.cover
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={a.cover} width={coverPx} height={coverPx} style={{ objectFit: "cover", border: "2px solid #3A3A3A" }} alt="" />
            : <div style={{ width: coverPx, height: coverPx, background: "#1D1D1D", display: "flex" }} />}
        </div>
        <div style={{ display: "flex", fontSize: titleSize, fontWeight: 800, lineHeight: 1.0, marginTop: 34, textTransform: "uppercase" }}>{a.title}</div>
        <div style={{ display: "flex", fontSize: 36, color: "#A3A3A3", marginTop: 12 }}>
          {a.artist}{a.year ? ` · ${a.year}` : ""}
        </div>
        {blurb && <div style={{ display: "flex", fontSize: blurbSize, lineHeight: 1.38, marginTop: 20 }}>{blurb}</div>}
        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 26, color: ACCENT, letterSpacing: 4, marginBottom: 22 }}>INSIDE THE VAULT →</div>
      </Frame>,
      size,
    );
  }

  const songs = (a.highlights ?? []).map(tidy).filter(Boolean).slice(0, 5);
  return new ImageResponse(
    <Frame week={a.week_start} bg={a.cover} fade={0.45}>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 70 }}>
        <div style={{ display: "flex", fontSize: 34, letterSpacing: 8 }}>INSIDE THE VAULT</div>
        <div style={{ display: "flex", fontSize: 250, fontWeight: 900, color: ACCENT, lineHeight: 0.9, letterSpacing: -8, marginTop: 10 }}>{a.unreleased.toLocaleString("en-GB")}</div>
        <div style={{ display: "flex", fontSize: 50, fontWeight: 800, marginTop: 18, lineHeight: 1.1 }}>UNRELEASED SONGS</div>
        <div style={{ display: "flex", fontSize: 34, color: "#C9C9C9", marginTop: 10 }}>from the {a.title} era</div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 54 }}>
          {songs.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", padding: "16px 22px", marginBottom: 12, background: "rgba(29,29,29,0.85)", borderLeft: `8px solid ${ACCENT}` }}>
              <div style={{ display: "flex", fontSize: 34, fontWeight: 800, color: ACCENT, width: 80 }}>{String(i + 1).padStart(2, "0")}</div>
              <div style={{ display: "flex", fontSize: 42, fontWeight: 700 }}>{s.length > 26 ? `${s.slice(0, 25)}…` : s}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flex: 1 }} />
      <div style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
        <div style={{ display: "flex", background: ACCENT, color: "#0A0A0A", fontSize: 30, fontWeight: 800, padding: "14px 26px", letterSpacing: 2 }}>
          + {Math.max(0, a.unreleased - songs.length).toLocaleString("en-GB")} MORE ON THE SITE
        </div>
      </div>
    </Frame>,
    size,
  );
}
