// Album of the week as Instagram/TikTok slides (1080×1350, portrait).
//   /album-of-the-week/slide?n=1   the album: cover, title, artist, blurb
//   /album-of-the-week/slide?n=2   from the era: some of its unreleased songs
// Add &week=2026-11-09 for a given week (once that week has started).

import type { ReactNode } from "react";
import { ImageResponse } from "next/og";
import { supabase } from "@/lib/supabase";

const W = 1080, H = 1350;
const ACCENT = "#8B7CF6";

type Aotw = { week_start: string; artist: string; title: string; year: number | null; cover: string | null; unreleased: number; highlights: string[] | null; blurb: string | null };

const nice = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

function Frame({ children, week }: { children: ReactNode; week: string }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0A0A0A", color: "#EDEDED", padding: 70, fontFamily: "sans-serif" }}>
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
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const n = url.searchParams.get("n") === "2" ? 2 : 1;
  const week = url.searchParams.get("week");
  const { data } = await supabase.rpc("rpc_album_of_week", week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? { p_week: week } : {});
  const a = data as Aotw | null;
  const size = { width: W, height: H, headers: { "Cache-Control": "public, max-age=600" } };

  if (!a) {
    return new ImageResponse(
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0A0A0A", color: "#A3A3A3", fontSize: 40 }}>
        No album of the week picked yet
      </div>,
      size,
    );
  }

  const titleSize = a.title.length > 28 ? 64 : a.title.length > 16 ? 84 : 104;

  if (n === 1) {
    return new ImageResponse(
      <Frame week={a.week_start}>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 44 }}>
          {a.cover
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={a.cover} width={640} height={640} style={{ objectFit: "cover", border: "2px solid #3A3A3A" }} alt="" />
            : <div style={{ width: 640, height: 640, background: "#1D1D1D", display: "flex" }} />}
        </div>
        <div style={{ display: "flex", fontSize: titleSize, fontWeight: 800, lineHeight: 1.0, marginTop: 40, textTransform: "uppercase" }}>{a.title}</div>
        <div style={{ display: "flex", fontSize: 38, color: "#A3A3A3", marginTop: 14 }}>
          {a.artist}{a.year ? ` · ${a.year}` : ""}
        </div>
        {a.blurb && (
          <div style={{ display: "flex", fontSize: 29, lineHeight: 1.4, marginTop: 24, color: "#EDEDED" }}>
            {a.blurb.length > 230 ? `${a.blurb.slice(0, 227).trimEnd()}…` : a.blurb}
          </div>
        )}
      </Frame>,
      size,
    );
  }

  const songs = (a.highlights ?? []).slice(0, 6);
  return new ImageResponse(
    <Frame week={a.week_start}>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 60 }}>
        <div style={{ display: "flex", fontSize: 44, color: "#A3A3A3" }}>From the {a.title} era</div>
        <div style={{ display: "flex", alignItems: "baseline", marginTop: 20 }}>
          <div style={{ display: "flex", fontSize: 180, fontWeight: 800, color: ACCENT, lineHeight: 1 }}>{a.unreleased.toLocaleString("en-GB")}</div>
          <div style={{ display: "flex", fontSize: 44, marginLeft: 24, letterSpacing: 4 }}>UNRELEASED</div>
        </div>
        <div style={{ display: "flex", fontSize: 32, color: "#A3A3A3", marginTop: 10 }}>songs from {a.artist} in the archive, including:</div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 40 }}>
          {songs.map((s, i) => (
            <div key={i} style={{ display: "flex", fontSize: 46, fontWeight: 700, padding: "14px 0", borderBottom: "1px solid #262626" }}>
              <span style={{ color: ACCENT, marginRight: 24, width: 50 }}>{i + 1}</span>
              <span>{s.length > 30 ? `${s.slice(0, 29)}…` : s}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flex: 1 }} />
      <div style={{ display: "flex", fontSize: 32, color: "#A3A3A3", marginBottom: 30 }}>Every song, leak and version. Search {a.artist} on the site.</div>
    </Frame>,
    size,
  );
}
