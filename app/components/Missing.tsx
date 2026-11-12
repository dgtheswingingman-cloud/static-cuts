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

function ArtistCard({ r, premium }: { r: Row; premium: boolean }) {
  const [open, setOpen] = useState(false);
  const [only, setOnly] = useState<"all" | "unreleased" | "released">("all");
  const [era, setEra] = useState<string | null>(null);
  const eras = r.eras.filter((e) => e.total > 0);
  const gaps = (r.missing ?? []).filter((g) =>
    (only === "all" || (only === "released" ? g.status === "released" : g.status !== "released")) && (!era || g.era === era));
  const byEra = useMemo(() => {
    const m = new Map<string, Gap[]>();
    for (const g of gaps) { const l = m.get(g.era) ?? []; l.push(g); m.set(g.era, l); }
    return [...m.entries()];
  }, [gaps]);
  const missingCount = r.total - r.have;

  return (
    <div className={`lcm-card${open ? " open" : ""}`}>
      <button className="lcm-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {r.photo ? <img src={thumb(r.photo)} alt="" className="lcm-photo" /> : <span className="lcm-photo blank">SC//</span>}
        <span className="lcm-who">
          <b>{r.artist}</b>
          <small>{r.have.toLocaleString("en-GB")} of {r.total.toLocaleString("en-GB")} songs · {pct(r.have, r.total)}%</small>
          <Bar have={r.have} total={r.total} />
        </span>
        <span className="lcm-more">{open ? "Hide" : missingCount ? `${missingCount.toLocaleString("en-GB")} missing` : "Complete!"}</span>
      </button>
      {open && (
        <div className="lcm-body">
          <div className="lcm-eras">
            {eras.map((e) => (
              <button key={e.era} className={`lcm-era${era === e.era ? " on" : ""}${e.have === e.total ? " full" : ""}`}
                onClick={() => setEra(era === e.era ? null : e.era)} disabled={!premium} title={premium ? "Show only this era" : undefined}>
                <span className="lcm-era-name">{e.era}</span>
                <span className="lcm-era-n">{e.have}/{e.total}</span>
                <Bar have={e.have} total={e.total} />
              </button>
            ))}
          </div>
          {!premium ? (
            <p className="lc-small"><span className="lc-sl" style={{ color: "#F5B841" }}>//</span> The list of songs you&apos;re missing is premium. <Link href="/premium" className="text-link">Get premium</Link></p>
          ) : (
            <>
              <div className="lcm-filters" role="radiogroup" aria-label="Which songs">
                {([["all", "Everything"], ["unreleased", "Leaks & snippets"], ["released", "Released"]] as const).map(([k, label]) => (
                  <button key={k} role="radio" aria-checked={only === k} className={`tab${only === k ? " active" : ""}`} onClick={() => setOnly(k)}>{label}</button>
                ))}
                {era && <button className="text-link" onClick={() => setEra(null)}>Show every era</button>}
                <button className="text-link" onClick={() => saveCsv(`static-cuts-missing-${fileSafe(r.artist)}.csv`, [
                  ["Title", "Status", "Era / album", "Date", "Page"],
                  ...(r.missing ?? []).map((g) => [g.title, g.status, g.era, g.day, `https://static-cuts.com/song/${g.id}`]),
                ])}>Download list (CSV)</button>
              </div>
              {byEra.length === 0 && <p className="lc-small">Nothing missing here.</p>}
              {byEra.map(([name, list]) => (
                <div key={name} className="lcm-group">
                  <div className="lcm-group-h">{name} <small>{list.length} missing</small></div>
                  <ul className="lcm-list">
                    {list.map((g) => {
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
                </div>
              ))}
              {(r.missing?.length ?? 0) >= 400 && <p className="lc-small">Showing the first 400. See the rest on the <Link href={`/artist/${r.artist_id}`} className="text-link">artist page</Link>.</p>}
            </>
          )}
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
