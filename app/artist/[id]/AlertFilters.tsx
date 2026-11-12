"use client";

// Premium alert filters for an artist you follow on instant alerts: only some
// kinds (leaks / snippets / releases) and/or only some eras. Free accounts
// see what it does and a link to premium.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePremium } from "../../usePremium";

const KINDS: [string, string][] = [["leaked", "Leaks"], ["snippet", "Snippets"], ["released", "Releases"]];

export default function AlertFilters({ artistId, userId }: { artistId: string; userId: string }) {
  const { premium } = usePremium();
  const [kinds, setKinds] = useState<string[] | null>(null);
  const [eras, setEras] = useState<string[]>([]);
  const [allEras, setAllEras] = useState<string[] | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("follows").select("alert_kinds, alert_eras").eq("user_id", userId).eq("artist_id", artistId).maybeSingle()
      .then(({ data }) => {
        const d = data as { alert_kinds: string[] | null; alert_eras: string[] | null } | null;
        setKinds(d?.alert_kinds ?? KINDS.map(([k]) => k));
        setEras(d?.alert_eras ?? []);
      });
  }, [artistId, userId]);

  useEffect(() => {
    if (!premium) return;
    supabase.from("tracks").select("album").eq("artist_id", artistId).is("parent_track_id", null)
      .not("album", "is", null).in("release_status", ["leaked", "snippet", "teased", "announced", "rumored"]).limit(3000)
      .then(({ data }) => {
        const seen = new Map<string, string>();
        for (const r of (data as { album: string }[] | null) ?? []) { const k = r.album.trim(); if (k && !seen.has(k.toLowerCase())) seen.set(k.toLowerCase(), k); }
        setAllEras([...seen.values()].sort((a, b) => a.localeCompare(b)));
      });
  }, [artistId, premium]);

  async function save(k: string[], e: string[]) {
    setKinds(k); setEras(e); setSaved(null);
    const { error } = await supabase.rpc("rpc_set_follow_filters", { p_artist: artistId, p_kinds: k, p_eras: e });
    setSaved(error ? error.message : "Saved");
    setTimeout(() => setSaved(null), 1500);
  }

  if (!premium) {
    return (
      <div className="af-box">
        <strong>Filters</strong>
        <span>Only leaks, only one era, or alerts for a producer. <Link href="/premium" className="text-link">Premium</Link></span>
      </div>
    );
  }
  if (!kinds) return null;
  return (
    <div className="af-box">
      <strong>Only tell me about {saved && <em className="af-saved">{saved}</em>}</strong>
      <div className="af-row">
        {KINDS.map(([k, label]) => (
          <label key={k} className="af-check">
            <input type="checkbox" checked={kinds.includes(k)}
              onChange={(ev) => {
                const next = ev.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k);
                if (next.length) save(next, eras);
              }} /> {label}
          </label>
        ))}
      </div>
      {allEras && allEras.length > 0 && (
        <>
          <strong>From these eras <small>(none ticked = all)</small></strong>
          <div className="af-eras">
            {allEras.map((e) => (
              <label key={e} className="af-check">
                <input type="checkbox" checked={eras.some((x) => x.toLowerCase() === e.toLowerCase())}
                  onChange={(ev) => save(kinds, ev.target.checked ? [...eras, e] : eras.filter((x) => x.toLowerCase() !== e.toLowerCase()))} /> {e}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
