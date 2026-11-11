"use client";

// Social posts (admin): each day's posts, ready to put up by hand. Song of
// the day and on this day every day, album of the week on Mondays, the
// monthly roundup on the 1st. For each platform: the pictures in its size
// (download them), the caption (edit, copy), and a tick once it's posted.
// A song you don't like can be swapped before it's posted anywhere.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { SOCIAL_SLIDES, type SocialFormat } from "@/lib/social";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";
import { ModPage, ModButton, ModTag, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";
import "../../styles/social.css";

type Platform = "instagram" | "tiktok" | "x";
type Post = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  id: string; post_date: string; kind: string; track_id: string | null; ref: Record<string, any>;
  captions: Partial<Record<Platform, string>>; posted: Partial<Record<Platform, string>>;
};

const KIND: Record<string, string> = {
  song_of_day: "Song of the day", on_this_day: "On this day", album_of_week: "Album of the week", monthly: "Monthly roundup",
};
const PLATFORMS: { key: Platform; label: string; formats: { f: SocialFormat; what: string }[]; limit?: number }[] = [
  { key: "instagram", label: "Instagram", formats: [{ f: "ig", what: "post" }, { f: "story", what: "story" }], limit: 2200 },
  { key: "tiktok", label: "TikTok", formats: [{ f: "story", what: "photo" }], limit: 2200 },
  { key: "x", label: "X", formats: [{ f: "x", what: "picture" }], limit: 280 },
];

const dayLabel = (iso: string) => {
  const today = new Date().toLocaleDateString("en-CA");
  const nice = new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return iso === today ? `Today · ${nice}` : nice;
};
function title(p: Post) {
  const r = p.ref;
  if (p.kind === "monthly") return new Date(`${r.month}T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  return `${r.artist} – ${r.title}`;
}
const fileName = (p: Post, f: SocialFormat, n: number) =>
  `static-cuts-${p.post_date}-${p.kind.replace(/_/g, "-")}-${f === "ig" ? "post" : f}${n > 1 || (SOCIAL_SLIDES[p.kind]?.[f] ?? 1) > 1 ? `-${n}` : ""}.png`;

function PostCard({ post, onChange, onError, onReload }: { post: Post; onChange: (p: Post) => void; onError: (m: string) => void; onReload: () => Promise<void> }) {
  const [plat, setPlat] = useState<Platform>("instagram");
  const [text, setText] = useState(post.captions[plat] ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setText(post.captions[plat] ?? ""); setCopied(false); }, [plat, post]);
  const p = PLATFORMS.find((x) => x.key === plat)!;
  const dirty = text !== (post.captions[plat] ?? "");
  const r = post.ref;

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
  async function swap() {
    setBusy("swap");
    const { error } = await supabase.rpc("admin_social_reroll", { p_id: post.id });
    if (!error) await onReload();
    setBusy(null);
    if (error) onError(error.message);
  }

  const songHref = r.id && (post.kind === "song_of_day" || post.kind === "on_this_day") ? `/song/${r.id}` : null;
  const canSwap = (post.kind === "song_of_day" || post.kind === "on_this_day") && Object.keys(post.posted).length === 0;
  const version = encodeURIComponent(String(post.track_id ?? post.id));
  return (
    <div className="soc-post">
      <div className="soc-head">
        <ModTag>{KIND[post.kind] ?? post.kind}</ModTag>
        <span className="soc-title">{songHref ? <Link href={songHref}>{title(post)}</Link> : title(post)}</span>
        {r.status && <ModTag kind={r.status === "released" ? "good" : "warn"}>{r.status}</ModTag>}
        {canSwap && <ModButton busy={busy === "swap"} onClick={swap}>pick another</ModButton>}
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
          {p.formats.flatMap(({ f, what }) =>
            Array.from({ length: SOCIAL_SLIDES[post.kind]?.[f] ?? 1 }, (_, i) => {
              const src = `/social/slide?id=${post.id}&f=${f}&n=${i + 1}&v=${version}`;
              return (
                <div key={`${f}-${i}`} className={`soc-pic ${f}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`${what} ${i + 1}`} loading="lazy" />
                  <a className="text-link" href={src} download={fileName(post, f, i + 1)}>
                    download {what}{(SOCIAL_SLIDES[post.kind]?.[f] ?? 1) > 1 ? ` ${i + 1}` : ""}
                  </a>
                </div>
              );
            }))}
        </div>
        <div className="soc-cap">
          <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label={`${p.label} caption`} />
          <div className="soc-cap-bar">
            <span className={`soc-count${p.limit && text.length > p.limit ? " over" : ""}`}>{text.length}{p.limit ? ` / ${p.limit}` : ""}</span>
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

export default function SocialPage() {
  const { loading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string | null>(null);

  async function load(d = days) {
    const { data, error: err } = await supabase.rpc("admin_social_posts", { p_days: d });
    if (err) { setError(err.message); setPosts([]); return; }
    setPosts((data as Post[]) ?? []);
  }
  useEffect(() => { if (isAdmin) load(days); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isAdmin, days]);

  if (!isAdmin) return <NoAccess loading={authLoading} who="admin" />;
  const byDay = new Map<string, Post[]>();
  for (const p of posts ?? []) byDay.set(p.post_date, [...(byDay.get(p.post_date) ?? []), p]);
  const update = (p: Post) => setPosts((prev) => (prev ?? []).map((x) => (x.id === p.id ? p : x)));
  return (
    <ModPage title="Social posts" intro="Each day's posts, made just after midnight: song of the day and on this day, album of the week on Mondays, last month's roundup on the 1st. Download the pictures, copy the caption, post it, then tick it off.">
      {error && <ModNotice kind="error" onClose={() => setError(null)}>{error}</ModNotice>}
      {!posts && <ModLoading />}
      {posts && posts.length === 0 && <ModEmpty>No posts yet. The first ones are made just after midnight.</ModEmpty>}
      {[...byDay.entries()].map(([day, list]) => (
        <section key={day}>
          <div className="soc-day">{dayLabel(day)}</div>
          {list.map((p) => <PostCard key={p.id} post={p} onChange={update} onError={setError} onReload={() => load()} />)}
        </section>
      ))}
      {posts && posts.length > 0 && days < 60 && (
        <ModButton onClick={() => setDays((d) => Math.min(60, d + 14))}>show older</ModButton>
      )}
    </ModPage>
  );
}
