"use client";

// Producer alerts (premium): a notification when a new leak, snippet or
// release credits this producer, whoever the artist is.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { usePersonalUser } from "../../useIsAdmin";
import { usePremium } from "../../usePremium";

export default function ProducerAlert({ name }: { name: string }) {
  const user = usePersonalUser();
  const { premium } = usePremium();
  const router = useRouter();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!user) return;
    supabase.rpc("rpc_my_producer_alerts").then(({ data }) =>
      setOn(((data as string[] | null) ?? []).some((p) => p.toLowerCase() === name.toLowerCase())));
  }, [user, name]);

  async function toggle() {
    if (!user) { router.push("/login"); return; }
    if (!premium && !on) { router.push("/premium"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("rpc_producer_alert", { p_producer: name, p_on: !on });
    setBusy(false);
    if (!error) setOn(!on);
  }
  return (
    <button className={`tab ${on ? "active" : ""}`} disabled={busy} onClick={toggle}
      title={premium ? "A notification when a new leak, snippet or release is produced by them" : "Premium: alerts for a producer's new songs"}>
      {on ? "✓ Producer alerts on" : premium ? "🔔 Alert me" : "🔔 Alert me (premium)"}
    </button>
  );
}
