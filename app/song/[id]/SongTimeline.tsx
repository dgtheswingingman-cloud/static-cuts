"use client";

// A song's timeline: real-world moments fans add (first snippet on an IG
// live, played at a show, teased in an interview, music video…), each with a
// date and a source, alongside when it leaked or came out and the site's own
// status changes. Anyone signed in can add a moment; moderators (and whoever
// added it) can take one down. Sources can't be file hosts or audio files.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useIsModerator, usePersonalUser } from "../../useIsAdmin";
import Supporter from "../../components/Supporter";

type Kind = "snippet" | "live" | "show" | "interview" | "tease" | "leak" | "release" | "video" | "other";
type Moment = {
  id: string; kind: Kind; happened_on: string; precision: "day" | "month" | "year"; title: string;
  source_url: string; added_by: string | null; by_name: string | null; mine: boolean;
};
export type AutoEvent = { at: string; text: ReactNode; note?: string | null; site?: boolean; kind?: Kind };

const KINDS: [Kind, string][] = [
  ["snippet", "snippet"], ["live", "IG / live stream"], ["show", "played live at a show"], ["tease", "teased"],
  ["interview", "interview"], ["video", "music video"], ["leak", "leaked"], ["release", "released"], ["other", "other"],
];
const LABEL = Object.fromEntries(KINDS) as Record<Kind, string>;

function when(d: string, precision: Moment["precision"] = "day") {
  const x = new Date(`${d.slice(0, 10)}T12:00:00Z`);
  if (precision === "year") return String(x.getUTCFullYear());
  if (precision === "month") return x.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  return x.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "source"; } };

export default function SongTimeline({ trackId, auto }: { trackId: string; auto: AutoEvent[] }) {
  const user = usePersonalUser();
  const isMod = useIsModerator();
  const [moments, setMoments] = useState<Moment[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Kind>("snippet");
  const [date, setDate] = useState("");
  const [precision, setPrecision] = useState<Moment["precision"]>("day");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.rpc("rpc_song_moments", { p_track: trackId });
    setMoments((data as Moment[]) ?? []);
  }
  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  async function add() {
    setBusy(true);
    setMsg(null);
    // Month or year only: store the first day; the precision says how to show it.
    const d = precision === "year" ? `${date.slice(0, 4)}-01-01` : precision === "month" ? `${date.slice(0, 7)}-01` : date;
    const { error } = await supabase.rpc("rpc_song_moment_add", { p_track: trackId, p_kind: kind, p_date: d, p_precision: precision, p_title: title, p_source: source });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setTitle(""); setSource(""); setDate(""); setAdding(false);
    load();
  }

  async function remove(m: Moment) {
    if (!confirm("Take this moment off the timeline?")) return;
    const { error } = await supabase.rpc("rpc_song_moment_remove", { p_id: m.id });
    if (error) { setMsg(error.message); return; }
    load();
  }

  type Row = { at: string; sort: string; node: ReactNode; kind: Kind | "site"; key: string };
  const rows: Row[] = [
    ...(moments ?? []).map((m) => ({
      at: when(m.happened_on, m.precision), sort: m.happened_on, kind: m.kind, key: m.id,
      node: (
        <>
          <span className={`tl-kind k-${m.kind}`}>{LABEL[m.kind]}</span>
          <span className="tl-title">{m.title}</span>
          <span className="tl-meta">
            <a href={m.source_url} target="_blank" rel="noopener noreferrer nofollow" className="text-link">{host(m.source_url)} ↗</a>
            {m.added_by && <> · added by <Link href={`/profile/${m.added_by}`} className="text-link">{m.by_name ?? "someone"}</Link><Supporter id={m.added_by} /></>}
            {(m.mine || isMod) && <> · <button className="rating-clear" onClick={() => remove(m)}>remove</button></>}
          </span>
        </>
      ),
    })),
    ...auto.map((e, i) => ({
      at: when(e.at), sort: e.at.slice(0, 10), kind: (e.site ? "site" : e.kind ?? "other") as Kind | "site", key: `auto-${i}`,
      node: (
        <>
          {e.site ? <span className="tl-kind k-site">on static cuts</span> : <span className={`tl-kind k-${e.kind ?? "other"}`}>{LABEL[e.kind ?? "other"]}</span>}
          <span className={e.site ? "tl-site" : "tl-title"}>{e.text}</span>
          {e.note && <span className="tl-meta">{e.note}</span>}
        </>
      ),
    })),
  ].sort((a, b) => a.sort.localeCompare(b.sort));

  return (
    <div className="tl">
      <div className="section-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <span>Timeline</span>
        {user ? (
          <button className="tab" onClick={() => setAdding(!adding)}>{adding ? "cancel" : "+ add a moment"}</button>
        ) : (
          <Link href="/login" className="comment-meta text-link" style={{ textTransform: "none", letterSpacing: 0 }}>sign in to add a moment</Link>
        )}
      </div>

      {adding && (
        <div className="tl-form">
          <div className="comment-meta" style={{ marginBottom: 10, lineHeight: 1.5 }}>
            First snippet, an IG live, a show, an interview, the video… Add the date and a link to where it&apos;s shown
            (a post, video or article). No file links.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <select className="search-input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input className="search-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
            <select className="search-input" value={precision} onChange={(e) => setPrecision(e.target.value as Moment["precision"])} title="How sure of the date?">
              <option value="day">exact day</option>
              <option value="month">month only</option>
              <option value="year">year only</option>
            </select>
          </div>
          <input className="search-input" style={{ width: "100%", marginBottom: 8 }} maxLength={200} placeholder="What happened? e.g. Previewed on Carti's IG live"
            value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="search-input" style={{ width: "100%", marginBottom: 10 }} placeholder="Source link (post, video or article)"
            value={source} onChange={(e) => setSource(e.target.value)} />
          <button className="tab active" disabled={busy || !date || !title.trim() || !source.trim()} onClick={add}>{busy ? "adding…" : "add to timeline"}</button>
        </div>
      )}
      {msg && <div className="comment-meta error-text" style={{ marginBottom: 8 }}>{msg}</div>}

      {moments && rows.length === 0 && (
        <div className="comment-meta" style={{ marginBottom: 12 }}>Nothing yet. Know when this was first teased or played? Add it.</div>
      )}
      {rows.length > 0 && (
        <ol className="tl-list">
          {rows.map((r) => (
            <li key={r.key} className={`tl-row ${r.kind === "site" ? "tl-dim" : ""}`}>
              <span className={`tl-dot k-${r.kind}`} />
              <span className="tl-date">{r.at}</span>
              <span className="tl-body">{r.node}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
