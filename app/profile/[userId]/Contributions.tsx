"use client";

// What someone has added to the archive: songs, versions, status updates,
// corrections, ChatGPT finds and confirmations. Only approved work counts.
// Hidden unless they've left "Show my contributions publicly" on (or it's
// their own profile).

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Event = {
  kind: "song" | "version" | "status" | "correction" | "find" | "confirmation";
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
};
const VERB: Record<Event["kind"], string> = {
  song: "added",
  version: "added a version",
  status: "updated the status of",
  correction: "corrected",
  find: "found",
  confirmation: "confirmed",
};

export default function Contributions({ userId }: { userId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    supabase.rpc("rpc_user_contributions", { p_user: userId }).then(({ data: d }) => setData((d as Data) ?? { visible: false }));
  }, [userId]);

  if (!data || !data.visible) return null;
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
              {e.artist_id ? (
                <Link href={`/artist/${e.artist_id}${e.track_id ? `?highlight=${e.track_id}` : ""}`}>{e.title ?? "a song"}</Link>
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
