"use client";

// Track Watch: "watch" a song for a notification when its status changes
// (snippet → leaked → released). With premium, also when a new version is
// added, a new link is found, or its release / leak date is filled in.
// (Stored in radar_watches, which the release radar reads too.)

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useIsAdmin, usePersonalUser } from "../../useIsAdmin";
import { usePremium } from "../../usePremium";

export default function RemindMe({ trackId }: { trackId: string }) {
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const { premium } = usePremium();

  useEffect(() => {
    if (!user) { setOn(false); return; }
    supabase.from("radar_watches").select("track_id").eq("user_id", user.id).eq("track_id", trackId).maybeSingle()
      .then(({ data }) => setOn(!!data));
  }, [user, trackId]);

  async function toggle() {
    if (!user) { if (!isAdmin) router.push("/login"); return; }
    setBusy(true);
    const { error } = on
      ? await supabase.from("radar_watches").delete().eq("user_id", user.id).eq("track_id", trackId)
      : await supabase.from("radar_watches").insert({ track_id: trackId });
    setBusy(false);
    if (!error) setOn(!on);
  }

  return (
    <button className={`tab ${on ? "active" : ""}`} disabled={busy} onClick={toggle}
      title={premium ? "Get a notification when its status changes, a new version or link turns up, or its date is filled in"
        : "Get a notification when its status changes (premium: also new versions, links and dates)"}>
      {on ? "✓ watching" : "watch"}
    </button>
  );
}
