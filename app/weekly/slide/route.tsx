// This week on Static Cuts as Instagram/TikTok slides (1080×1350, portrait).
//   /weekly/slide?n=1   the week: covers, how many leaked / came out / added
//   /weekly/slide?n=2   leaked this week (top 6)
//   /weekly/slide?n=3   out this week (top 6)
// Add &week=2026-10-26 for another week. Songs are ranked by artists people
// here follow and have in their libraries (rpc_weekly_slides).

import { ImageResponse } from "next/og";
import { supabase } from "@/lib/supabase";
import { Frame, ACCENT, slideSize, niceDate, tidy, clip, safeImage } from "@/lib/slides";

type Song = { id: string; title: string; artist: string; day: string; cover: string | null };
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
const weekday = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase();
const n0 = (x: number) => x.toLocaleString("en-GB");

function SongList({ songs, covers }: { songs: Song[]; covers: (string | null)[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 40 }}>
      {songs.map((s, i) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", padding: "12px 0", borderBottom: "1px solid #262626" }}>
          {covers[i]
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={covers[i]!} width={104} height={104} alt="" style={{ objectFit: "cover", marginRight: 28 }} />
            : <div style={{ width: 104, height: 104, marginRight: 28, background: "#1D1D1D", display: "flex", alignItems: "center", justifyContent: "center", color: "#565656", fontSize: 30 }}>SC//</div>}
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", fontSize: 42, fontWeight: 700 }}>{clip(tidy(s.title), 28)}</div>
            <div style={{ display: "flex", fontSize: 28, color: "#A3A3A3", marginTop: 4 }}>{clip(s.artist, 34)}</div>
          </div>
          <div style={{ display: "flex", fontSize: 24, color: ACCENT, letterSpacing: 3 }}>{s.day ? weekday(s.day) : ""}</div>
        </div>
      ))}
    </div>
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const n = Math.min(3, Math.max(1, Number(url.searchParams.get("n")) || 1));
  const q = url.searchParams.get("week");
  const week = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? monday(new Date(`${q}T12:00:00Z`)) : monday(new Date());
  const { data } = await supabase.rpc("rpc_weekly_slides", { p_week: week });
  const w = data as Week | null;
  const right = `${niceDate(week, false)} – ${niceDate(plusDays(week, 6), false)}`;

  if (!w) {
    return new ImageResponse(
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0A0A0A", color: "#A3A3A3", fontSize: 40 }}>
        Couldn&apos;t load this week
      </div>,
      slideSize,
    );
  }

  if (n === 1) {
    // Four pictures from the week's top songs, leaks first.
    const picks = [...w.leaked, ...w.released].filter((s) => s.cover);
    const seen = new Set<string>();
    const covers: string[] = [];
    for (const s of picks) {
      if (covers.length >= 4 || seen.has(s.cover!)) continue;
      seen.add(s.cover!);
      const img = await safeImage(s.cover);
      if (img) covers.push(img);
    }
    const stats = [
      { n: w.leaked_n, label: "LEAKED" },
      { n: w.released_n, label: "CAME OUT" },
      { n: w.added_total, label: "ADDED TO THE ARCHIVE" },
    ];
    return new ImageResponse(
      <Frame label="THIS WEEK" right={right}>
        <div style={{ display: "flex", flexWrap: "wrap", width: 940, marginTop: 40 }}>
          {covers.map((c, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={c} width={234} height={234} alt="" style={{ objectFit: "cover", marginRight: i < 3 ? 2 : 0 }} />
          ))}
        </div>
        <div style={{ display: "flex", fontSize: 108, fontWeight: 900, lineHeight: 0.95, marginTop: 50, letterSpacing: -3 }}>THIS WEEK IN</div>
        <div style={{ display: "flex", fontSize: 108, fontWeight: 900, lineHeight: 0.95, color: ACCENT, letterSpacing: -3 }}>UNRELEASED</div>
        <div style={{ display: "flex", marginTop: 50 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", marginRight: 60 }}>
              <div style={{ display: "flex", fontSize: 72, fontWeight: 800, color: ACCENT }}>{n0(s.n)}</div>
              <div style={{ display: "flex", fontSize: 22, color: "#A3A3A3", letterSpacing: 3, maxWidth: 260 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 26, color: ACCENT, letterSpacing: 4, marginBottom: 22 }}>SWIPE →</div>
      </Frame>,
      slideSize,
    );
  }

  const leaks = n === 2;
  const songs = (leaks ? w.leaked : w.released).slice(0, 6);
  const total = leaks ? w.leaked_n : w.released_n;
  const covers = await Promise.all(songs.map((s) => safeImage(s.cover)));
  const bg = covers.find(Boolean) ?? null;

  return new ImageResponse(
    <Frame label="THIS WEEK" right={right} bg={bg} fade={0.3}>
      <div style={{ display: "flex", alignItems: "flex-end", marginTop: 50 }}>
        <div style={{ display: "flex", fontSize: 96, fontWeight: 900, lineHeight: 0.95, letterSpacing: -3 }}>{leaks ? "LEAKED" : "OUT NOW"}</div>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 800, color: ACCENT, marginLeft: 24, marginBottom: 8 }}>{n0(total)}</div>
      </div>
      <div style={{ display: "flex", fontSize: 30, color: "#C9C9C9", marginTop: 8 }}>
        {leaks ? "New leaks added to the archive this week" : "Released this week"}
      </div>
      {songs.length > 0
        ? <SongList songs={songs} covers={covers} />
        : <div style={{ display: "flex", fontSize: 48, color: "#A3A3A3", marginTop: 120 }}>{leaks ? "A quiet week for leaks." : "Nothing came out this week."}</div>}
      <div style={{ display: "flex", flex: 1 }} />
      {total > songs.length && (
        <div style={{ display: "flex", marginBottom: 28 }}>
          <div style={{ display: "flex", background: ACCENT, color: "#0A0A0A", fontSize: 30, fontWeight: 800, padding: "14px 26px", letterSpacing: 2 }}>
            + {n0(total - songs.length)} MORE ON THE SITE
          </div>
        </div>
      )}
    </Frame>,
    slideSize,
  );
}
