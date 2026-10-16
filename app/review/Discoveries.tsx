"use client";

// Findings reported by users' ChatGPT routines. Duplicates are already merged
// in the database (one row per song + status, with every distinct source
// listed). "Promote" turns one into a normal pending submission below;
// "dismiss" drops it.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Evidence = {
  source_url: string;
  source_layer: string | null;
  official_listening_url: string | null;
  unofficial_listening_url: string | null;
  notes: string | null;
  created_at: string;
};

type Discovery = {
  id: string;
  artist_id: string;
  matched_track_id: string | null;
  title: string;
  version_hint: string | null;
  development_type: string;
  official_status: string | null;
  from_status: string | null;
  to_status: string | null;
  release_date: string | null;
  confidence: number | null;
  corroboration_count: number;
  first_seen_at: string;
  last_seen_at: string;
  artists: { name: string } | null;
  discovery_evidence: Evidence[];
};

const LAYER_LABEL: Record<string, string> = {
  official: "official",
  database: "database/press",
  community: "community",
};

export default function Discoveries({ onPromoted }: { onPromoted: () => void }) {
  const [items, setItems] = useState<Discovery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  async function load() {
    const { data, error: err } = await supabase
      .from("discoveries")
      .select(
        "id, artist_id, matched_track_id, title, version_hint, development_type, official_status, from_status, to_status, release_date, confidence, corroboration_count, first_seen_at, last_seen_at, artists!artist_id(name), discovery_evidence(source_url, source_layer, official_listening_url, unofficial_listening_url, notes, created_at)"
      )
      .eq("state", "open")
      .order("corroboration_count", { ascending: false })
      .order("last_seen_at", { ascending: false })
      .limit(200);
    if (err) {
      // Table not there yet (migration not run) or no access: stay quiet.
      setError(err.message);
      setItems([]);
      return;
    }
    setError(null);
    setItems((data as any) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function promote(d: Discovery) {
    const note = window.prompt("Promote to the review queue. Add a note? (optional)");
    if (note === null) return;
    setBusyId(d.id);
    const { error: err } = await supabase.rpc("promote_discovery", { p_discovery_id: d.id, p_note: note || null });
    setBusyId(null);
    if (err) { alert(err.message); return; }
    load();
    onPromoted();
  }

  async function dismiss(d: Discovery) {
    const note = window.prompt("Dismiss this finding. Reason? (optional)");
    if (note === null) return;
    setBusyId(d.id);
    const { error: err } = await supabase.rpc("dismiss_discovery", { p_discovery_id: d.id, p_note: note || null });
    setBusyId(null);
    if (err) { alert(err.message); return; }
    load();
  }

  if (items === null) return null;
  if (error) {
    return (
      <div className="comment-meta" style={{ margin: "8px 0 18px" }}>
        Routine discoveries unavailable: {error}
      </div>
    );
  }
  if (items.length === 0) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      <div className="section-label">Routine discoveries ({items.length})</div>
      <div className="comment-meta" style={{ margin: "2px 0 8px", fontStyle: "italic" }}>
        Found by users&apos; ChatGPT routines. Nothing here is live. Promote to send it to the queue below.
      </div>
      {items.map((d) => {
        const title = d.version_hint ? `${d.title} (${d.version_hint})` : d.title;
        const isChange = !!d.matched_track_id;
        const evidence = [...(d.discovery_evidence ?? [])].sort((a, b) => {
          const rank = (l: string | null) => (l === "official" ? 0 : l === "database" ? 1 : 2);
          return rank(a.source_layer) - rank(b.source_layer);
        });
        const shown = open[d.id] ? evidence : evidence.slice(0, 2);
        return (
          <div key={d.id} className="track-row" style={{ cursor: "default", flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="track-title" style={{ marginBottom: 4 }}>
                {isChange ? "Status change" : "New"}: &quot;{title}&quot;
                <span className="comment-meta"> · {d.artists?.name ?? d.artist_id}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                <span className="feature-tag">{d.development_type.toLowerCase().replace(/_/g, " ")}</span>
                {isChange && d.to_status && (
                  <span className="feature-tag">{d.from_status ?? "?"} → {d.to_status}</span>
                )}
                {d.official_status && <span className="feature-tag">{d.official_status}</span>}
                <span className="feature-tag">
                  {d.corroboration_count} contributor{d.corroboration_count === 1 ? "" : "s"}
                </span>
                {d.confidence !== null && <span className="feature-tag">confidence {Math.round(d.confidence * 100)}%</span>}
                {d.release_date && <span className="feature-tag">release {d.release_date}</span>}
              </div>
              {shown.map((e) => (
                <div key={e.source_url} className="comment-meta" style={{ marginTop: 2, wordBreak: "break-all" }}>
                  <b style={{ color: "var(--bone)" }}>{LAYER_LABEL[e.source_layer ?? ""] ?? "source"}:</b>{" "}
                  <a href={e.source_url} target="_blank" rel="noopener noreferrer">{e.source_url}</a>
                  {e.official_listening_url && (
                    <> · <a href={e.official_listening_url} target="_blank" rel="noopener noreferrer">listen (official)</a></>
                  )}
                  {e.unofficial_listening_url && (
                    <> · <a href={e.unofficial_listening_url} target="_blank" rel="noopener noreferrer">listen (unofficial)</a></>
                  )}
                  {e.notes && <div style={{ marginTop: 1, fontStyle: "italic" }}>{e.notes}</div>}
                </div>
              ))}
              {evidence.length > 2 && (
                <button
                  className="back-btn"
                  style={{ marginTop: 4, padding: 0 }}
                  onClick={() => setOpen((p) => ({ ...p, [d.id]: !p[d.id] }))}
                >
                  {open[d.id] ? "show fewer sources" : `show all ${evidence.length} sources`}
                </button>
              )}
              <div className="comment-meta" style={{ marginTop: 4 }}>
                first seen {new Date(d.first_seen_at).toLocaleString()}
                {d.last_seen_at !== d.first_seen_at && <> · last seen {new Date(d.last_seen_at).toLocaleString()}</>}
              </div>
            </div>
            {isChange && (
              <Link
                href={`/artist/${d.artist_id}?highlight=${d.matched_track_id}`}
                className="listen-link"
                style={{ textDecoration: "none" }}
              >
                view track
              </Link>
            )}
            <button className="listen-link" disabled={busyId === d.id} onClick={() => promote(d)}>promote</button>
            <button className="listen-link" disabled={busyId === d.id} onClick={() => dismiss(d)}>dismiss</button>
          </div>
        );
      })}
    </div>
  );
}
