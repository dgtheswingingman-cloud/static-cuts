"use client";

// Posts & picks (admin): a month calendar of the site's posts and picks.
// Every day: song of the day (pick one from a shortlist, any day ahead, or
// leave it to the site) and on this day (three songs, made on the day).
// Mondays: album of the week (pick from the shortlist, edit the blurb). The
// 1st: last month's roundup. Pick a day to see its posts: pictures for
// Instagram, TikTok and X to download, captions to copy, and a tick once posted.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { SOCIAL_SLIDES, type SocialFormat } from "@/lib/social";
import { thumb } from "@/lib/thumb";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";
import { eraHref } from "../../components/AlbumOfWeek";
import { ModPage, ModButton, ModTag, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";
import "../../styles/social.css";

type Platform = "instagram" | "tiktok" | "x";
type Post = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  id: string; post_date: string; kind: string; track_id: string | null; ref: Record<string, any>;
  captions: Partial<Record<Platform, string>>; posted: Partial<Record<Platform, string>>;
};
type Aotw = { week_start: string; title: string; artist: string; cover: string | null };
type Cal = { today: string; posts: Post[]; aotw: Aotw[] };
type Song = { id: string; title: string; artist: string; artist_id: string; status: string; album: string | null; cover: string | null; photo: string | null;
  leak_date: string | null; release_date: string | null; listeners: number | null; collectors: number; versions: number };
type Cand = { week_start: string; artist_id: string; artist: string; album_key: string; title: string; year: number | null; cover: string | null;
  era_key: string | null; unreleased: number; highlights: string[]; reasons: string | null; blurb: string | null };
type AotwData = { week_start: string; pick: (Cand & { picked_at: string }) | null; candidates: Cand[] };

const KIND: Record<string, string> = { song_of_day: "Song of the day", on_this_day: "On this day", album_of_week: "Album of the week", monthly: "Monthly roundup" };
const ORDER = ["monthly", "album_of_week", "song_of_day", "on_this_day"];
const PLATFORMS: { key: Platform; label: string; f: SocialFormat; limit: number }[] = [
  { key: "instagram", label: "Instagram", f: "ig", limit: 2200 },
  { key: "tiktok", label: "TikTok", f: "tt", limit: 2200 },
  { key: "x", label: "X", f: "x", limit: 280 },
];

const iso = (d: Date) => d.toLocaleDateString("en-CA");
const at = (s: string) => new Date(`${s}T12:00:00`);
const addDays = (s: string, n: number) => { const d = at(s); d.setDate(d.getDate() + n); return iso(d); };
const monthOf = (s: string) => `${s.slice(0, 7)}-01`;
const addMonths = (m: string, n: number) => { const d = at(m); d.setMonth(d.getMonth() + n, 1); return iso(d); };
const isMonday = (s: string) => at(s).getDay() === 1;
const niceDay = (s: string) => at(s).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const allPosted = (p: Post) => PLATFORMS.every((x) => p.posted[x.key]);

function title(p: Post) {
  const r = p.ref;
  if (p.kind === "monthly") return at(r.month).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  if (p.kind === "on_this_day") return (r.songs ?? []).map((s: Song) => s.title).join(" · ");
  return `${r.artist} – ${r.title}`;
}
const fileName = (p: Post, f: SocialFormat, n: number) =>
  `static-cuts-${p.post_date}-${p.kind.replace(/_/g, "-")}-${f === "ig" ? "instagram" : f === "tt" ? "tiktok" : "x"}${(SOCIAL_SLIDES[p.kind]?.[f] ?? 1) > 1 ? `-${n}` : ""}.png`;

// One post: pictures, caption and the posted tick for each platform.
function PostCard({ post, onChange, onError }: { post: Post; onChange: (p: Post) => void; onError: (m: string) => void }) {
  const [plat, setPlat] = useState<Platform>("instagram");
  const [text, setText] = useState(post.captions[plat] ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setText(post.captions[plat] ?? ""); setCopied(false); }, [plat, post]);
  const p = PLATFORMS.find((x) => x.key === plat)!;
  const dirty = text !== (post.captions[plat] ?? "");
  const n = SOCIAL_SLIDES[post.kind]?.[p.f] ?? 1;
  const v = encodeURIComponent(String(post.track_id ?? "") + (post.ref.title ?? ""));

  async function save() {
    setBusy("save");
    const { error } = await supabase.rpc("admin_social_caption", { p_id: post.id, p_platform: plat, p_text: text });
    setBusy(null);
    if (error) return onError(error.message);
    onChange({ ...post, captions: { ...post.captions, [plat]: text } });
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { onError("Couldn't copy. Select the text and copy it instead."); }
  }
  async function mark(on: boolean) {
    setBusy("mark");
    const { error } = await supabase.rpc("admin_social_mark", { p_id: post.id, p_platform: plat, p_posted: on });
    setBusy(null);
    if (error) return onError(error.message);
    const posted = { ...post.posted };
    if (on) posted[plat] = new Date().toISOString(); else delete posted[plat];
    onChange({ ...post, posted });
  }

  return (
    <div className="soc-post">
      <div className="soc-head">
        <ModTag>{KIND[post.kind] ?? post.kind}</ModTag>
        <span className="soc-title">{post.kind === "song_of_day" ? <Link href={`/song/${post.ref.id}`}>{title(post)}</Link> : title(post)}</span>
      </div>
      <div className="soc-plats">
        {PLATFORMS.map((x) => (
          <button key={x.key} className={`soc-plat${x.key === plat ? " on" : ""}`} onClick={() => setPlat(x.key)}>
            {x.label}{post.posted[x.key] && <span className="done">✓ posted</span>}
          </button>
        ))}
      </div>
      <div className="soc-body">
        <div className="soc-pics">
          {Array.from({ length: n }, (_, i) => {
            const src = `/social/slide?id=${post.id}&f=${p.f}&n=${i + 1}&v=${v}`;
            return (
              <div key={`${p.f}-${i}`} className={`soc-pic ${p.f}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`${p.label} picture ${i + 1}`} loading="lazy" />
                <a className="text-link" href={src} download={fileName(post, p.f, i + 1)}>download{n > 1 ? ` ${i + 1}` : ""}</a>
              </div>
            );
          })}
        </div>
        <div className="soc-cap">
          <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label={`${p.label} caption`} />
          <div className="soc-cap-bar">
            <span className={`soc-count${text.length > p.limit ? " over" : ""}`}>{text.length} / {p.limit}</span>
            {dirty && <ModButton busy={busy === "save"} onClick={save}>save</ModButton>}
            <ModButton onClick={copy}>{copied ? "copied" : "copy caption"}</ModButton>
            {post.posted[plat]
              ? <ModButton busy={busy === "mark"} onClick={() => mark(false)}>not posted</ModButton>
              : <ModButton kind="approve" busy={busy === "mark"} onClick={() => mark(true)}>mark posted</ModButton>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Song of the day shortlist for a day.
function SongPicker({ day, current, locked, onPicked, onError }: { day: string; current: string | null; locked: boolean; onPicked: () => void; onError: (m: string) => void }) {
  const [list, setList] = useState<Song[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    setList(null);
    supabase.rpc("admin_social_song_shortlist", { p_day: day }).then(({ data, error }) => {
      if (error) { onError(error.message); setList([]); return; }
      setList((data as Song[]) ?? []);
    });
  }, [day, onError]);
  async function pick(s: Song) {
    setBusy(s.id);
    const { error } = await supabase.rpc("admin_social_set_song", { p_day: day, p_track: s.id });
    setBusy(null);
    if (error) return onError(error.message);
    onPicked();
  }
  if (!list) return <ModLoading what="the shortlist" />;
  if (list.length === 0) return <ModEmpty>No songs to suggest.</ModEmpty>;
  return (
    <div className="soc-short">
      {list.map((s) => {
        const date = s.status === "released" ? s.release_date : s.leak_date;
        const img = s.cover ?? s.photo;
        return (
          <div key={s.id} className={`soc-opt${s.id === current ? " on" : ""}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {img ? <img src={thumb(img, 250)} alt="" /> : <span className="soc-opt-blank" />}
            <div className="soc-opt-body">
              <Link href={`/song/${s.id}`} className="soc-opt-title">{s.title}</Link>
              <span className="soc-opt-artist">{s.artist}</span>
              <span className="soc-opt-meta">
                <span className={`feature-tag st st-${s.status}`}>{s.status}</span>
                {date && <span>{date.slice(5) === "01-01" ? date.slice(0, 4) : date}</span>}
                {s.listeners ? <span>{s.listeners.toLocaleString("en-GB")} listeners</span> : null}
              </span>
            </div>
            {s.id === current
              ? <ModTag kind="good">picked</ModTag>
              : <ModButton kind="approve" busy={busy === s.id} disabled={locked} onClick={() => pick(s)}>pick</ModButton>}
          </div>
        );
      })}
    </div>
  );
}

// Album of the week shortlist for a Monday (with the blurbs).
function AotwPicker({ week, onPicked, onError }: { week: string; onPicked: () => void; onError: (m: string) => void }) {
  const [data, setData] = useState<AotwData | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  async function load(rebuild = false) {
    setData(null);
    const { data: d, error } = await supabase.rpc("admin_aotw_candidates", { p_week: week, p_rebuild: rebuild });
    if (error) { onError(error.message); return; }
    setData(d as AotwData);
    setEdits({});
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [week]);
  async function pick(c: Cand) {
    const k = `${c.artist_id}|${c.album_key}`;
    setBusy(k);
    const { error } = await supabase.rpc("admin_aotw_pick", { p_week: week, p_artist: c.artist_id, p_album_key: c.album_key, p_blurb: edits[k] ?? c.blurb });
    if (!error) await supabase.rpc("admin_social_refresh_aotw", { p_week: week });
    setBusy(null);
    if (error) return onError(error.message);
    await load();
    onPicked();
  }
  if (!data) return <ModLoading what="the shortlist" />;
  const pickedKey = data.pick ? `${data.pick.artist_id}|${data.pick.album_key}` : null;
  const waiting = data.candidates.filter((c) => !c.blurb).length;
  return (
    <div>
      <div className="soc-cap-bar" style={{ marginBottom: 10 }}>
        <span className="soc-count">{waiting > 0 ? `Claude is writing ${waiting} blurb${waiting === 1 ? "" : "s"} (within 10 minutes).` : "The shortlist is made every Thursday for the next week."}</span>
        <ModButton confirm="Make a new shortlist for this week? Unpicked albums are swapped out." onClick={() => load(true)}>new shortlist</ModButton>
      </div>
      {data.candidates.length === 0 && <ModEmpty>No shortlist for this week yet.</ModEmpty>}
      <div className="soc-short">
        {data.candidates.map((c) => {
          const k = `${c.artist_id}|${c.album_key}`;
          const picked = k === pickedKey;
          return (
            <div key={k} className={`soc-opt soc-opt-album${picked ? " on" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.cover ? <img src={thumb(c.cover, 250)} alt="" /> : <span className="soc-opt-blank" />}
              <div className="soc-opt-body">
                <Link href={eraHref(c)} className="soc-opt-title">{c.title}</Link>
                <span className="soc-opt-artist">{c.artist}{c.year ? ` · ${c.year}` : ""}</span>
                <span className="soc-opt-meta">{c.unreleased > 0 && <span>{c.unreleased.toLocaleString("en-GB")} unreleased</span>}{c.reasons && <span>{c.reasons}</span>}</span>
                <textarea value={edits[k] ?? (picked ? data.pick?.blurb ?? c.blurb ?? "" : c.blurb ?? "")} placeholder="No blurb yet. Write your own if you like."
                  onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} aria-label={`Blurb for ${c.title}`} />
              </div>
              <ModButton kind="approve" busy={busy === k} onClick={() => pick(c)}>{picked ? "save blurb" : "pick"}</ModButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Calendar() {
  const { loading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const params = useSearchParams();
  const todayIso = iso(new Date());
  const [day, setDay] = useState(params.get("day") ?? todayIso);
  const [month, setMonth] = useState(monthOf(params.get("day") ?? todayIso));
  const [cal, setCal] = useState<Cal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<"song" | "album" | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(m = month) {
    const { data, error: err } = await supabase.rpc("admin_social_calendar", { p_month: m });
    if (err) { setError(err.message); setCal({ today: todayIso, posts: [], aotw: [] }); return; }
    setCal(data as Cal);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isAdmin) load(month); }, [isAdmin, month]);
  useEffect(() => { setPicking(null); }, [day]);

  if (!isAdmin) return <NoAccess loading={authLoading} who="admin" />;

  const today = cal?.today ?? todayIso;
  const byDay = new Map<string, Post[]>();
  for (const p of cal?.posts ?? []) byDay.set(p.post_date, [...(byDay.get(p.post_date) ?? []), p]);
  const aotwBy = new Map((cal?.aotw ?? []).map((a) => [a.week_start, a]));
  // Monday before the 1st to the Sunday after the end.
  const first = at(month);
  const start = addDays(month, -((first.getDay() + 6) % 7));
  const end = addDays(addMonths(month, 1), -1);
  const cells: string[] = [];
  for (let d = start; d <= end || at(d).getDay() !== 1; d = addDays(d, 1)) cells.push(d);

  const posts = (byDay.get(day) ?? []).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const song = posts.find((p) => p.kind === "song_of_day");
  const songLocked = !!song && Object.keys(song.posted).length > 0;
  const weekPick = aotwBy.get(day);
  const update = (p: Post) => setCal((c) => (c ? { ...c, posts: c.posts.map((x) => (x.id === p.id ? p : x)) } : c));
  async function makeNow() {
    setBusy(true);
    const { error: err } = await supabase.rpc("admin_social_make", { p_day: day });
    setBusy(false);
    if (err) setError(err.message); else load();
  }
  const missing = day <= today && (!posts.some((p) => p.kind === "song_of_day") || !posts.some((p) => p.kind === "on_this_day")
    || (at(day).getDate() === 1 && !posts.some((p) => p.kind === "monthly")) || (isMonday(day) && weekPick && !posts.some((p) => p.kind === "album_of_week")));

  return (
    <ModPage title="Posts & picks" intro="The month's posts and picks. Song of the day and on this day every day, album of the week on Mondays, last month's roundup on the 1st. Pick a day to choose its song, pick the album, and get the posts.">
      {error && <ModNotice kind="error" onClose={() => setError(null)}>{error}</ModNotice>}
      <div className="soc-month">
        <button className="tab" onClick={() => setMonth(addMonths(month, -1))}>← {at(addMonths(month, -1)).toLocaleDateString("en-GB", { month: "short" })}</button>
        <span className="soc-month-name">{first.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
        <button className="tab" onClick={() => setMonth(addMonths(month, 1))}>{at(addMonths(month, 1)).toLocaleDateString("en-GB", { month: "short" })} →</button>
        {month !== monthOf(today) && <button className="tab" onClick={() => { setMonth(monthOf(today)); setDay(today); }}>today</button>}
      </div>
      {!cal && <ModLoading />}
      {cal && (
        <div className="soc-cal" role="grid">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="soc-wd">{d}</div>)}
          {cells.map((d) => {
            const list = byDay.get(d) ?? [];
            const s = list.find((p) => p.kind === "song_of_day");
            const a = isMonday(d) ? aotwBy.get(d) : undefined;
            const other = d.slice(0, 7) !== month.slice(0, 7);
            const done = list.length > 0 && list.every(allPosted);
            const some = list.some((p) => Object.keys(p.posted).length > 0);
            return (
              <button key={d} role="gridcell" className={`soc-day-cell${d === day ? " sel" : ""}${d === today ? " today" : ""}${other ? " other" : ""}${d < today ? " past" : ""}`}
                onClick={() => { setDay(d); if (other) setMonth(monthOf(d)); }}>
                <span className="soc-dn">
                  {at(d).getDate()}
                  {list.length > 0 && <span className={`soc-dot${done ? " done" : some ? " some" : ""}`} title={done ? "all posted" : some ? "partly posted" : "not posted yet"} />}
                </span>
                {at(d).getDate() === 1 && <span className="soc-chip roundup">roundup</span>}
                {isMonday(d) && <span className={`soc-chip album${a ? "" : " empty"}`}>{a ? a.title : "pick album"}</span>}
                <span className={`soc-chip song${s ? "" : " empty"}`}>{s ? s.ref.title : d >= today ? "song: auto" : "no song"}</span>
              </button>
            );
          })}
        </div>
      )}

      {cal && (
        <section className="soc-panel">
          <div className="soc-day">{niceDay(day)}{day === today ? " · today" : ""}</div>

          <div className="soc-pick">
            <div className="soc-pick-head">
              <span><b>Song of the day:</b> {song ? <Link href={`/song/${song.ref.id}`}>{song.ref.artist} – {song.ref.title}</Link> : day >= today ? "the site picks one on the day" : "none"}</span>
              {!songLocked && <ModButton onClick={() => setPicking(picking === "song" ? null : "song")}>{picking === "song" ? "close" : song ? "change" : "choose"}</ModButton>}
              {songLocked && <ModTag>posted</ModTag>}
            </div>
            {picking === "song" && <SongPicker day={day} current={song?.track_id ?? null} locked={songLocked} onError={setError} onPicked={() => { setPicking(null); load(); }} />}
          </div>

          {isMonday(day) && (
            <div className="soc-pick">
              <div className="soc-pick-head">
                <span><b>Album of the week:</b> {weekPick ? `${weekPick.artist} – ${weekPick.title}` : "not picked yet"}</span>
                <ModButton onClick={() => setPicking(picking === "album" ? null : "album")}>{picking === "album" ? "close" : weekPick ? "change" : "choose"}</ModButton>
              </div>
              {picking === "album" && <AotwPicker week={day} onError={setError} onPicked={() => { setPicking(null); load(); }} />}
            </div>
          )}

          {missing && <div className="soc-pick"><div className="soc-pick-head">
            <span>{at(day).getDate() === 1 && !posts.some((p) => p.kind === "monthly") ? "The roundup post for last month isn't made yet." : "Some of this day's posts aren't made yet."}</span>
            <ModButton kind="approve" busy={busy} onClick={makeNow}>make them now</ModButton>
          </div></div>}
          {day > today && <div className="soc-count" style={{ margin: "6px 0 12px" }}>Posts for this day are made just after midnight on the day{at(day).getDate() === 1 ? " (the roundup once the month is over)" : ""}.</div>}

          {posts.map((p) => <PostCard key={p.id} post={p} onChange={update} onError={setError} />)}
        </section>
      )}
    </ModPage>
  );
}

export default function PostsPage() {
  return <Suspense fallback={<ModLoading />}><Calendar /></Suspense>;
}
