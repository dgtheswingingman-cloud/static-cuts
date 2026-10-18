"use client";

// "Remind me" on a song that isn't out yet: a notification when it comes
// out or its status changes.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";

export default function RemindMe({ trackId }: { trackId: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) { setOn(false); return; }
    supabase.from("radar_watches").select("track_id").eq("user_id", user.id).eq("track_id", trackId).maybeSingle()
      .then(({ data }) => setOn(!!data));
  }, [user, trackId]);

  async function toggle() {
    if (!user) { router.push("/login"); return; }
    setBusy(true);
    const { error } = on
      ? await supabase.from("radar_watches").delete().eq("user_id", user.id).eq("track_id", trackId)
      : await supabase.from("radar_watches").insert({ track_id: trackId });
    setBusy(false);
    if (!error) setOn(!on);
  }

  return (
    <button className={`tab ${on ? "active" : ""}`} disabled={busy} onClick={toggle}
      title="Get a notification when it comes out or its status changes">
      {on ? "✓ reminding you" : "remind me"}
    </button>
  );
}
