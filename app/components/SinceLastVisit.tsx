"use client";

// "Since your last visit": what changed for your artists since you were last
// here. The visit times are kept in this browser (a new visit starts after an
// hour away), so it works for picks before signing up too.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Row = {
  artist_id: string; artist: string; added: number; leaked: number; released: number;
  snippet: number; changed: number; checked: number;
};

const KEY = "static_cuts_visits";
const HOUR = 60 * 60 * 1000;

// Returns when the previous visit started (null on a first visit).
function previousVisit(who: string): number | null {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, { last: number; prev: number | null }>;
    const now = Date.now();
    const v = all[who];
    let prev: number | null = v?.prev ?? null;
    if (v && now - v.last > HOUR) prev = v.last;
    all[who] = { last: now, prev };
    localStorage.setItem(KEY, JSON.stringify(all));
    return prev;
  } catch {
    return null;
  }
}

function ago(ms: number) {
  const h = Math.round((Date.now() - ms) / HOUR);
  if (h < 24) return `${Math.max(1, h)} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export default function SinceLastVisit({ who, artistIds }: { who: string; artistIds?: string[] }) {
  const [since, setSince] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(false);
  const idsKey = (artistIds ?? []).join(",");

  useEffect(() => {
    const prev = previousVisit(who);
    setSince(prev);
    if (!prev) return;
    supabase.rpc("rpc_since_last_visit", { p_since: new Date(prev).toISOString(), p_artist_ids: artistIds?.length ? artistIds : null })
      .then(({ data }) => setRows((data as Row[]) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who, idsKey]);

  if (!since || !rows || rows.length === 0) return null;

  const part = (n: number, one: string, many = one) => (n > 0 ? `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}` : null);
  const line = (r: Row) => [
    part(r.leaked, "leaked"), part(r.released, "released"), part(r.snippet, "new snippet", "new snippets"),
    part(r.added, "new song", "new songs"), part(r.changed, "status change", "status changes"),
    part(r.checked, "status filled in", "statuses filled in"),
  ].filter(Boolean).join(" · ");
  const shown = open ? rows : rows.slice(0, 4);

  return (
    <div className="comments-panel since-visit">
      <div className="section-label" style={{ margin: "0 0 8px" }}>Since your last visit ({ago(since)})</div>
      {shown.map((r) => (
        <div key={r.artist_id} className="year-row">
          <Link href={`/artist/${r.artist_id}`} className="text-link">{r.artist}</Link>
          <span className="comment-meta" style={{ textAlign: "right" }}>{line(r)}</span>
        </div>
      ))}
      <div className="comment-meta" style={{ marginTop: 8 }}>
        {rows.length > 4 && (
          <button className="text-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
            onClick={() => setOpen(!open)}>{open ? "show fewer" : `show all ${rows.length} artists`}</button>
        )}
        {rows.length > 4 && " · "}
        <Link href="/new" className="text-link">everything new →</Link>
      </div>
    </div>
  );
}
