// This week on Static-Cuts as Instagram/TikTok slides (1080×1350, portrait).
//   /weekly/slide?n=1   poster: the week's covers, counts
//   /weekly/slide?n=2   leaked this week (top 5), tracker style
//   /weekly/slide?n=3   out this week (top 5), tracker style
// Add &week=2026-10-26 for another week. Songs are ranked by artists people
// here follow and have in their libraries (rpc_weekly_slides).

import { ImageResponse } from "next/og";
import { supabase } from "@/lib/supabase";
import { Frame, Tag, Spacer, ACCENT, RED, GREEN, MONO, POSTER, W, glitch, niceDate, tidy, clip, safeImage, slideOptions } from "@/lib/slides";

type Song = { id: string; title: string; artist: string; day: string; cover: string | null; photo: string | null };
type Week = { week_start: string; leaked_n: number; released_n: number; added_total: number; leaked: Song[]; released: Song[] };

const monday = (d: Date) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase().replace(",", "");
const n0 = (x: number) => x.toLocaleString("en-GB");

export async function GET(req: Request) {
  const url = new URL(req.url);
  const n = Math.min(3, Math.max(1, Number(url.searchParams.get("n")) || 1));
  const q = url.searchParams.get("week");
  const week = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? monday(new Date(`${q}T12:00:00Z`)) : monday(new Date());
  const [{ data }, options] = await Promise.all([supabase.rpc("rpc_weekly_slides", { p_week: week }), slideOptions()]);
  const w = data as Week | null;
  const range = `${niceDate(week, false)} – ${niceDate(plusDays(week, 6), false)}`.toUpperCase();
  const page = `0${n}/03`;

  if (!w) {
    return new ImageResponse(
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#070707", color: "#A3A3A3", fontSize: 40 }}>
        Couldn&apos;t load this week
      </div>,
      options,
    );
  }

  if (n === 1) {
    // Poster: the week's top covers fill the top, huge type over the fade.
    const seen = new Set<string>();
    const covers: string[] = [];
    for (const s of [...w.leaked, ...w.released]) {
      if (covers.length >= 4 || !s.cover || seen.has(s.cover)) continue;
      seen.add(s.cover);
      const img = await safeImage(s.cover);
      if (img) covers.push(img);
    }
    const tile = W / 2;
    const backdrop = (
      <div style={{ display: "flex", flexWrap: "wrap", width: W }}>
        {covers.map((c, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={c} width={covers.length === 1 ? W : tile} height={covers.length === 1 ? W : tile} alt="" style={{ objectFit: "cover" }} />
        ))}
      </div>
    );
    return new ImageResponse(
      <Frame file="WEEKLY_ROUNDUP" page={page} backdrop={covers.length ? backdrop : undefined} bgHeight={W}>
        <Spacer />
        <div style={{ display: "flex", marginBottom: 14 }}><Tag color={ACCENT}>{range}</Tag></div>
        <div style={{ display: "flex", fontFamily: POSTER, fontSize: 196, lineHeight: 0.86, ...glitch(6) }}>THIS WEEK IN</div>
        <div style={{ display: "flex", fontFamily: POSTER, fontSize: 196, lineHeight: 0.86, color: ACCENT, ...glitch(6) }}>UNRELEASED</div>
        <div style={{ display: "flex", marginTop: 34, marginBottom: 34 }}>
          {[
            { n: w.leaked_n, label: "LEAKED", c: RED },
            { n: w.released_n, label: "DROPPED", c: GREEN },
            { n: w.added_total, label: "ADDED", c: ACCENT },
          ].map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", marginRight: 22, border: `2px solid ${s.c}`, background: "rgba(7,7,7,0.8)" }}>
              <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 34, padding: "8px 14px" }}>{n0(s.n)}</div>
              <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 22, background: s.c, color: "#070707", padding: "14px 12px", letterSpacing: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 24, color: ACCENT, letterSpacing: 4, marginBottom: 26 }}>SWIPE &gt;&gt;</div>
      </Frame>,
      options,
    );
  }

  const leaks = n === 2;
  const songs = (leaks ? w.leaked : w.released).slice(0, 5);
  const total = leaks ? w.leaked_n : w.released_n;
  // A cover the image maker can't read falls back to the artist's photo.
  const covers = await Promise.all(songs.map(async (s) => (await safeImage(s.cover)) ?? (await safeImage(s.photo))));
  const color = leaks ? RED : GREEN;

  return new ImageResponse(
    <Frame file={leaks ? "NEW_LEAKS" : "NEW_DROPS"} page={page} bg={covers.find(Boolean) ?? null} fade={0.55}>
      <div style={{ display: "flex", alignItems: "flex-end", marginTop: 40 }}>
        <div style={{ display: "flex", fontFamily: POSTER, fontSize: 170, lineHeight: 0.86, color, ...glitch(5) }}>{leaks ? "LEAKED" : "DROPPED"}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", marginTop: 16 }}>
        <Tag color={color}>{n0(total)} {leaks ? "NEW LEAKS" : "RELEASES"}</Tag>
        <div style={{ display: "flex", fontSize: 24, color: "#BDBDBD", marginLeft: 16, letterSpacing: 2 }}>{range}</div>
      </div>

      {songs.length === 0 && (
        <div style={{ display: "flex", fontFamily: POSTER, fontSize: 80, color: "#5A5A5A", marginTop: 120 }}>{leaks ? "QUIET WEEK." : "NOTHING DROPPED."}</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", marginTop: 36 }}>
        {songs.map((s, i) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", marginBottom: 14, background: "rgba(14,14,14,0.88)", border: "1px solid #2A2A2A", borderLeft: `8px solid ${color}` }}>
            {covers[i]
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={covers[i]!} width={132} height={132} alt="" style={{ objectFit: "cover" }} />
              : <div style={{ width: 132, height: 132, background: "#1A1A1A", display: "flex", alignItems: "center", justifyContent: "center", color: "#4A4A4A", fontFamily: POSTER, fontSize: 36 }}>SC//</div>}
            <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "0 22px" }}>
              <div style={{ display: "flex", fontFamily: POSTER, fontSize: 50, lineHeight: 1.05, textTransform: "uppercase" }}>{clip(tidy(s.title), 24)}</div>
              <div style={{ display: "flex", fontSize: 24, color: "#A8A8A8", marginTop: 4 }}>{clip(s.artist, 30)}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", paddingRight: 20 }}>
              <Tag color={color} size={18}>{leaks ? "LEAKED" : "OUT NOW"}</Tag>
              <div style={{ display: "flex", fontSize: 18, color: "#8A8A8A", marginTop: 10, letterSpacing: 1 }}>{s.day ? dayLabel(s.day) : ""}</div>
            </div>
          </div>
        ))}
      </div>
      <Spacer />
      {total > songs.length && (
        <div style={{ display: "flex", marginBottom: 26 }}>
          <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, background: color, color: "#070707", fontSize: 26, padding: "12px 22px", letterSpacing: 2 }}>
            + {n0(total - songs.length)} MORE &gt; STATIC-CUTS.COM/WEEKLY
          </div>
        </div>
      )}
    </Frame>,
    options,
  );
}
