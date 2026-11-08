"use client";

// Badges next to someone's name: their fan badges (short artist tags like
// CRT or LNLY that link to the artist) and the ◆ supporter badge (premium).
// Badges on one page are looked up together in one call (rpc_user_badges)
// and remembered.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export type Fan = { artist_id: string; name: string; tag: string };
type Badges = { supporter: boolean; fans: Fan[] };

const known = new Map<string, Badges>();
let waiting = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function ask(id: string) {
  if (known.has(id) || waiting.has(id)) return;
  waiting.add(id);
  if (timer) return;
  timer = setTimeout(async () => {
    const ids = [...waiting];
    waiting = new Set();
    timer = null;
    const { data } = await supabase.rpc("rpc_user_badges", { p_ids: ids });
    const got = (data as Record<string, Badges> | null) ?? {};
    for (const i of ids) known.set(i, got[i] ?? { supporter: false, fans: [] });
    listeners.forEach((f) => f());
  }, 40);
}

// After someone changes their own badges.
export function forgetBadges(id: string) {
  known.delete(id);
  ask(id);
}

export function useBadges(id: string | null | undefined): Badges | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!id) return;
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    ask(id);
    return () => { listeners.delete(f); };
  }, [id]);
  return id ? known.get(id) ?? null : null;
}

// Same rule as the database's sc_artist_tag (for previews).
export function artistTag(name: string) {
  const w = name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (!w.length) return "";
  const base = w[w.length - 1];
  if (base.length <= 4 && w.length === 1) return base;
  const squash = (s: string) => s.replace(/(.)\1+/g, "$1");
  let r = squash(base[0] + base.slice(1).replace(/[AEIOU]/g, ""));
  if (r.length < 3) { const all = w.join(""); r = squash(w[0][0] + all.slice(1).replace(/[AEIOU]/g, "")); }
  return r.slice(0, 4);
}

export function FanTag({ fan, big = false }: { fan: Fan; big?: boolean }) {
  const router = useRouter();
  return (
    <span role="link" tabIndex={0} className={`fan-tag${big ? " big" : ""}`} title={`Fan of ${fan.name}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/artist/${fan.artist_id}`); }}
      onKeyDown={(e) => { if (e.key === "Enter") router.push(`/artist/${fan.artist_id}`); }}>
      {fan.tag}
    </span>
  );
}

// full: the profile header version (bigger, "supporter" spelled out).
export default function Supporter({ id, full = false }: { id: string | null | undefined; full?: boolean }) {
  const b = useBadges(id);
  if (!b || (!b.supporter && !b.fans.length)) return null;
  return (
    <span className={`user-badges${full ? " full" : ""}`}>
      {b.fans.map((f) => <FanTag key={f.artist_id} fan={f} big={full} />)}
      {b.supporter && (
        <span className={`supporter-badge${full ? " full" : ""}`} title="Static Cuts supporter">
          ◆{full && <span> supporter</span>}
        </span>
      )}
    </span>
  );
}
