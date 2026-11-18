"use client";

// Sub-versions: how many Claude has checked today against the daily cap,
// and (admins) a button for 500 more today. The cap keeps a big import from
// spending in one go; the rest are checked over the next days.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useIsAdmin } from "../../useIsAdmin";

type Today = { cap: number; checked: number; waiting: number };

export default function ClaudeToday() {
  const isAdmin = useIsAdmin();
  const [t, setT] = useState<Today | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.rpc("admin_version_ai_today").then(({ data }) => setT((data as Today) ?? null));
  }, [isAdmin]);

  if (!isAdmin || !t) return null;
  const full = t.checked >= t.cap;
  return (
    <p className="comment-meta">
      Claude checked {t.checked.toLocaleString("en-GB")} of {t.cap.toLocaleString("en-GB")} today
      {t.waiting > 0 ? ` · ${t.waiting.toLocaleString("en-GB")} waiting` : ""}
      {full && t.waiting > 0 ? " (the rest carry on tomorrow)" : ""}
      {t.waiting > 0 && <> · <button className="inline-link-btn" disabled={busy} onClick={async () => {
        setBusy(true);
        const { data } = await supabase.rpc("admin_version_ai_more", { p_n: 500 });
        setBusy(false);
        if (data) setT(data as Today);
      }}>{busy ? "…" : "check 500 more today"}</button></>}
    </p>
  );
}
