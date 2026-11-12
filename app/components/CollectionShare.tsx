"use client";

// Collection share cards outside "What you're missing": the whole
// collection (My Library header) and one artist (artist pages). They only
// show when you're logged in and have something to share.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fileSafe } from "@/lib/csv";
import CardButton from "./CardButton";
import { artistCard, overviewCard, useWho, type Row } from "./Missing";

// "Share my collection//": every artist you have 3+ songs of.
export function ShareMyCollection({ className = "tab", refresh = 0 }: { className?: string; refresh?: number }) {
  const who = useWho();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!who) return;
    let live = true;
    supabase.rpc("rpc_collection_missing").then(({ data }) => { if (live) setRows((data as Row[]) ?? []); });
    return () => { live = false; };
  }, [who, refresh]);
  if (!who || !rows?.length) return null;
  return (
    <CardButton className={className} fileName="static-cuts-my-collection" title="My collection on Static-Cuts//"
      label="Share my collection//" makeKey={`${who.id}:${rows.length}:${rows.reduce((a, r) => a + r.have, 0)}`}
      make={() => overviewCard(rows, who)} />
  );
}

// "My <artist> card": only when you have 3+ of their songs.
export function MyArtistCard({ artistId, name, className = "tab" }: { artistId: string; name: string; className?: string }) {
  const who = useWho();
  const [row, setRow] = useState<Row | null>(null);
  useEffect(() => {
    if (!who) return;
    let live = true;
    setRow(null);
    supabase.rpc("rpc_my_artist_collection", { p_artist: artistId }).then(({ data }) => { if (live) setRow((data as Row | null) ?? null); });
    return () => { live = false; };
  }, [who, artistId]);
  if (!who || !row) return null;
  return (
    <CardButton className={className} fileName={`static-cuts-${fileSafe(name)}-collection`} title={`My ${name} on Static-Cuts//`}
      label={`My ${name} card//`} makeKey={`${artistId}:${row.have}:${row.total}:${who.name}`}
      make={() => artistCard(row, who)} />
  );
}
