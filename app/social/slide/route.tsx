// Pictures for the daily social posts, in each platform's size.
//   /social/slide?id=<post>&f=ig&n=1      Instagram post (1080×1350), slide n
//   /social/slide?id=<post>&f=tt&n=1      TikTok (1080×1920)
//   /social/slide?id=<post>&f=x           X (1600×900, one picture)
// Song of the day and on this day (3 songs): 1 slide. Album of the week: 2 (X: 1).
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
  top_artists: { artist: string; n: number; photo: string | null }[]; contributors?: Contributor[] };
type Contributor = { user_id: string; name: string; avatar: string | null; n: number };
type Post = { id: string; kind: string; post_date: string; ref: Record<string, unknown> };

const n0 = (x: number) => Number(x ?? 0).toLocaleString("en-GB");
const statusColor = (s: string) => (s === "released" ? GREEN : s === "snippet" ? ACCENT : RED);
const statusWord = (s: string) => (s === "released" ? "RELEASED" : s === "snippet" ? "SNIPPET" : s === "leaked" ? "LEAKED" : s.toUpperCase());
// "1 Jan" usually means only the year is known.
const when = (iso: string | null) => (!iso ? null : iso.slice(5) === "01-01" ? iso.slice(0, 4) : niceDate(iso).toUpperCase());
// Anton capitals are about half as wide as they are tall. The biggest size
// (up to big) that keeps a title to one line, else to two.
const titleSize = (t: string, big: number, width: number) => {
  const len = Math.max(1, t.length);
  const one = width / (len * 0.5);
  if (one >= big * 0.75) return Math.round(Math.min(big, one));
  return Math.round(Math.min(big * 0.8, (width * 2) / (len * 0.5)));
};


function empty(msg: string, w: number, h: number) {
  return <div style={{ width: w, height: h, display: "flex", alignItems: "center", justifyContent: "center", background: "#070707", color: "#A3A3A3", fontSize: 40 }}>{msg}</div>;
}

// Song of the day: the cover faded into the static behind everything, and
// the cover again, clear, with a border (on X, on the left with the words beside it).
function SongSlide({ s, f, w, h, day }: { s: Song; f: Fmt; w: number; h: number; day: string }) {
  const date = s.status === "released" ? s.release_date : s.leak_date;
  const title = clip(tidy(s.title), 40);
  const page = niceDate(day, false).toUpperCase();
  const sub = s.status === "released" ? (s.album ? clip(s.album.toUpperCase(), 34) : "") : "NEVER OFFICIALLY RELEASED";
  const cover = (size: number) => (
    s.cover
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={s.cover} width={size} height={size} alt="" style={{ width: size, height: size, objectFit: "cover", border: "3px solid #EDEDED", boxShadow: "0 18px 60px rgba(0,0,0,0.7)" }} />
      : <div style={{ display: "flex", width: size, height: size, background: "#151515", border: "3px solid #EDEDED" }} />
  );
  const words = (width: number, big: number) => (
    <div style={{ display: "flex", flexDirection: "column", width }}>
      <div style={{ display: "flex", marginBottom: 14 }}>
        <Tag color={ACCENT}>SONG OF THE DAY</Tag>
        <div style={{ display: "flex", marginLeft: 12 }}><Tag color="#EDEDED" solid={false}>{page}</Tag></div>
      </div>
      <div style={{ display: "flex", fontFamily: POSTER, fontSize: titleSize(title, big, width), lineHeight: 0.95, textTransform: "uppercase", ...glitch(2) }}>{title}</div>
      <div style={{ display: "flex", fontWeight: 700, fontSize: 30, color: ACCENT, marginTop: 12, letterSpacing: 1 }}>
        {clip(s.artist.toUpperCase(), 30)}{date ? ` // ${when(date)}` : ""}
      </div>
      <div style={{ display: "flex", alignItems: "center", marginTop: 14 }}>
        <Tag color={statusColor(s.status)}>{statusWord(s.status)}</Tag>
        {sub && <div style={{ display: "flex", fontSize: 22, color: "#D6D6D6", marginLeft: 14 }}>{sub}</div>}
        {s.versions > 0 && <div style={{ display: "flex", fontSize: 22, color: "#A3A3A3", marginLeft: 14 }}>{`+ ${s.versions} VERSION${s.versions === 1 ? "" : "S"}`}</div>}
      </div>
    </div>
  );
  if (f === "x") {
    return (
      <Frame file="SONG_OF_THE_DAY" page={page} bg={s.cover} fade={0.55} w={w} h={h}>
        <div style={{ display: "flex", flex: 1, alignItems: "center" }}>
          {cover(620)}
          <div style={{ display: "flex", marginLeft: 52 }}>{words(w - 128 - 620 - 52, 104)}</div>
        </div>
      </Frame>
    );
  }
  const tt = f === "tt";
  return (
    <Frame file="SONG_OF_THE_DAY" page={page} bg={s.cover} fade={0.55} w={w} h={h}>
      <div style={{ display: "flex", justifyContent: "center", marginTop: tt ? 100 : 24 }}>{cover(tt ? 840 : 600)}</div>
      <div style={{ display: "flex", marginTop: tt ? 56 : 32 }}>{words(w - 128, tt ? 120 : 96)}</div>
      <Spacer />
    </Frame>
  );
}

// On this day: three songs, each a row with its cover (on X, three columns).
function OtdSlide({ songs, total, f, w, h, day }: { songs: Song[]; total: number; f: Fmt; w: number; h: number; day: string }) {
  const date = new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long" }).toUpperCase();
  const more = Math.max(0, total - songs.length);
  const year = (s: Song) => (s.status === "released" ? s.release_date : s.leak_date)?.slice(0, 4) ?? "";
  const art = (s: Song, size: number) => (
    s.cover
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={s.cover} width={size} height={size} alt="" style={{ width: size, height: size, objectFit: "cover", border: "2px solid #2A2A2A" }} />
      : <div style={{ display: "flex", width: size, height: size, background: "#151515" }} />
  );
  const facts = (s: Song, width: number, big: number) => (
    <div style={{ display: "flex", flexDirection: "column", width }}>
      <div style={{ display: "flex" }}><Tag color={CYAN} size={20}>{`${s.years_ago} YEAR${s.years_ago === 1 ? "" : "S"} AGO`}</Tag></div>
      <div style={{ display: "flex", fontFamily: POSTER, fontSize: titleSize(clip(tidy(s.title), 34), big, width), lineHeight: 1, textTransform: "uppercase", marginTop: 12 }}>{clip(tidy(s.title), 34)}</div>
      <div style={{ display: "flex", fontWeight: 700, fontSize: 26, color: ACCENT, marginTop: 8 }}>{clip(s.artist.toUpperCase(), 30)}</div>
      <div style={{ display: "flex", fontSize: 22, color: "#A3A3A3", marginTop: 8 }}>{s.status === "released" ? "released" : "leaked"} {year(s)}</div>
    </div>
  );
  const head = (dateSize: number) => (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex" }}><Tag color={CYAN}>ON THIS DAY</Tag></div>
      <div style={{ display: "flex", fontFamily: POSTER, fontSize: dateSize, lineHeight: 1, marginTop: 14, ...glitch(2) }}>{date}</div>
    </div>
  );
  const foot = more > 0 && (
    <div style={{ display: "flex", fontWeight: 700, background: ACCENT, color: "#070707", fontSize: 24, padding: "12px 20px", letterSpacing: 2 }}>
      + {n0(more)} MORE ON THIS DAY &gt; STATIC-CUTS.COM
    </div>
  );
  if (f === "x") {
    const col = Math.floor((w - 128 - 2 * 36) / 3);
    return (
      <Frame file="ON_THIS_DAY" page={date} w={w} h={h}>
        <div style={{ display: "flex", marginTop: 8 }}>{head(72)}</div>
        <div style={{ display: "flex", marginTop: 18 }}>
          {songs.map((s, i) => (
            <div key={s.id} style={{ display: "flex", flexDirection: "column", width: col, marginLeft: i ? 36 : 0, padding: 16,
              background: "rgba(14,14,14,0.9)", border: "2px solid #3A3A3A", borderTop: `8px solid ${i % 2 ? ACCENT : CYAN}` }}>
              {art(s, 260)}
              <div style={{ display: "flex", marginTop: 14 }}>{facts(s, col - 36, 42)}</div>
            </div>
          ))}
        </div>
        <Spacer />
      </Frame>
    );
  }
  const tt = f === "tt";
  const size = tt ? 320 : 230;
  return (
    <Frame file="ON_THIS_DAY" page={date} w={w} h={h}>
      <div style={{ display: "flex", marginTop: tt ? 90 : 24 }}>{head(tt ? 150 : 120)}</div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: tt ? 56 : 34 }}>
        {songs.map((s, i) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", marginTop: i ? (tt ? 32 : 20) : 0, padding: tt ? 20 : 16,
            background: "rgba(14,14,14,0.9)", border: "2px solid #3A3A3A", borderLeft: `8px solid ${i % 2 ? ACCENT : CYAN}` }}>
            {art(s, size)}
            <div style={{ display: "flex", marginLeft: 26 }}>{facts(s, w - 128 - size - 26 - (tt ? 40 : 32) - 10, tt ? 64 : 56)}</div>
          </div>
        ))}
      </div>
      <Spacer />
      {foot && <div style={{ display: "flex", marginBottom: tt ? 200 : 22 }}>{foot}</div>}
    </Frame>
  );
}

function AotwSlide({ a, n, f, w, h }: { a: Aotw; n: number; f: Fmt; w: number; h: number }) {
  const wc = `W/C ${niceDate(a.week_start, false).toUpperCase()}`;
  const songs = (a.highlights ?? []).map(tidy).filter(Boolean);
  const tail = f === "tt" ? 220 : 26;
  if (f === "x") {
    const tw = w - 128 - 660 - 48;
    return (
      <Frame file="ALBUM_OF_THE_WEEK" page={wc} bg={a.cover} fade={0.16} w={w} h={h}>
        <div style={{ display: "flex", flex: 1, alignItems: "center" }}>
          {a.cover
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={a.cover} width={660} height={660} alt="" style={{ width: 660, height: 660, objectFit: "cover", border: "2px solid #2A2A2A" }} />
            : <div style={{ display: "flex", width: 660, height: 660, background: "#151515" }} />}
          <div style={{ display: "flex", flexDirection: "column", width: tw, marginLeft: 48 }}>
            <div style={{ display: "flex" }}><Tag color={ACCENT}>ALBUM OF THE WEEK</Tag></div>
            <div style={{ display: "flex", fontFamily: POSTER, fontSize: titleSize(clip(a.title, 40), 96, tw), lineHeight: 1, textTransform: "uppercase", marginTop: 16, ...glitch(2) }}>{clip(a.title, 40)}</div>
            <div style={{ display: "flex", fontWeight: 700, fontSize: 30, color: ACCENT, marginTop: 12 }}>{clip(a.artist.toUpperCase(), 30)}{a.year ? ` // ${a.year}` : ""}</div>
            <div style={{ display: "flex", alignItems: "baseline", marginTop: 24 }}>
              <div style={{ display: "flex", fontFamily: POSTER, fontSize: 88, lineHeight: 1, color: RED }}>{n0(a.unreleased)}</div>
              <div style={{ display: "flex", fontSize: 24, color: "#BDBDBD", marginLeft: 14 }}>unreleased from the era</div>
            </div>
            {songs.slice(0, 3).map((t, i) => (
              <div key={i} style={{ display: "flex", fontFamily: POSTER, fontSize: 32, lineHeight: 1.15, color: "#D6D6D6", marginTop: 6, textTransform: "uppercase" }}>{`${String(i + 1).padStart(2, "0")}  ${clip(t, 28)}`}</div>
            ))}
          </div>
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
        <div style={{ display: "flex", fontFamily: POSTER, fontSize: titleSize(a.title, 176, w - 128), lineHeight: 0.92, textTransform: "uppercase", ...glitch(3) }}>{a.title}</div>
        <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 32, color: ACCENT, marginTop: 14 }}>{a.artist.toUpperCase()}{a.year ? ` // ${a.year}` : ""}</div>
        {blurb && <div style={{ display: "flex", fontSize: blurb.length > 240 ? 22 : 24, lineHeight: 1.45, marginTop: 18, color: "#D6D6D6" }}>{blurb}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 24, color: ACCENT, letterSpacing: 4, marginTop: 18, marginBottom: tail }}>INSIDE THE VAULT &gt;&gt;</div>
      </Frame>
    );
  }
  const shown = songs.slice(0, f === "tt" ? 7 : 5);
  return (
    <Frame file={`VAULT/${a.artist.toUpperCase().replace(/\s+/g, "_")}`} page="02/02" bg={a.cover} fade={0.5} w={w} h={h}>
      <div style={{ display: "flex", marginTop: f === "tt" ? 140 : 40 }}><Tag color={RED}>INSIDE THE VAULT</Tag></div>
      <div style={{ display: "flex", fontFamily: POSTER, fontSize: 280, lineHeight: 0.86, color: ACCENT, marginTop: 18, ...glitch(4) }}>{n0(a.unreleased)}</div>
      <div style={{ display: "flex", fontFamily: POSTER, fontSize: 84, lineHeight: 0.95, ...glitch(2) }}>UNRELEASED SONGS</div>
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
      <div style={{ display: "flex", fontFamily: POSTER, fontSize: size, lineHeight: 0.9, color, ...glitch(2) }}>{n0(n)}</div>
      <div style={{ display: "flex", fontWeight: 700, fontSize: 26, letterSpacing: 3, color: "#BDBDBD" }}>{label}</div>
    </div>
  );
}

async function withCovers(list: ListSong[], k: number) {
  return Promise.all(list.slice(0, k).map(async (s) => ({ ...s, cover: await safeImage(s.cover ?? s.photo) })));
}

// The month's top contributors, with their pictures: a thank-you and a nudge.
function Contributors({ people, big }: { people: Contributor[]; big: boolean }) {
  if (people.length === 0) return null;
  const size = big ? 104 : 64;
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: big ? 36 : 22 }}>
      <div style={{ display: "flex" }}><Tag color={CYAN} size={big ? 22 : 18}>TOP CONTRIBUTORS</Tag></div>
      <div style={{ display: "flex", marginTop: big ? 18 : 12 }}>
        {people.map((p, i) => (
          <div key={p.user_id} style={{ display: "flex", alignItems: "center", marginRight: big ? 34 : 22 }}>
            <div style={{ display: "flex", position: "relative" }}>
              {p.avatar
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={p.avatar} width={size} height={size} alt="" style={{ width: size, height: size, borderRadius: size / 2, objectFit: "cover", border: `3px solid ${i === 0 ? ACCENT : "#3A3A3A"}` }} />
                : <div style={{ display: "flex", width: size, height: size, borderRadius: size / 2, background: "#1A1A1A", border: "3px solid #3A3A3A" }} />}
              <div style={{ display: "flex", position: "absolute", top: -6, left: -6, background: i === 0 ? ACCENT : "#EDEDED", color: "#070707",
                fontFamily: POSTER, fontSize: big ? 24 : 18, padding: "0 7px" }}>#{i + 1}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", marginLeft: 14 }}>
              <div style={{ display: "flex", fontWeight: 700, fontSize: big ? 26 : 20 }}>{clip(p.name, 16)}</div>
              <div style={{ display: "flex", fontSize: big ? 20 : 16, color: "#A3A3A3" }}>{n0(p.n)} added</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
async function withAvatars(people: Contributor[] | undefined) {
  return Promise.all((people ?? []).slice(0, 3).map(async (p) => ({ ...p, avatar: await safeImage(p.avatar) })));
}

async function MonthlySlide({ m, n, f, w, h }: { m: Monthly; n: number; f: Fmt; w: number; h: number }): Promise<ReactNode> {
  const month = new Date(`${m.month}T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" }).toUpperCase();
  const file = `ROUNDUP/${month.replace(" ", "_")}`;
  const tail = f === "tt" ? 220 : 26;
  const people = n === 1 ? await withAvatars(m.contributors) : [];
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
            <Contributors people={people} big={false} />
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
        <div style={{ display: "flex", flexDirection: "column", marginTop: f === "tt" ? 160 : 40 }}>
          <div style={{ display: "flex" }}><Tag color={ACCENT}>MONTHLY ROUNDUP</Tag></div>
          <div style={{ display: "flex", fontFamily: POSTER, fontSize: 150, lineHeight: 0.9, marginTop: 18, ...glitch(3) }}>{month}</div>
          <Stat n={m.added} label="SONGS ADDED TO THE ARCHIVE" color="#EDEDED" size={f === "tt" ? 200 : 170} />
          <div style={{ display: "flex" }}>
            <div style={{ display: "flex", marginRight: 64 }}><Stat n={m.leaked_n} label="LEAKS" color={RED} /></div>
            <Stat n={m.released_n} label="RELEASES" color={GREEN} />
          </div>
          {m.members > 0 && <Stat n={m.members} label="NEW MEMBERS" color={ACCENT} size={110} />}
          <Contributors people={people} big />
        </div>
        <Spacer />
        <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 24, color: ACCENT, letterSpacing: 4, marginBottom: tail }}>THE BIGGEST LEAKS &gt;&gt;</div>
      </Frame>
    );
  }
  const leaks = n === 2;
  const list = await withCovers((leaks ? m.leaked : m.released) ?? [], f === "tt" ? 6 : 5);
  const color = leaks ? RED : GREEN;
  return (
    <Frame file={file} page={`0${n}/03`} w={w} h={h}>
      <div style={{ display: "flex", flexDirection: "column", marginTop: f === "tt" ? 160 : 40 }}>
        <div style={{ display: "flex" }}><Tag color={color}>{leaks ? "LEAKED" : "OUT"} IN {month}</Tag></div>
        <div style={{ display: "flex", fontFamily: POSTER, fontSize: 120, lineHeight: 0.9, marginTop: 18, marginBottom: 28, ...glitch(2) }}>{leaks ? "BIGGEST LEAKS" : "BIGGEST RELEASES"}</div>
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
  const f = (["ig", "tt", "x"].includes(url.searchParams.get("f") ?? "") ? url.searchParams.get("f") : "ig") as Fmt;
  const [w, h] = SIZE[f];
  const id = url.searchParams.get("id") ?? "";
  const [{ data }, options] = await Promise.all([
    /^[0-9a-f-]{36}$/i.test(id) ? supabase.rpc("rpc_social_post", { p_id: id }) : Promise.resolve({ data: null }),
    slideOptions(w, h),
  ]);
  const post = data as Post | null;
  const opts = { ...options, headers: { "Cache-Control": "public, max-age=3600" } };
  if (!post) return new ImageResponse(empty("No post found", w, h), opts);
  const max = SLIDES[post.kind]?.[f] ?? 1;
  const n = Math.min(max, Math.max(1, Number(url.searchParams.get("n")) || 1));

  if (post.kind === "song_of_day") {
    const s = post.ref as unknown as Song;
    const song = { ...s, cover: await safeImage(s.cover ?? s.photo) };
    return new ImageResponse(<SongSlide s={song} f={f} w={w} h={h} day={post.post_date} />, opts);
  }
  if (post.kind === "on_this_day") {
    const r = post.ref as { songs?: Song[]; total?: number };
    const songs = await Promise.all((r.songs ?? []).slice(0, 3).map(async (s) => ({ ...s, cover: await safeImage(s.cover ?? s.photo) })));
    return new ImageResponse(<OtdSlide songs={songs} total={r.total ?? songs.length} f={f} w={w} h={h} day={post.post_date} />, opts);
  }
  if (post.kind === "album_of_week") {
    const a = post.ref as unknown as Aotw;
    return new ImageResponse(<AotwSlide a={{ ...a, cover: await safeImage(a.cover) }} n={n} f={f} w={w} h={h} />, opts);
  }
  const m = post.ref as unknown as Monthly;
  return new ImageResponse(await MonthlySlide({ m, n, f, w, h }) as ReactElement, opts);
}
