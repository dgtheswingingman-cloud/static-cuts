"use client";

// What someone has added to the archive: songs, versions, status updates,
// corrections, ChatGPT finds and confirmations. Only approved work counts.
// Hidden unless they've left "Show my contributions publicly" on (or it's
// their own profile).

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Event = {
  kind: "song" | "version" | "status" | "correction" | "find" | "confirmation" | "import_song" | "import_version" | "detail";
  at: string;
  track_id: string | null;
  title: string | null;
  artist_id: string | null;
  artist_name: string | null;
};
type Data = { visible: boolean; total?: number; totals?: Partial<Record<Event["kind"], number>>; recent?: Event[] };

export const KIND_LABELS: Record<Event["kind"], [string, string]> = {
  song: ["song added", "songs added"],
  version: ["version added", "versions added"],
  status: ["status update", "status updates"],
  correction: ["correction", "corrections"],
  find: ["find", "finds"],
  confirmation: ["confirmation", "confirmations"],
  import_song: ["song imported", "songs imported"],
  import_version: ["version imported", "versions imported"],
  detail: ["song detail filled", "song details filled"],
};
const VERB: Record<Event["kind"], string> = {
  song: "added",
  version: "added a version",
  status: "updated the status of",
  correction: "corrected",
  find: "found",
  confirmation: "confirmed",
  import_song: "imported",
  import_version: "imported a version of",
  detail: "filled in details for",
};

const ICON: Record<Event["kind"], string> = { song: "⊕", version: "⧉", status: "↻", correction: "✎", find: "✦", confirmation: "✓", import_song: "⊕", import_version: "⧉", detail: "✎" };
const TITLE: Record<Event["kind"], string> = { song: "Added a song", version: "Added a version", status: "Updated a status", correction: "Edited song details", find: "New find", confirmation: "Confirmed a find", import_song: "Imported a song", import_version: "Imported a version", detail: "Filled in details" };
function ago(at: string) {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(at)) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// "activity": just the latest things they did, as rows (profile Activity tab).
export default function Contributions({ userId, mode = "full", limit = 6 }: { userId: string; mode?: "full" | "activity"; limit?: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    supabase.rpc("rpc_user_contributions", { p_user: userId }).then(({ data: d }) => setData((d as Data) ?? { visible: false }));
  }, [userId]);

  if (!data || !data.visible) return null;
  if (mode === "activity") {
    const recent = (data.recent ?? []).slice(0, limit);
    if (recent.length === 0) return <div className="comment-meta" style={{ padding: 12 }}>No activity yet.</div>;
    return (
      <div className="sp-versions">
        {recent.map((e, i) => (
          <Link key={i} href={e.track_id ? `/song/${e.track_id}` : e.artist_id ? `/artist/${e.artist_id}` : "#"} className="pf-act">
            <span className="pf-act-icon" aria-hidden="true">{ICON[e.kind]}</span>
            <span className="sp-version-text">
              <span className="pf-act-title">{TITLE[e.kind]}</span>
              <span className="sp-sub">{[e.artist_name, e.title].filter(Boolean).join(" — ")}</span>
            </span>
            <span className="hf-when">{ago(e.at)}</span>
          </Link>
        ))}
      </div>
    );
  }
  const totals = data.totals ?? {};
  const kinds = (Object.keys(KIND_LABELS) as Event["kind"][]).filter((k) => (totals[k] ?? 0) > 0);

  return (
    <div style={{ marginBottom: 18 }}>
      <div
        className="section-label"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
        onClick={() => setOpen(!open)}
      >
        <span>Contributions ({data.total ?? 0})</span>
        <button className="tab" style={{ padding: "3px 10px", fontSize: "0.62rem" }}>{open ? "hide" : "show"}</button>
      </div>
      {(data.total ?? 0) === 0 ? (
        <div className="comment-meta" style={{ marginBottom: 10 }}>
          Nothing yet. Songs you suggest, finds your ChatGPT routine sends and imports you run show up here once they&apos;re
          added.
        </div>
      ) : (
        <div className="health-tiles">
          {kinds.map((k) => (
            <div key={k} className="health-tile">
              <div className="health-tile-value">{(totals[k] ?? 0).toLocaleString("en-GB")}</div>
              <div className="health-tile-label">{KIND_LABELS[k][(totals[k] ?? 0) === 1 ? 0 : 1]}</div>
            </div>
          ))}
        </div>
      )}
      {open && (data.recent ?? []).map((e, i) => (
        <div key={i} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">
              {VERB[e.kind]}{" "}
              {e.track_id ? (
                <Link href={`/song/${e.track_id}`}>{e.title ?? "a song"}</Link>
              ) : e.artist_id ? (
                <Link href={`/artist/${e.artist_id}`}>{e.title ?? "a song"}</Link>
              ) : (e.title ?? "a song")}
            </div>
            {e.artist_name && <div className="review-row-meta"><span>{e.artist_name}</span></div>}
          </div>
          <span className="comment-meta">{new Date(e.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
        </div>
      ))}
    </div>
  );
}
