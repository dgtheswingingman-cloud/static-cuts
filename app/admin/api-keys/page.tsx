"use client";

// API keys: read-only access to the archive for other fan sites and bots.
// Make one per person or project; the key is shown once. Take it back at
// any time.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsOwner } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";

type Key = {
  id: string; name: string; key_hint: string; per_minute: number; per_day: number; created_at: string;
  revoked_at: string | null; last_used_at: string | null; calls_today: number;
};

const BASE = "https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/public-api";

export default function ApiKeysPage() {
  const { loading: authLoading } = useAuth();
  const isAdmin = useIsOwner();
  const router = useRouter();
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [name, setName] = useState("");
  const [perMinute, setPerMinute] = useState(60);
  const [made, setMade] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase.rpc("admin_api_keys");
    if (error) { setMessage(error.message); setKeys([]); return; }
    setKeys((data as Key[]) ?? []);
  }
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  async function create() {
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.rpc("admin_create_api_key", { p_name: name, p_per_minute: perMinute, p_per_day: 5000 });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setMade((data as { key: string }).key);
    setName("");
    load();
  }

  async function revoke(k: Key) {
    if (!confirm(`Take back the key for ${k.name}? Anything using it stops working.`)) return;
    await supabase.rpc("admin_revoke_api_key", { p_id: k.id });
    load();
  }

  if (!isAdmin) return <NoAccess loading={authLoading} who="owner" />;

  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <button className="back-btn" onClick={() => router.push("/control?tab=owner")}>← control room</button>
      <h1 className="detail-name page-title">API Keys</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        Read-only access to the archive for other fan sites and bots. Make one key per person or project. Each key
        has its own limit, and answers always ask them to credit Static Cuts.
      </div>
      {message && <div className="comments-panel" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="review-toolbar">
        <div className="review-toolbar-row">
          <input className="search-input" style={{ flex: "1 1 220px" }} placeholder="Who it's for (e.g. Carti Discord bot)"
            value={name} onChange={(e) => setName(e.target.value)} />
          <select className="sort-select" value={perMinute} onChange={(e) => setPerMinute(Number(e.target.value))} aria-label="Calls a minute">
            {[30, 60, 120].map((n) => <option key={n} value={n}>{n} calls a minute</option>)}
          </select>
          <button className="tab active" disabled={busy || !name.trim()} onClick={create}>make key</button>
        </div>
      </div>
      {made && (
        <div className="comments-panel" style={{ marginBottom: 16, overflowWrap: "anywhere" }}>
          Here&apos;s the key. Copy it now: it won&apos;t be shown again.
          <div style={{ fontFamily: "monospace", marginTop: 8 }}>{made}</div>
        </div>
      )}

      <div className="section-label">Keys</div>
      {keys === null && <div className="empty-state">loading…</div>}
      {keys && keys.length === 0 && <div className="comment-meta">None yet.</div>}
      {keys?.map((k) => (
        <div key={k.id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", opacity: k.revoked_at ? 0.5 : 1 }}>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">{k.name}</div>
            <div className="review-row-meta">
              <span>…{k.key_hint}</span>
              <span>{k.per_minute}/min, {k.per_day.toLocaleString("en-GB")}/day</span>
              <span>{Number(k.calls_today).toLocaleString("en-GB")} calls today</span>
              {k.revoked_at && <span>taken back</span>}
            </div>
          </div>
          {!k.revoked_at && <button className="rating-chip danger" onClick={() => revoke(k)}>take back</button>}
        </div>
      ))}

      <div className="section-label">How to use it (send this to them)</div>
      <pre className="comments-panel" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.8rem" }}>{`Send the key in an "x-api-key" header. Read-only, JSON.

${BASE}?path=/artists            every artist
${BASE}?path=/artists/<id>       an artist and all their songs
${BASE}?path=/songs/<id>         a song and its versions
${BASE}?path=/search&q=<words>   search songs

Please credit and link Static Cuts (static-cuts.com) wherever the data shows.`}</pre>
    </div>
  );
}
