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
    <>
      <div className="section-label" id="lastfm">Last.fm</div>
      <div className="comments-panel">
        <div className="comment-meta" style={{ marginBottom: 10 }}>
          Link your Last.fm username to see your most-played songs and artists matched to the archive, and collect or
          follow them in one tap. Only you can see it.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 480 }}>
          <input className="search-input" style={{ flex: 1 }} placeholder="Your Last.fm username" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="tab active" disabled={!draft.trim() || draft.trim() === current} onClick={() => save(draft)}>save</button>
          {current && <button className="tab" onClick={() => save("")}>unlink</button>}
        </div>
        {current && <div className="comment-meta" style={{ marginTop: 8 }}><Link href="/listening" className="text-link">See your listening →</Link></div>}
        {message && <div className="comment-meta" style={{ marginTop: 8 }}>{message}</div>}
      </div>
    </>
  );
}
