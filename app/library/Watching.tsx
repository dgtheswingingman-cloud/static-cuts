"use client";

// My Library: the songs you're watching (Track Watch), with their status now.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { thumb } from "@/lib/thumb";

type W = { id: string; title: string; artist: string; artist_id: string; status: string; cover: string | null };

export default function Watching() {
  const [list, setList] = useState<W[] | null>(null);
  useEffect(() => { supabase.rpc("rpc_my_watches").then(({ data }) => setList((data as W[]) ?? [])); }, []);
  if (!list || !list.length) return null;
  return (
    <section id="watching">
      <div className="sp-head lb-head"><h2><span className="sr-icon" aria-hidden="true">◎</span>Watching</h2></div>
      <div className="lb-watch">
        {list.slice(0, 30).map((w) => (
          <Link key={w.id} href={`/song/${w.id}`} className="lb-card lb-watch-row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {w.cover ? <img src={thumb(w.cover)} alt="" /> : <span className="lb-watch-blank" />}
            <span className="sp-version-text">
              <strong>{w.title}</strong>
              <span>{w.artist} · {w.status}</span>
            </span>
            <span aria-hidden="true" className="hf-chev">›</span>
          </Link>
        ))}
      </div>
      {list.length > 30 && <p className="sp-sub">And {list.length - 30} more.</p>}
    </section>
  );
}
