// Pictures for the daily social posts, in each platform's size.
//   /social/slide?id=<post>&f=ig&n=1      Instagram post (1080×1350), slide n
//   /social/slide?id=<post>&f=story&n=1   Instagram story / TikTok (1080×1920)
//   /social/slide?id=<post>&f=x           X (1600×900, one picture)
// Song of the day and on this day: 1 slide. Album of the week: 2 (X: 1).
// Monthly roundup: 3 (X: 1). The post keeps a snapshot, so a picture never
// changes once made.

import { ImageResponse } from "next/og";
import type { ReactElement, ReactNode } from "react";
import { SOCIAL_SIZE, SOCIAL_SLIDES, type SocialFormat } from "@/lib/social";
import { supabase } from "@/lib/supabase";
import { Frame, Tag, Spacer, ACCENT, RED, GREEN, CYAN, MONO, POSTER, glitch, niceDate, tidy, clip, safeImage, slideOptions } from "@/lib/slides";

type Fmt = SocialFormat;
const SIZE = SOCIAL_SIZE;
const SLIDES = SOCIAL_SLIDES;

type Song = { id: string; title: string; artist: string; status: string; album: string | null; leak_date: string | null;
  release_date: string | null; cover: string | null; photo: string | null; versions: number; collectors: number; years_ago: number | null };
type Aotw = { artist: string; title: string; year: number | null; cover: string | null; unreleased: number; highlights: string[] | null; blurb: string | null; week_start: string };
type ListSong = { id: string; title: string; artist: string; day: string; cover: string | null; photo: string | null };
type Monthly = { month: string; added: number; leaked_n: number; released_n: number; members: number; leaked: ListSong[]; released: ListSong[];
  top_artists: { artist: string; n: number; photo: string | null }[] };
type Post = { id: string; kind: string; post_date: string; ref: Record<string, unknown> };

const n0 = (x: number) => Number(x ?? 0).toLocaleString("en-GB");
const statusColor = (s: string) => (s === "released" ? GREEN : s === "snippet" ? ACCENT : RED);
const statusWord = (s: string) => (s === "released" ? "RELEASED" : s === "snippet" ? "SNIPPET" : s === "leaked" ? "LEAKED" : s.toUpperCase());
// "1 Jan" usually means only the year is known.
const when = (iso: string | null) => (!iso ? null : iso.slice(5) === "01-01" ? iso.slice(0, 4) : niceDate(iso).toUpperCase());
const fit = (t: string, big: number, width: number) => {
  // Anton is narrow: about 0.42em a letter. Keep a title to two or three lines.
  const per = width / (big * 0.42);
  return t.length <= per ? big : t.length <= per * 2 ? Math.round(big * 0.8) : Math.round(big * 0.6);
};

function empty(msg: string, w: number, h: number) {
  return <div style={{ width: w, height: h, display: "flex", alignItems: "center", justifyContent: "center", background: "#070707", color: "#A3A3A3", fontSize: 40 }}>{msg}</div>;
}

function SongSlide({ s, kind, f, w, h, day }: { s: Song; kind: string; f: Fmt; w: number; h: number; day: string }) {
  const otd = kind === "on_this_day";
  const date = s.status === "released" ? s.release_date : s.leak_date;
  const head = otd ? `ON THIS DAY · ${s.years_ago} YEAR${s.years_ago === 1 ? "" : "S"} AGO` : "SONG OF THE DAY";
  const file = otd ? "ON_THIS_DAY" : "SONG_OF_THE_DAY";
  const page = niceDate(day, false).toUpperCase();
  const title = tidy(s.title);
  const body = (width: number, big: number) => (
    <>
      <div style={{ display: "flex", marginBottom: 14 }}><Tag color={otd ? CYAN : ACCENT}>{head}</Tag></div>
      <div style={{ display: "flex", fontFamily: POSTER, fontSize: fit(title, big, width), lineHeight: 0.9, textTransform: "uppercase", ...glitch(6) }}>{clip(title, 60)}</div>
      <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 34, color: ACCENT, marginTop: 14, letterSpacing: 1 }}>{s.artist.toUpperCase()}</div>
      <div style={{ display: "flex", alignItems: "center", marginTop: 18 }}>
        <Tag color={statusColor(s.status)}>{statusWord(s.status)}</Tag>
        {date && <div style={{ display: "flex", marginLeft: 12 }}><Tag color="#EDEDED" solid={false}>{when(date)!}</Tag></div>}
      </div>
      {s.status === "released" && s.album && <div style={{ display: "flex", fontSize: 26, color: "#BDBDBD", marginTop: 14 }}>from {clip(s.album, 48)}</div>}
      {s.status !== "released" && <div style={{ display: "flex", fontSize: 26, color: "#BDBDBD", marginTop: 14 }}>never officially released</div>}
      {s.versions > 0 && <div style={{ display: "flex", fontSize: 24, color: "#8A8A8A", marginTop: 8 }}>+ {s.versions} other version{s.versions === 1 ? "" : "s"} on the site</div>}
    </>
  );
  if (f === "x") {
    return (
      <Frame file={file} page={page} bg={s.cover} bgWidth={h} bgHeight={h} w={w} h={h}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", marginLeft: h - 80 }}>{body(w - h - 40, 110)}</div>
      </Frame>
    );
  }
  return (
    <Frame file={file} page={page} bg={s.cover} bgHeight={w} w={w} h={h}>
      <Spacer />
      {body(w - 128, f === "story" ? 170 : 150)}
      <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 24, color: ACCENT, letterSpacing: 4, marginTop: 22, marginBottom: f === "story" ? 220 : 26 }}>
        EVERY VERSION &gt;&gt; STATIC-CUTS.COM
      </div>
    </Frame>
  );
}

function AotwSlide({ a, n, f, w, h }: { a: Aotw; n: number; f: Fmt; w: number; h: number }) {
  const wc = `W/C ${niceDate(a.week_start, false).toUpperCase()}`;
  const songs = (a.highlights ?? []).map(tidy).filter(Boolean);
  const tail = f === "story" ? 220 : 26;
  if (f === "x") {
    return (
      <Frame file="ALBUM_OF_THE_WEEK" page={wc} bg={a.cover} bgWidth={h} bgHeight={h} w={w} h={h}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", marginLeft: h - 80 }}>
          <div style={{ display: "flex", marginBottom: 14 }}><Tag color={ACCENT}>ALBUM OF THE WEEK</Tag></div>
          <div style={{ display: "flex", fontFamily: POSTER, fontSize: fit(a.title, 110, w - h - 40), lineHeight: 0.9, textTransform: "uppercase", ...glitch(6) }}>{a.title}</div>
          <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 30, color: ACCENT, marginTop: 12 }}>{a.artist.toUpperCase()}{a.year ? ` // ${a.year}` : ""}</div>
          <div style={{ display: "flex", alignItems: "baseline", marginTop: 24 }}>
            <div style={{ display: "flex", fontFamily: POSTER, fontSize: 96, color: RED, ...glitch(4) }}>{n0(a.unreleased)}</div>
            <div style={{ display: "flex", fontSize: 26, color: "#BDBDBD", marginLeft: 16 }}>unreleased songs from the era</div>
          </div>
          {songs.slice(0, 3).map((t, i) => (
            <div key={i} style={{ display: "flex", fontFamily: POSTER, fontSize: 34, color: "#D6D6D6", marginTop: 6, textTransform: "uppercase" }}>{String(i + 1).padStart(2, "0")}  {clip(t, 30)}</div>
          ))}
        </div>
      </Frame>
    );
  }
  if (n === 1) {
    const blurb = a.blurb ?? "";
    return (
      <Frame file="ALBUM_OF_THE_WEEK" page="01/02" bg={a.cover} bgHeight={w} w={w} h={h}>
        <Spacer />
        <div style={{ display: "flex", marginBottom: 14 }}>
          <Tag color={ACCENT}>ALBUM OF THE WEEK</Tag>
          <div style={{ display: "flex", marginLeft: 12 }}><Tag color="#EDEDED" solid={false}>{wc}</Tag></div>
        </div>
        <div style={{ display: "flex", fontFamily: POSTER, fontSize: fit(a.title, 176, w - 128), lineHeight: 0.88, textTransform: "uppercase", ...glitch(6) }}>{a.title}</div>
        <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 32, color: ACCENT, marginTop: 14 }}>{a.artist.toUpperCase()}{a.year ? ` // ${a.year}` : ""}</div>
        {blurb && <div style={{ display: "flex", fontSize: blurb.length > 240 ? 22 : 24, lineHeight: 1.45, marginTop: 18, color: "#D6D6D6" }}>{blurb}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 24, color: ACCENT, letterSpacing: 4, marginTop: 18, marginBottom: tail }}>INSIDE THE VAULT &gt;&gt;</div>
      </Frame>
    );
  }
  const shown = songs.slice(0, f === "story" ? 7 : 5);
  return (
    <Frame file={`VAULT/${a.artist.toUpperCase().replace(/\s+/g, "_")}`} page="02/02" bg={a.cover} fade={0.5} w={w} h={h}>
      <div style={{ display: "flex", marginTop: f === "story" ? 140 : 40 }}><Tag color={RED}>INSIDE THE VAULT</Tag></div>
      <div style={{ display: "flex", fontFamily: POSTER, fontSize: 280, lineHeight: 0.86, color: ACCENT, marginTop: 18, ...glitch(8) }}>{n0(a.unreleased)}</div>
      <div style={{ display: "flex", fontFamily: POSTER, fontSize: 84, lineHeight: 0.95, ...glitch(4) }}>UNRELEASED SONGS</div>
      <div style={{ display: "flex", fontSize: 26, color: "#BDBDBD", marginTop: 10 }}>from the {a.title} era</div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 34 }}>
        {shown.map((s, i) => <Row key={i} i={i} title={s} color={RED} tag="UNRELEASED" />)}
      </div>
      <Spacer />
      <div style={{ display: "flex", marginBottom: tail }}>
        <div style={{ display: "flex", fontWeight: 700, background: ACCENT, color: "#070707", fontSize: 26, padding: "12px 22px", letterSpacing: 2 }}>
          + {n0(Math.max(0, a.unreleased - shown.length))} MORE &gt; STATIC-CUTS.COM
        </div>
      </div>
    </Frame>
  );
}

function Row({ i, title, sub, color, tag, cover }: { i: number; title: string; sub?: string; color: string; tag?: string; cover?: string | null }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 12, background: "rgba(14,14,14,0.88)", border: "1px solid #2A2A2A", borderLeft: `8px solid ${color}`, padding: "12px 20px" }}>
      <div style={{ display: "flex", fontWeight: 700, fontSize: 26, color: "#6A6A6A", width: 58 }}>{String(i + 1).padStart(2, "0")}</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {cover && <img src={cover} width={72} height={72} alt="" style={{ width: 72, height: 72, objectFit: "cover", marginRight: 18 }} />}
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ display: "flex", fontFamily: POSTER, fontSize: 42, textTransform: "uppercase" }}>{clip(tidy(title), 24)}</div>
        {sub && <div style={{ display: "flex", fontSize: 22, color: "#A3A3A3" }}>{clip(sub, 34)}</div>}
      </div>
      {tag && <Tag color={color} size={18}>{tag}</Tag>}
    </div>
  );
}

function Stat({ n, label, color, size = 150 }: { n: number; label: string; color: string; size?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 18 }}>
      <div style={{ display: "flex", fontFamily: POSTER, fontSize: size, lineHeight: 0.9, color, ...glitch(5) }}>{n0(n)}</div>
      <div style={{ display: "flex", fontWeight: 700, fontSize: 26, letterSpacing: 3, color: "#BDBDBD" }}>{label}</div>
    </div>
  );
}

async function withCovers(list: ListSong[], k: number) {
  return Promise.all(list.slice(0, k).map(async (s) => ({ ...s, cover: await safeImage(s.cover ?? s.photo) })));
}

async function MonthlySlide({ m, n, f, w, h }: { m: Monthly; n: number; f: Fmt; w: number; h: number }): Promise<ReactNode> {
  const month = new Date(`${m.month}T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" }).toUpperCase();
  const file = `ROUNDUP/${month.replace(" ", "_")}`;
  const tail = f === "story" ? 220 : 26;
  if (f === "x") {
    const top = await withCovers(m.leaked ?? [], 3);
    return (
      <Frame file={file} page="MONTHLY" w={w} h={h}>
        <div style={{ display: "flex", flex: 1, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", width: 640 }}>
            <div style={{ display: "flex" }}><Tag color={ACCENT}>{month} ROUNDUP</Tag></div>
            <Stat n={m.added} label="SONGS ADDED" color="#EDEDED" size={110} />
            <div style={{ display: "flex" }}>
              <div style={{ display: "flex", marginRight: 48 }}><Stat n={m.leaked_n} label="LEAKS" color={RED} size={96} /></div>
              <Stat n={m.released_n} label="RELEASES" color={GREEN} size={96} />
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", fontWeight: 700, fontSize: 24, letterSpacing: 3, color: "#8A8A8A", marginBottom: 12 }}>BIGGEST LEAKS</div>
            {top.map((s, i) => <Row key={s.id} i={i} title={s.title} sub={s.artist} color={RED} cover={s.cover} />)}
          </div>
        </div>
      </Frame>
    );
  }
  if (n === 1) {
    return (
      <Frame file={file} page="01/03" w={w} h={h}>
        <div style={{ display: "flex", flexDirection: "column", marginTop: f === "story" ? 160 : 40 }}>
          <div style={{ display: "flex" }}><Tag color={ACCENT}>MONTHLY ROUNDUP</Tag></div>
          <div style={{ display: "flex", fontFamily: POSTER, fontSize: 150, lineHeight: 0.9, marginTop: 18, ...glitch(6) }}>{month}</div>
          <Stat n={m.added} label="SONGS ADDED TO THE ARCHIVE" color="#EDEDED" size={f === "story" ? 200 : 170} />
          <div style={{ display: "flex" }}>
            <div style={{ display: "flex", marginRight: 64 }}><Stat n={m.leaked_n} label="LEAKS" color={RED} /></div>
            <Stat n={m.released_n} label="RELEASES" color={GREEN} />
          </div>
          {m.members > 0 && <Stat n={m.members} label="NEW MEMBERS" color={ACCENT} size={110} />}
        </div>
        <Spacer />
        <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 24, color: ACCENT, letterSpacing: 4, marginBottom: tail }}>THE BIGGEST LEAKS &gt;&gt;</div>
      </Frame>
    );
  }
  const leaks = n === 2;
  const list = await withCovers((leaks ? m.leaked : m.released) ?? [], f === "story" ? 6 : 5);
  const color = leaks ? RED : GREEN;
  return (
    <Frame file={file} page={`0${n}/03`} w={w} h={h}>
      <div style={{ display: "flex", flexDirection: "column", marginTop: f === "story" ? 160 : 40 }}>
        <div style={{ display: "flex" }}><Tag color={color}>{leaks ? "LEAKED" : "OUT"} IN {month}</Tag></div>
        <div style={{ display: "flex", fontFamily: POSTER, fontSize: 120, lineHeight: 0.9, marginTop: 18, marginBottom: 28, ...glitch(5) }}>{leaks ? "BIGGEST LEAKS" : "BIGGEST RELEASES"}</div>
        {list.length === 0 && <div style={{ display: "flex", fontSize: 30, color: "#8A8A8A" }}>Nothing this month.</div>}
        {list.map((s, i) => <Row key={s.id} i={i} title={s.title} sub={`${s.artist} · ${niceDate(s.day, false)}`} color={color} cover={s.cover} />)}
      </div>
      <Spacer />
      <div style={{ display: "flex", marginBottom: tail }}>
        <div style={{ display: "flex", fontWeight: 700, background: ACCENT, color: "#070707", fontSize: 26, padding: "12px 22px", letterSpacing: 2 }}>
          {leaks ? `ALL ${n0(m.leaked_n)} LEAKS` : `ALL ${n0(m.released_n)} RELEASES`} &gt; STATIC-CUTS.COM
        </div>
      </div>
    </Frame>
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const f = (["ig", "story", "x"].includes(url.searchParams.get("f") ?? "") ? url.searchParams.get("f") : "ig") as Fmt;
  const [w, h] = SIZE[f];
  const id = url.searchParams.get("id") ?? "";
  const [{ data }, options] = await Promise.all([
    /^[0-9a-f-]{36}$/i.test(id) ? supabase.rpc("rpc_social_post", { p_id: id }) : Promise.resolve({ data: null }),
    slideOptions(w, h),
  ]);
  const post = data as Post | null;
  const opts = { ...options, headers: { "Cache-Control": "public, max-age=86400" } };
  if (!post) return new ImageResponse(empty("No post found", w, h), opts);
  const max = SLIDES[post.kind]?.[f] ?? 1;
  const n = Math.min(max, Math.max(1, Number(url.searchParams.get("n")) || 1));

  if (post.kind === "song_of_day" || post.kind === "on_this_day") {
    const s = post.ref as unknown as Song;
    const song = { ...s, cover: await safeImage(s.cover ?? s.photo) };
    return new ImageResponse(<SongSlide s={song} kind={post.kind} f={f} w={w} h={h} day={post.post_date} />, opts);
  }
  if (post.kind === "album_of_week") {
    const a = post.ref as unknown as Aotw;
    return new ImageResponse(<AotwSlide a={{ ...a, cover: await safeImage(a.cover) }} n={n} f={f} w={w} h={h} />, opts);
  }
  const m = post.ref as unknown as Monthly;
  return new ImageResponse(await MonthlySlide({ m, n, f, w, h }) as ReactElement, opts);
}
