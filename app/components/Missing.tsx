"use client";

// "What am I missing": how much of each artist's catalogue you have
// (released songs, leaks and snippets), era by era, and which songs you don't
// have. From a Local Cuts folder (trackIds) or your collection (Spotify,
// Exportify and file imports). Counts for everyone; the lists are premium.
// Share cards (one artist, or the whole collection) are for everyone.

import "../styles/missing.css";
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { thumb } from "@/lib/thumb";
import { saveCsv, fileSafe } from "@/lib/csv";
import { collectionCard, collectionOverviewCard } from "./cards";
import CardButton from "./CardButton";

export type Who = { id: string; name: string; avatar: string | null; accent: string | null };

export type Era = { era: string; have: number; total: number; from?: number | null; to?: number | null; cover?: string | null };
type Gap = { id: string; title: string; status: string; era: string; day: string | null };
export type Row = { artist_id: string; artist: string; photo: string | null; have: number; total: number; eras: Era[]; missing: Gap[] | null };

const STATUS: Record<string, [string, string]> = {
  released: ["released", "#22C55E"], leaked: ["leaked", "#FF3355"], snippet: ["snippet", "#F5B841"],
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function Bar({ have, total }: { have: number; total: number }) {
  return <span className="lcm-bar" aria-hidden><span style={{ width: `${Math.max(have ? 2 : 0, pct(have, total))}%` }} /></span>;
}

const LOOSE = "Singles & loose songs";
// For A to Z: no leading "The", brackets or symbols.
const sortName = (n: string) => n.replace(/^the\s+/i, "").replace(/^[^\p{L}\p{N}]+/u, "");
const letter = (n: string) => { const c = sortName(n).charAt(0).toUpperCase(); return /\p{L}/u.test(c) ? c : "#"; };
const SMALL = 4; // eras with fewer songs than this are folded into "Singles & loose songs"
type Only = "all" | "unreleased" | "released";
const keep = (only: Only) => (g: Gap) => only === "all" || (only === "released" ? g.status === "released" : g.status !== "released");

// Real eras / projects; small ones folded into one "loose" group.
export function foldEras(all: Era[]) {
  const big = all.filter((e) => e.total >= SMALL && e.era !== LOOSE);
  const bigSet = new Set(big.map((e) => e.era));
  const small = all.filter((e) => !bigSet.has(e.era));
  const years = small.flatMap((e) => [e.from, e.to]).filter((y): y is number => typeof y === "number");
  const loose: Era = {
    era: LOOSE, have: small.reduce((a, e) => a + e.have, 0), total: small.reduce((a, e) => a + e.total, 0),
    from: years.length ? Math.min(...years) : null, to: years.length ? Math.max(...years) : null,
    cover: small.find((e) => e.cover)?.cover ?? null,
  };
  return { eras: [...big, ...(loose.total ? [loose] : [])], eraOf: (g: { era: string }) => (bigSet.has(g.era) ? g.era : LOOSE) };
}

// Your name, picture and colour for the share cards.
export function useWho() {
  const [who, setWho] = useState<Who | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const id = data.user?.id;
      if (!id) return;
      const { data: p } = await supabase.from("profiles").select("display_name, avatar_url, accent").eq("id", id).maybeSingle();
      setWho({ id, name: p?.display_name ?? "A collector", avatar: p?.avatar_url ?? null, accent: p?.accent ?? null });
    });
  }, []);
  return who;
}

// The card for one artist.
export const artistCard = (r: Pick<Row, "artist_id" | "artist" | "photo" | "have" | "total" | "eras">, who: Who | null) =>
  collectionCard({ artist: r.artist, photo: r.photo, have: r.have, total: r.total, eras: foldEras(r.eras).eras, who: who?.name ?? null, accent: who?.accent ?? null, url: `static-cuts.com/artist/${r.artist_id}` });

// The card for the whole collection.
export const overviewCard = (rows: Pick<Row, "artist" | "photo" | "have" | "total">[], who: Who) =>
  collectionOverviewCard({ who: who.name, avatar: who.avatar, accent: who.accent, url: `static-cuts.com/profile/${who.id}`,
    artists: rows.map((r) => ({ artist: r.artist, photo: r.photo, have: r.have, total: r.total })) });

function EraRow({ e, gaps, premium, openAll }: { e: Era; gaps: Gap[]; premium: boolean; openAll: boolean }) {
  const [open, setOpen] = useState(false);
  const done = e.have >= e.total;
  const show = open || openAll;
  return (
    <div className={`lcm-era2${done ? " done" : ""}${show ? " open" : ""}`}>
      <button className="lcm-era2-head" onClick={() => setOpen(!open)} disabled={done || !premium} aria-expanded={show}>
        <span className="lcm-era2-name">{e.era}</span>
        <span className="lcm-era2-bar"><Bar have={e.have} total={e.total} /></span>
        <span className="lcm-era2-n">{done ? "complete" : `${e.have}/${e.total}`}</span>
        {!done && premium && <span className="lcm-era2-miss">{gaps.length ? `${gaps.length} missing` : "none here"} {show ? "▴" : "▾"}</span>}
      </button>
      {show && !done && premium && gaps.length > 0 && (
        <ul className="lcm-list">
          {gaps.map((g) => {
            const [label, colour] = STATUS[g.status] ?? [g.status, "#9CA3AF"];
            return (
              <li key={g.id}>
                <Link href={`/song/${g.id}`} className="lcm-song" target="_blank">{g.title}</Link>
                <span className="lcm-tag" style={{ color: colour, borderColor: colour }}>{label}</span>
                {g.day && <span className="lcm-day">{g.day.slice(0, 4)}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ArtistCard({ r, premium, who }: { r: Row; premium: boolean; who: Who | null }) {
  const [open, setOpen] = useState(false);
  const [only, setOnly] = useState<Only>("all");
  const [hideDone, setHideDone] = useState(true);
  const [openAll, setOpenAll] = useState(false);

  // Real eras / projects; small ones folded into one "loose" group.
  const { eras, eraOf } = useMemo(() => foldEras(r.eras), [r.eras]);
  const gapsBy = useMemo(() => {
    const m = new Map<string, Gap[]>();
    for (const g of (r.missing ?? []).filter(keep(only))) { const k = eraOf(g); m.set(k, [...(m.get(k) ?? []), g]); }
    return m;
  }, [r.missing, only, eraOf]);
  // A to Z under letter headings ("The" doesn't count), loose songs last.
  const shown = eras.filter((e) => !(hideDone && e.have >= e.total))
    .sort((a, b) => (a.era === LOOSE ? 1 : 0) - (b.era === LOOSE ? 1 : 0) || sortName(a.era).localeCompare(sortName(b.era), "en-GB", { numeric: true }));
  const doneN = eras.filter((e) => e.have >= e.total).length;
  const missingCount = r.total - r.have;

  return (
    <div className={`lcm-card${open ? " open" : ""}`}>
      <button className="lcm-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {r.photo ? <img src={thumb(r.photo)} alt="" className="lcm-photo" /> : <span className="lcm-photo blank">SC//</span>}
        <span className="lcm-who">
          <b>{r.artist}</b>
          <small>{r.have.toLocaleString("en-GB")} of {r.total.toLocaleString("en-GB")} songs · {pct(r.have, r.total)}% · {doneN} of {eras.length} eras complete</small>
          <Bar have={r.have} total={r.total} />
        </span>
        <span className="lcm-more">{open ? "Hide" : missingCount ? `${missingCount.toLocaleString("en-GB")} missing` : "Complete!"}</span>
      </button>
      {open && (
        <div className="lcm-body">
          <div className="lcm-filters">
            {premium && ([["all", "Everything"], ["unreleased", "Leaks & snippets"], ["released", "Released"]] as const).map(([k, label]) => (
              <button key={k} aria-pressed={only === k} className={`tab${only === k ? " active" : ""}`} onClick={() => setOnly(k)}>{label}</button>
            ))}
            <CardButton className="tab" fileName={`static-cuts-${fileSafe(r.artist)}-collection`} title={`My ${r.artist} on Static-Cuts//`}
              makeKey={`${r.artist_id}:${r.have}:${r.total}:${who?.name ?? ""}`}
              make={() => artistCard(r, who)} />
            <label className="lcm-toggle"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide complete eras ({doneN})</label>
            {premium && <button className="text-link" onClick={() => setOpenAll(!openAll)}>{openAll ? "Close all" : "Open all"}</button>}
            {premium && (r.missing?.length ?? 0) > 0 && (
              <button className="text-link" onClick={() => saveCsv(`static-cuts-missing-${fileSafe(r.artist)}.csv`, [
                ["Title", "Status", "Era / album", "Date", "Page"],
                ...(r.missing ?? []).map((g) => [g.title, g.status, g.era, g.day, `https://static-cuts.com/song/${g.id}`]),
              ])}>Download list (CSV)</button>
            )}
          </div>
          <div className="lcm-eras2">
            {shown.map((e, i) => {
              const l = e.era === LOOSE ? "" : letter(e.era);
              const head = l && (i === 0 || letter(shown[i - 1].era) !== l || shown[i - 1].era === LOOSE);
              return (
                <Fragment key={e.era}>
                  {head && <div className="lcm-letter">{l}</div>}
                  {e.era === LOOSE && i > 0 && <div className="lcm-letter">Loose</div>}
                  <EraRow e={e} gaps={gapsBy.get(e.era) ?? []} premium={premium} openAll={openAll} />
                </Fragment>
              );
            })}
            {shown.length === 0 && <p className="lc-small">Every era complete. Nice.</p>}
          </div>
          {!premium && (
            <p className="lc-small"><span className="lc-sl" style={{ color: "#F5B841" }}>//</span> Opening an era to see the songs you&apos;re missing is premium. <Link href="/premium" className="text-link">Get premium</Link></p>
          )}
          {(r.missing?.length ?? 0) >= 400 && <p className="lc-small">Lists show up to 400 missing songs. See the rest on the <Link href={`/artist/${r.artist_id}`} className="text-link">artist page</Link>.</p>}
        </div>
      )}
    </div>
  );
}

export default function Missing({ trackIds, collection = false, refresh = 0, premium, intro }: {
  trackIds?: string[]; collection?: boolean; refresh?: number; premium: boolean; intro?: string;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const who = useWho();
  const ids = trackIds ?? [];
  const key = collection ? `collection:${refresh}` : ids.length + ":" + ids.slice(0, 5).join(",");
  useEffect(() => {
    if (!collection && !ids.length) { setRows([]); return; }
    let live = true;
    setRows(null); setErr(null);
    const ask = collection ? supabase.rpc("rpc_collection_missing") : supabase.rpc("rpc_local_missing", { p_track_ids: [...new Set(ids)] });
    ask.then(({ data, error }) => {
      if (!live) return;
      if (error) { setErr(error.message); setRows([]); } else setRows((data as Row[]) ?? []);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, premium]);

  if (rows && !rows.length && !err) return null;
  return (
    <section className="lc-box lcm-wrap">
      <div className="lc-box-head">
        <h2 className="lc-h in">What you&apos;re missing</h2>
        <span className="lc-small">{intro ?? "Every artist you have 3+ songs of: released songs, leaks and snippets on the site, era by era."}</span>
        {rows && rows.length > 0 && who && (
          <CardButton className="tab lcm-share-all" fileName="static-cuts-my-collection" title="My collection on Static-Cuts//"
            label="Share my collection//" makeKey={`${who.id}:${rows.length}:${rows.reduce((a, r) => a + r.have, 0)}`}
            make={() => overviewCard(rows, who)} />
        )}
      </div>
      {rows === null && <p className="lc-small">Working it out…</p>}
      {err && <p className="lc-small">Couldn&apos;t work it out: {err}</p>}
      <div className="lcm-cards">
        {(rows ?? []).map((r) => <ArtistCard key={r.artist_id} r={r} premium={premium} who={who} />)}
      </div>
    </section>
  );
}
