"use client";

// "What am I missing": how much of each artist's catalogue you have
// (released songs, leaks and snippets), era by era, and which songs you don't
// have. From a Local Cuts folder (trackIds) or your collection (Spotify,
// Exportify and file imports). Counts for everyone; the lists are premium.

import "../styles/missing.css";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { thumb } from "@/lib/thumb";
import { saveCsv, fileSafe } from "@/lib/csv";

type Era = { era: string; have: number; total: number };
type Gap = { id: string; title: string; status: string; era: string; day: string | null };
type Row = { artist_id: string; artist: string; photo: string | null; have: number; total: number; eras: Era[]; missing: Gap[] | null };

const STATUS: Record<string, [string, string]> = {
  released: ["released", "#22C55E"], leaked: ["leaked", "#FF3355"], snippet: ["snippet", "#F5B841"],
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function Bar({ have, total }: { have: number; total: number }) {
  return <span className="lcm-bar" aria-hidden><span style={{ width: `${Math.max(have ? 2 : 0, pct(have, total))}%` }} /></span>;
}

const LOOSE = "Singles & loose songs";
const SMALL = 4; // eras with fewer songs than this are folded into "Singles & loose songs"
type Only = "all" | "unreleased" | "released";
const keep = (only: Only) => (g: Gap) => only === "all" || (only === "released" ? g.status === "released" : g.status !== "released");

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

function ArtistCard({ r, premium }: { r: Row; premium: boolean }) {
  const [open, setOpen] = useState(false);
  const [only, setOnly] = useState<Only>("all");
  const [hideDone, setHideDone] = useState(true);
  const [openAll, setOpenAll] = useState(false);

  // Real eras / projects, oldest first; small ones folded into one "loose" group.
  const { eras, eraOf } = useMemo(() => {
    const big = r.eras.filter((e) => e.total >= SMALL && e.era !== LOOSE);
    const bigSet = new Set(big.map((e) => e.era));
    const loose = r.eras.filter((e) => !bigSet.has(e.era)).reduce((a, e) => ({ era: LOOSE, have: a.have + e.have, total: a.total + e.total }), { era: LOOSE, have: 0, total: 0 });
    return { eras: [...big, ...(loose.total ? [loose] : [])], eraOf: (g: Gap) => (bigSet.has(g.era) ? g.era : LOOSE) };
  }, [r.eras]);
  const gapsBy = useMemo(() => {
    const m = new Map<string, Gap[]>();
    for (const g of (r.missing ?? []).filter(keep(only))) { const k = eraOf(g); m.set(k, [...(m.get(k) ?? []), g]); }
    return m;
  }, [r.missing, only, eraOf]);
  const shown = eras.filter((e) => !(hideDone && e.have >= e.total));
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
            {shown.map((e) => <EraRow key={e.era} e={e} gaps={gapsBy.get(e.era) ?? []} premium={premium} openAll={openAll} />)}
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
      </div>
      {rows === null && <p className="lc-small">Working it out…</p>}
      {err && <p className="lc-small">Couldn&apos;t work it out: {err}</p>}
      <div className="lcm-cards">
        {(rows ?? []).map((r) => <ArtistCard key={r.artist_id} r={r} premium={premium} />)}
      </div>
    </section>
  );
}
