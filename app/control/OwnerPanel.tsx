"use client";

// Owner tab: the list of sites that host leaked files. Links to them are kept
// privately (only the owner sees them, on the song page) and never shown as
// a listen link or offered for votes.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Host = { host: string; links: number; added_at: string };

export default function OwnerPanel() {
  const [hosts, setHosts] = useState<Host[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.rpc("owner_leak_hosts");
    if (error) { setMessage(error.message); return; }
    setHosts((data as Host[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function set(host: string, on: boolean) {
    if (!on && !confirm(`Stop treating ${host} as a leak site? Links already made private stay private.`)) return;
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.rpc("owner_set_leak_host", { p_host: host, p_on: on });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    if (on) {
      setDraft("");
      setMessage(typeof data === "number" && data > 0 ? `Done: ${data} existing link${data === 1 ? "" : "s"} made private.` : "Added.");
    }
    load();
  }

  return (
    <>
      <div className="section-label">Leak file links</div>
      <div className="comment-meta" style={{ marginBottom: 10 }}>
        Links to these sites never show as a listen link. They&apos;re kept on the song privately: only you see them, on
        the song page. Everyone else sees &ldquo;a file of this song is known to exist&rdquo;. New ones from trackers,
        ChatGPT or suggestions are caught automatically.
      </div>
      {message && <div className="comments-panel" style={{ marginBottom: 10 }}>{message}</div>}
      {!hosts && <div className="empty-state">loading…</div>}
      {hosts?.map((h) => (
        <div key={h.host} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">{h.host}</div>
            <div className="review-row-meta"><span>{h.links.toLocaleString("en-GB")} private link{h.links === 1 ? "" : "s"}</span></div>
          </div>
          <button className="rating-chip danger" disabled={busy} onClick={() => set(h.host, false)}>remove</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 10, maxWidth: 480 }}>
        <input className="search-input" style={{ flex: 1 }} placeholder="Add a site, e.g. example.com" value={draft}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) set(draft, true); }} />
        <button className="tab active" disabled={busy || !draft.trim()} onClick={() => set(draft, true)}>add</button>
      </div>
    </>
  );
}
