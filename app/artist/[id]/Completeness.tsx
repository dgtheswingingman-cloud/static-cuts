"use client";

// "Page 62% complete": how much of an artist's page is filled in, with a
// breakdown and a link to the help-wanted page.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Part = { done: number; total: number };
type Data = { score: number | null; parts: Record<"status" | "links" | "dates" | "albums", Part> };

const LABELS: [keyof Data["parts"], string][] = [
  ["status", "songs with a status"],
  ["links", "releases with a listen link"],
  ["dates", "releases with a date"],
  ["albums", "releases with an album"],
];

export default function Completeness({ artistId, refreshKey }: { artistId: string; refreshKey?: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    supabase.rpc("rpc_artist_completeness", { p_artist_id: artistId }).then(({ data: d }) => setData((d as Data) ?? null));
  }, [artistId, refreshKey]);

  if (!data || data.score === null) return null;

  return (
    <div className="completeness">
      <button className="completeness-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>page {data.score}% complete</span>
        <span className="completeness-bar"><span style={{ width: `${data.score}%` }} /></span>
        <span className="comment-meta">{open ? "hide" : "details"}</span>
      </button>
      {open && (
        <div className="health-tiles" style={{ marginTop: 10 }}>
          {LABELS.filter(([k]) => data.parts[k].total > 0).map(([k, label]) => {
            const p = data.parts[k];
            return (
              <div key={k} className="health-tile">
                <div className="health-tile-value">{Math.round((p.done * 100) / p.total)}%</div>
                <div className="health-tile-label">{label} ({p.done.toLocaleString("en-GB")}/{p.total.toLocaleString("en-GB")})</div>
              </div>
            );
          })}
          <div className="health-tile" style={{ display: "flex", alignItems: "center" }}>
            <Link href="/help" className="text-link">help fill it in →</Link>
          </div>
        </div>
      )}
    </div>
  );
}
