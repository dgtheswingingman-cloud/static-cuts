// This week on STATIC-CUTS// as Instagram/TikTok slides (1080×1350).
//   /weekly/slide?n=1   cover: the week's covers, sliced, and the counts
//   /weekly/slide?n=2   leaked this week (top 5)
//   /weekly/slide?n=3   out this week (top 5)
// Add &week=2026-10-26 for another week. Songs are ranked by artists people
// here follow and have in their libraries (rpc_weekly_slides).

import { ImageResponse } from "next/og";
import { supabase } from "@/lib/supabase";
import { Frame, Sliced, SlicedImage, Mono, Label, Rule, Tag, Spacer, CREAM, DIM, INK, LINE, DISPLAY, MONO, niceDate, weekNo, pad, tidy, clip, safeImage, slideOptions } from "@/lib/slides";

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
  const code = `WEEKLY / ${pad(weekNo(week), 2)} · ${n}/3`;

  if (!w) {
    return new ImageResponse(
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: INK, color: DIM, fontSize: 40 }}>
        Couldn&apos;t load this week
      </div>,
      options,
    );
  }

  if (n === 1) {
    // The week's top cover, cut through; the counts underneath.
    let hero: string | null = null;
    for (const s of [...w.leaked, ...w.released]) {
      hero = (await safeImage(s.cover)) ?? null;
      if (hero) break;
    }
    return new ImageResponse(
      <Frame code={code} footer={range}>
        <div style={{ display: "flex", marginTop: 44 }}><Label>This week</Label></div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 26 }}>
          <Sliced size={170}>THIS WEEK IN</Sliced>
          <div style={{ display: "flex", marginTop: 6 }}><Sliced size={170} at={0.48}>UNRELEASED</Sliced></div>
        </div>
        <div style={{ display: "flex", marginTop: 46, alignItems: "flex-start" }}>
          {hero
            ? <SlicedImage src={hero} w={430} h={430} />
            : <div style={{ display: "flex", width: 430, height: 430, background: "#151515" }} />}
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 44, flex: 1 }}>
            {[
              { n: w.leaked_n, label: "Leaked" },
              { n: w.released_n, label: "Dropped" },
              { n: w.added_total, label: "Added to the archive" },
            ].map((s) => (
              <div key={s.label} style={{ display: "flex", flexDirection: "column", paddingBottom: 18, marginBottom: 18, borderBottom: `1px solid ${LINE}` }}>
                <div style={{ display: "flex", fontFamily: DISPLAY, fontStyle: "italic", fontWeight: 900, fontSize: 92, lineHeight: 1 }}>{n0(s.n)}</div>
                <Mono size={20} color={DIM}>{s.label}</Mono>
              </div>
            ))}
          </div>
        </div>
        <Spacer />
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}><Mono size={20}>Swipe &gt;&gt;</Mono></div>
      </Frame>,
      options,
    );
  }

  const leaks = n === 2;
  const songs = (leaks ? w.leaked : w.released).slice(0, 5);
  const total = leaks ? w.leaked_n : w.released_n;
  // A cover that can't be used falls back to the artist's photo.
  const covers = await Promise.all(songs.map(async (s) => (await safeImage(s.cover)) ?? (await safeImage(s.photo))));

  return new ImageResponse(
    <Frame code={code} footer={range} bg={covers.find(Boolean) ?? null} fade={0.25}>
      <div style={{ display: "flex", marginTop: 44 }}><Label>{leaks ? "New leaks" : "New releases"}</Label></div>
      <div style={{ display: "flex", alignItems: "flex-end", marginTop: 22 }}>
        <Sliced size={200}>{leaks ? "LEAKED" : "DROPPED"}</Sliced>
        <div style={{ display: "flex", marginLeft: 30, marginBottom: 22 }}><Tag size={22}>{n0(total)} this week</Tag></div>
      </div>
      {songs.length === 0 && (
        <div style={{ display: "flex", marginTop: 120 }}><Sliced size={96} color={DIM}>{leaks ? "QUIET WEEK." : "NOTHING DROPPED."}</Sliced></div>
      )}
      <div style={{ display: "flex", flexDirection: "column", marginTop: 40 }}>
        {songs.map((s, i) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", padding: "14px 0", borderTop: `1px solid ${LINE}` }}>
            <Mono size={20} color={DIM} style={{ width: 62 }}>{pad(i + 1, 2)}</Mono>
            {covers[i]
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={covers[i]!} width={112} height={112} alt="" style={{ objectFit: "cover" }} />
              : <div style={{ width: 112, height: 112, background: "#151515", display: "flex", alignItems: "center", justifyContent: "center" }}><Mono size={18} color={DIM}>SC//</Mono></div>}
            <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "0 24px" }}>
              <div style={{ display: "flex", fontFamily: DISPLAY, fontStyle: "italic", fontWeight: 900, fontSize: 54, lineHeight: 1, textTransform: "uppercase" }}>{clip(tidy(s.title), 22)}</div>
              <Mono size={20} color={DIM} style={{ marginTop: 8 }}>{clip(s.artist, 32)}</Mono>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <Tag size={16} solid={leaks}>{leaks ? "Leaked" : "Out now"}</Tag>
              <Mono size={16} color={DIM} style={{ marginTop: 10 }}>{s.day ? dayLabel(s.day) : ""}</Mono>
            </div>
          </div>
        ))}
        {songs.length > 0 && <Rule />}
      </div>
      <Spacer />
      {total > songs.length && (
        <div style={{ display: "flex", marginBottom: 24 }}>
          <div style={{ display: "flex", background: CREAM, color: INK, fontFamily: MONO, fontWeight: 700, fontSize: 22, letterSpacing: 3, padding: "12px 20px" }}>
            + {n0(total - songs.length)} MORE &gt; STATIC-CUTS.COM/WEEKLY
          </div>
        </div>
      )}
    </Frame>,
    options,
  );
}

