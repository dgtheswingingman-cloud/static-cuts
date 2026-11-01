"use client";

// Owner: who has premium (Local Cuts). Given by hand for now; payments later.
// Optional end date (e.g. a free month) and a private note.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Person = { user_id: string; name: string; joined: string; premium: boolean; until: string | null; note: string | null };

export default function PremiumPanel() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.rpc("owner_premium_list");
    if (error) { setMessage(error.message); return; }
    setPeople((data as Person[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function set(p: Person, on: boolean, until: string | null) {
    setBusy(p.user_id); setMessage(null);
    const { error } = await supabase.rpc("owner_set_premium", { p_user: p.user_id, p_on: on, p_until: until, p_note: null });
    setBusy(null);
    if (error) { setMessage(error.message); return; }
    load();
  }
  const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  return (
    <>
      <div className="section-label">Premium</div>
      <div className="comment-meta" style={{ marginBottom: 10 }}>
        Premium unlocks Local Cuts: tidying files for Spotify, the player, collecting from files and asking Claude.
        &ldquo;Help the archive&rdquo; stays free. You always have it. Give it to people here until payments are set up.
      </div>
      {message && <div className="comments-panel" style={{ marginBottom: 10 }}>{message}</div>}
      {!people && <div className="empty-state">loading…</div>}
      {people?.length === 0 && <div className="empty-state">No one else has an account yet.</div>}
      {people?.map((p) => (
        <div key={p.user_id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">
              {p.name}
              {p.premium && <span className="feature-tag" style={{ marginLeft: 6 }}>premium{p.until ? ` until ${new Date(p.until).toLocaleDateString("en-GB")}` : ""}</span>}
              {!p.premium && p.until && <span className="comment-meta"> · premium ended {new Date(p.until).toLocaleDateString("en-GB")}</span>}
            </div>
            <div className="review-row-meta"><span>joined {new Date(p.joined).toLocaleDateString("en-GB")}</span></div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {p.premium ? (
              <button className="mod-btn danger" disabled={busy === p.user_id} onClick={() => confirm(`Take premium away from ${p.name}?`) && set(p, false, null)}>take away</button>
            ) : (
              <>
                <button className="mod-btn approve" disabled={busy === p.user_id} onClick={() => set(p, true, null)}>give premium</button>
                <button className="mod-btn plain" disabled={busy === p.user_id} onClick={() => set(p, true, inDays(30))}>free month</button>
              </>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
