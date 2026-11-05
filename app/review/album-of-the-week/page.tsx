"use client";

// Album of the week (admin): the site's shortlist for a week (made every
// Thursday for the next week; one album per artist, from follows, Spotify
// libraries and how much unreleased the era has, with some shuffle) and
// Claude's blurbs. Pick one, edit its blurb if you like. It goes on the home
// page and /weekly on that Monday, and the slides are ready to download.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";
import { ModPage, ModRow, ModButton, ModNotice, ModLoading, ModEmpty, ModTag } from "../../components/Mod";
import { eraHref } from "../../components/AlbumOfWeek";
import { thumb } from "@/lib/thumb";

type Cand = {
  week_start: string; artist_id: string; artist: string; album_key: string; title: string; year: number | null; cover: string | null;
  era_key: string | null; unreleased: number; highlights: string[]; reasons: string | null; blurb: string | null;
};
type Data = { week_start: string; pick: (Cand & { picked_at: string }) | null; candidates: Cand[] };

function monday(d: Date) {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.toLocaleDateString("en-CA");
}
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
};
const nice = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

export default function AlbumOfTheWeekAdmin() {
  const { loading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const thisWeek = monday(new Date());
  const [week, setWeek] = useState(thisWeek);
  const [data, setData] = useState<Data | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "done" | "error"; text: string } | null>(null);

  async function load(rebuild = false) {
    setData(null);
    const { data: d, error } = await supabase.rpc("admin_aotw_candidates", { p_week: week, p_rebuild: rebuild });
    if (error) { setMessage({ kind: "error", text: error.message }); return; }
    setData(d as Data);
    setEdits({});
  }
  useEffect(() => {
    if (isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, week]);

  async function pick(c: Cand) {
    const k = `${c.artist_id}|${c.album_key}`;
    setBusy(k);
    const { error } = await supabase.rpc("admin_aotw_pick", { p_week: week, p_artist: c.artist_id, p_album_key: c.album_key, p_blurb: edits[k] ?? c.blurb });
    setBusy(null);
    if (error) { setMessage({ kind: "error", text: error.message }); return; }
    setMessage({ kind: "done", text: `${c.title} is the album of the week for ${nice(week)}.` });
    load();
  }

  if (!isAdmin) return <NoAccess loading={authLoading} who="admin" />;

  const pickedKey = data?.pick ? `${data.pick.artist_id}|${data.pick.album_key}` : null;
  const waiting = (data?.candidates ?? []).filter((c) => !c.blurb).length;

  return (
    <ModPage
      title="Album of the week"
      intro={<>
        The site&apos;s shortlist for the week (a new one every Thursday for the next week), with Claude&apos;s blurbs.
        Pick one and edit the blurb if you like. It shows on the home page and This Week from that Monday, and the
        slides below are ready to post.
      </>}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <button className="tab" onClick={() => setWeek(shift(week, -7))}>← earlier</button>
        <span className="comment-body">Week of {nice(week)}{week === thisWeek ? " (this week)" : ""}</span>
        <button className="tab" onClick={() => setWeek(shift(week, 7))}>later →</button>
        <ModButton confirm="Make a new shortlist for this week? Unpicked albums are swapped out." onClick={() => load(true)}>new shortlist</ModButton>
      </div>

      {message && <ModNotice kind={message.kind} onClose={() => setMessage(null)}>{message.text}</ModNotice>}

      {data?.pick && (
        <ModNotice kind="done">
          Picked: <b>{data.pick.title}</b> by {data.pick.artist}.{" "}
          {week <= thisWeek
            ? <>Slides: <a className="text-link" href={`/album-of-the-week/slide?n=1&week=${week}`} target="_blank" rel="noopener noreferrer">1 (album)</a>
              {" · "}<a className="text-link" href={`/album-of-the-week/slide?n=2&week=${week}`} target="_blank" rel="noopener noreferrer">2 (from the era)</a>.
              Long-press or right-click to save; add a sound in the app.</>
            : <>The slides appear here on {nice(week)}.</>}
        </ModNotice>
      )}
      {data && waiting > 0 && <div className="comment-meta" style={{ marginBottom: 10 }}>Claude is writing {waiting} blurb{waiting === 1 ? "" : "s"} (within 10 minutes).</div>}

      {!data && <ModLoading />}
      {data && data.candidates.length === 0 && <ModEmpty>Nothing to shortlist this week.</ModEmpty>}

      {(data?.candidates ?? []).map((c) => {
        const k = `${c.artist_id}|${c.album_key}`;
        const picked = k === pickedKey;
        return (
          <ModRow
            key={k}
            title={<span style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {c.cover
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={thumb(c.cover)} alt="" width={56} height={56} style={{ objectFit: "cover", flex: "0 0 auto" }} />
                : null}
              <span><Link href={eraHref(c)} className="text-link">{c.title}</Link> · <Link href={`/artist/${c.artist_id}`} className="text-link">{c.artist}</Link>{c.year ? ` · ${c.year}` : ""}</span>
              {picked && <ModTag kind="good">picked</ModTag>}
            </span>}
            meta={<>
              {c.reasons && <span>{c.reasons}</span>}
              {c.highlights?.length > 0 && <span>From the era: {c.highlights.slice(0, 4).join(" · ")}</span>}
            </>}
            actions={<ModButton kind="approve" busy={busy === k} onClick={() => pick(c)}>{picked ? "save blurb" : "pick this"}</ModButton>}
          >
            <textarea
              className="search-input"
              style={{ width: "100%", minHeight: 70, marginTop: 8, fontSize: "0.85rem" }}
              placeholder={c.blurb ? "" : "Claude hasn't written this one yet. You can write your own."}
              value={edits[k] ?? (picked ? data?.pick?.blurb ?? c.blurb ?? "" : c.blurb ?? "")}
              onChange={(e) => setEdits({ ...edits, [k]: e.target.value })}
            />
          </ModRow>
        );
      })}
    </ModPage>
  );
}
