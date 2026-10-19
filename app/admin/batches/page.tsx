"use client";

// Undo history: every bulk job (merges, quick merges, Spotify matching, and
// later sub-versions and imports) is recorded as a batch. Each one can be
// looked at and reversed in one go. Rows someone has edited since the batch
// ran are left alone and counted as "skipped".

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";

type Batch = {
  id: string;
  kind: string;
  label: string | null;
  created_at: string;
  created_by_name: string | null;
  changes: number;
  undone_at: string | null;
  undo_skipped: number;
  undo_of: string | null;
  tables: Record<string, number>;
};

type Change = {
  table_name: string;
  op: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  undo_state: string | null;
};

const KIND_LABELS: Record<string, string> = {
  merge: "merge",
  quick_merge: "quick merge",
  spotify_match: "Spotify matching",
  undo: "undo",
  sub_versions: "auto sub-versions",
  import: "import",
  paste: "pasted tracklist",
  tracker: "community tracker",
  "link-check": "dead link check",
};

// Plain-language summary of what a batch touched, e.g. "12 songs changed, 3 removed".
function describe(tables: Record<string, number>) {
  const out: string[] = [];
  const n = (k: string) => tables[k] ?? 0;
  const songs = [["tracks update", "songs changed"], ["tracks insert", "songs added"], ["tracks delete", "songs removed"]];
  for (const [k, label] of songs) if (n(k)) out.push(`${n(k)} ${label}`);
  const other = Object.entries(tables)
    .filter(([k]) => !k.startsWith("tracks "))
    .reduce((sum, [, v]) => sum + v, 0);
  if (other) out.push(`${other} related change${other === 1 ? "" : "s"} (links, ratings, collections, comments…)`);
  return out.join(", ") || "no changes";
}

// One line for a single change, for the "show changes" list.
function changeLine(c: Change) {
  const row = (c.new_row ?? c.old_row ?? {}) as Record<string, unknown>;
  const name = (row.title as string) || (row.track_id as string) || (row.old_track_id as string) || (row.id as string) || "";
  if (c.table_name === "tracks" && c.op === "UPDATE" && c.old_row && c.new_row) {
    const changed = Object.keys(c.new_row).filter(
      (k) => JSON.stringify(c.new_row![k]) !== JSON.stringify(c.old_row![k]) && !k.endsWith("_at")
    );
    const parts = changed.map((k) => `${k}: ${String(c.old_row![k] ?? "—")} → ${String(c.new_row![k] ?? "—")}`);
    return `"${name}" — ${parts.join("; ") || "checked"}`;
  }
  const verb = c.op === "INSERT" ? "added" : c.op === "DELETE" ? "removed" : "changed";
  const what = c.table_name === "tracks" ? "song" : c.table_name.replace(/_/g, " ");
  return `${what} ${verb}: ${name}`;
}

export default function BatchesPage() {
  const { user, loading: authLoading } = useAuth();
  const isRealAdmin = useIsAdmin();
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data, error: err } = await supabase.rpc("admin_list_batches", { p_limit: 100 });
    if (err) { setError(err.message); setBatches([]); return; }
    setError(null);
    setBatches((data as Batch[]) ?? []);
  }

  useEffect(() => {
    if (isRealAdmin) load();
  }, [isRealAdmin]);

  async function toggleChanges(b: Batch) {
    if (openId === b.id) { setOpenId(null); return; }
    setOpenId(b.id);
    setChanges([]);
    const { data } = await supabase.rpc("admin_batch_changes", { p_batch: b.id, p_limit: 100 });
    setChanges((data as Change[]) ?? []);
  }

  async function undo(b: Batch) {
    setConfirmId(null);
    setUndoing(b.id);
    setMessage(null);
    let undone = 0;
    let skipped = 0;
    // Big batches are reversed a chunk at a time.
    for (let i = 0; i < 200; i++) {
      const { data, error: err } = await supabase.rpc("admin_undo_batch", { p_batch: b.id, p_chunk: 400 });
      if (err) { setMessage(`Undo stopped: ${err.message}`); break; }
      const r = data as { undone: number; skipped: number; remaining: number; finished: boolean; stuck: boolean };
      undone += r.undone;
      skipped += r.skipped;
      if (r.finished) {
        setMessage(
          `Undone: ${undone} change${undone === 1 ? "" : "s"} reversed.` +
          (skipped ? ` ${skipped} left alone because they were edited after this batch ran.` : "")
        );
        break;
      }
      if (r.stuck) {
        setMessage(`Undo got stuck with ${r.remaining} changes left that can't be reversed automatically. Nothing else was affected.`);
        break;
      }
    }
    setUndoing(null);
    load();
  }

  if (!isRealAdmin) return <NoAccess loading={authLoading} who="admin" />;

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← home</button>
      <h1 className="detail-name page-title">Undo History</h1>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        Every bulk job is recorded here: merges, quick merges, Spotify matching, and later auto sub-versions and
        imports. Undo reverses the whole job. Anything edited since the job ran is left alone. Undoing is recorded
        too, so an undo can itself be undone. History is kept for 60 days.
      </div>

      {message && <div className="comments-panel" style={{ marginBottom: 16 }}>{message}</div>}
      {error && <div className="comment-meta" style={{ marginBottom: 16 }}>Couldn&apos;t load history: {error}</div>}
      {batches === null && <div className="empty-state">loading…</div>}
      {batches && batches.length === 0 && !error && (
        <div className="empty-state">No bulk jobs yet. They&apos;ll show up here as soon as one runs.</div>
      )}

      {batches?.map((b) => (
        <div key={b.id} style={{ borderTop: "1px solid var(--hair)", padding: "12px 0" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <span className="track-title">{b.label || KIND_LABELS[b.kind] || b.kind}</span>
            <span className="feature-tag">{KIND_LABELS[b.kind] || b.kind}</span>
            {b.undone_at && <span className="feature-tag">undone</span>}
          </div>
          <div className="comment-meta" style={{ marginTop: 4 }}>
            {new Date(b.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
            {b.created_by_name ? ` · ${b.created_by_name}` : ""} · {describe(b.tables)}
            {b.undone_at && ` · undone ${new Date(b.undone_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`}
            {b.undone_at && b.undo_skipped > 0 && ` (${b.undo_skipped} left alone)`}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button className="tab" onClick={() => toggleChanges(b)} disabled={b.changes === 0}>
              {openId === b.id ? "hide changes" : "show changes"}
            </button>
            {!b.undone_at && b.changes > 0 && confirmId !== b.id && (
              <button className="tab" disabled={undoing !== null} onClick={() => setConfirmId(b.id)}>
                {undoing === b.id ? "undoing…" : b.kind === "undo" ? "redo (undo this undo)" : "undo"}
              </button>
            )}
            {confirmId === b.id && (
              <>
                <span className="comment-meta" style={{ alignSelf: "center" }}>
                  Reverse all {b.changes} changes?
                </span>
                <button className="tab active" onClick={() => undo(b)}>yes, undo</button>
                <button className="tab" onClick={() => setConfirmId(null)}>cancel</button>
              </>
            )}
          </div>
          {openId === b.id && (
            <div className="comments-panel" style={{ marginTop: 8, maxHeight: 280, overflowY: "auto", fontSize: "0.75rem" }}>
              {changes.length === 0 && <div className="comments-count">loading…</div>}
              {changes.map((c, i) => (
                <div key={i} className="comment-meta" style={{ padding: "3px 0", opacity: c.undo_state ? 0.6 : 1 }}>
                  {changeLine(c)}
                  {c.undo_state === "skipped" && " (left alone on undo)"}
                </div>
              ))}
              {changes.length === 100 && b.changes > 100 && (
                <div className="comments-count">…showing the first 100 of {b.changes}.</div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
