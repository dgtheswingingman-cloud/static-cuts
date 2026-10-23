"use client";

// While the owner runs a big job (Deezer or Genius "extreme"), the site shows a "back
// soon" screen to everyone else. The owner still gets in, with a reminder.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";

type Pause = { paused: boolean; job?: string; until: string | null; owner: boolean };

export default function SitePause({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [p, setP] = useState<Pause | null>(null);
  useEffect(() => {
    if (loading) return;
    const check = () => supabase.rpc("rpc_site_paused").then(({ data }) => setP((data as Pause) ?? null));
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, [loading, user?.id]);

  if (!p?.paused) return <>{children}</>;
  const until = p.until ? new Date(p.until) : null;
  if (p.owner) {
    return (
      <>
        <div className="site-pause-note">
          Site paused for everyone else while {p.job ?? "Deezer"} runs on extreme
          {until ? ` (until ${until.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} at the latest)` : ""}.
          Switch it off in Control room → Owner.
        </div>
        {children}
      </>
    );
  }
  return (
    <div className="wrap site-pause">
      <h1 className="detail-name page-title">Back soon</h1>
      <div className="detail-meta">
        Static Cuts// is filling in thousands of songs right now, so the site is paused for a little while.
        {until ? ` It'll be back by ${until.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} at the latest.` : " It'll be back shortly."}
      </div>
    </div>
  );
}
