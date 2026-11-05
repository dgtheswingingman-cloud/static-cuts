"use client";

// Settings: link your Last.fm username (only you see it) for /listening.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function LastfmLink() {
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("rpc_my_lastfm").then(({ data }) => { setCurrent((data as string | null) ?? null); setDraft((data as string | null) ?? ""); });
  }, []);

  async function save(value: string) {
    setMessage(null);
    const { data, error } = await supabase.rpc("rpc_set_lastfm", { p_username: value });
    if (error) { setMessage(error.message); return; }
    setCurrent((data as string | null) ?? null);
    setDraft((data as string | null) ?? "");
    setMessage(data ? "Linked." : "Unlinked.");
  }

  return (
    <div className="st-conn" id="lastfm">
      <span className="st-logo st-lastfm" aria-hidden="true">as</span>
      <span className="st-conn-text">
        <strong>Last.fm</strong>
        <span>Your most-played songs matched to the archive. Only you see it.{current && <> <Link href="/listening" className="text-link">See your listening →</Link></>}</span>
      </span>
      <span className="st-lastfm-form">
        <input className="st-input" placeholder="Username" value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && draft.trim() && draft.trim() !== current) save(draft); }} aria-label="Last.fm username" />
        {draft.trim() && draft.trim() !== current && <button className="st-btn" onClick={() => save(draft)}>Save</button>}
        {current && draft.trim() === current && <button className="st-btn" onClick={() => save("")}>Unlink</button>}
      </span>
      {message && <div className="st-msg">{message}</div>}
    </div>
  );
}
