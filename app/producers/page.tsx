"use client";

// Producers: everyone credited with producing songs in the archive.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Row = { name: string; songs: number; artists: number };

export default function ProducersPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      supabase.rpc("rpc_producers", { p_query: q.trim() || null, p_limit: 300 }).then(({ data }) => setRows((data as Row[]) ?? []));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="wrap">
      <h1 className="detail-name page-title">Producers</h1>
      <div className="detail-meta">Everyone credited with producing songs here. Credits fill in over time from Genius and community sheets.</div>
      <input className="search-input" style={{ width: "100%", marginBottom: 14 }} placeholder="Find a producer…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!rows && <div className="empty-state">loading…</div>}
      {rows && rows.length === 0 && <div className="empty-state">{q ? "No producer by that name yet." : "No producer credits yet."}</div>}
      {rows?.map((r) => (
        <div key={r.name} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <div className="review-row-title"><Link href={`/producer/${encodeURIComponent(r.name)}`}>{r.name}</Link></div>
          <span className="comment-meta">{r.songs} song{r.songs === 1 ? "" : "s"} · {r.artists} artist{r.artists === 1 ? "" : "s"}</span>
        </div>
      ))}
    </div>
  );
}
