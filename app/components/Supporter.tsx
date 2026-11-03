"use client";

// The supporter badge (premium) next to someone's name. Badges on one page
// are looked up together in one call (rpc_supporters) and remembered.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const known = new Map<string, boolean>();
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
    const { data } = await supabase.rpc("rpc_supporters", { p_ids: ids });
    const yes = new Set((data as string[] | null) ?? []);
    for (const i of ids) known.set(i, yes.has(i));
    listeners.forEach((f) => f());
  }, 40);
}

export function useSupporter(id: string | null | undefined) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!id) return;
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    ask(id);
    return () => { listeners.delete(f); };
  }, [id]);
  return !!id && known.get(id) === true;
}

export default function Supporter({ id, full = false }: { id: string | null | undefined; full?: boolean }) {
  const on = useSupporter(id);
  if (!on) return null;
  return (
    <span className={`supporter-badge${full ? " full" : ""}`} title="Static Cuts supporter">
      ◆{full && <span> supporter</span>}
    </span>
  );
}
