"use client";

// "Want this": vote for unreleased songs you want most. The counts make the
// Most Wanted lists.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { usePersonalUser } from "../../useIsAdmin";

export default function WantButton({ trackId }: { trackId: string }) {
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

  return (
    <button className={`tab ${state?.wanted ? "active" : ""}`} disabled={busy} onClick={toggle}
      title="Vote for the unreleased songs you want most">
      {state?.wanted ? "✓ want it" : "want it"}{state && state.count > 0 ? ` · ${state.count}` : ""}
    </button>
  );
}
