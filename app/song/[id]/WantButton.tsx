"use client";

// "Want this": vote for unreleased songs you want most. The counts make the
// Most Wanted lists.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { usePersonalUser } from "../../useIsAdmin";

export default function WantButton({ trackId, icon = false }: { trackId: string; icon?: boolean }) {
  const user = usePersonalUser();
  const router = useRouter();
  const [state, setState] = useState<{ count: number; wanted: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.rpc("rpc_wanted_state", { p_track_id: trackId }).then(({ data }) => setState(data ?? { count: 0, wanted: false }));
  }, [trackId, user?.id]);

  async function toggle() {
    if (!user) { router.push("/login"); return; }
    setBusy(true);
    const { data } = await supabase.rpc("rpc_toggle_wanted", { p_track_id: trackId });
    setBusy(false);
    if (data) setState(data);
  }

  if (icon) {
    return (
      <button className={`tab sp-icon-btn ${state?.wanted ? "active" : ""}`} disabled={busy} onClick={toggle}
        aria-label={state?.wanted ? "You want this (tap to undo)" : "Want this"} aria-pressed={!!state?.wanted} title="Vote for the unreleased songs you want most">
        <svg viewBox="0 0 24 24" width="22" height="22" fill={state?.wanted ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.7 3.8 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.4 0 5.6 3.2 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4z" />
        </svg>
        {state && state.count > 0 && <span className="sp-icon-count">{state.count}</span>}
      </button>
    );
  }
  return (
    <button className={`tab ${state?.wanted ? "active" : ""}`} disabled={busy} onClick={toggle}
      title="Vote for the unreleased songs you want most">
      {state?.wanted ? "✓ want it" : "want it"}{state && state.count > 0 ? ` · ${state.count}` : ""}
    </button>
  );
}
