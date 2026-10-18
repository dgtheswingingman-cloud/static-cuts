"use client";

// Sub-versions to check: songs that look like a version of another song but
// weren't linked automatically, because the label isn't clear (Freestyle, a
// year, a name...), the original is on another artist's page (remixes), or
// the copy is marked "Dupe". Approve links them (or merges the dupe);
// dismiss leaves them as they are and they won't be suggested again.
// Everything approved here can be reversed from the undo history.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsRealAdmin } from "../../useIsAdmin";

type Suggestion = {
  id: string;
  cls: "sure" | "check" | "cross" | "dupe";
  action: "link" | "create_parent" | "merge";
  version: string | null;
  track_id: string;
  track_title: string;
  track_status: string | null;
  track_artist_id: string;
  track_artist: string | null;
  parent_track_id: string | null;
  parent_title: string | null;
  parent_artist: string | null;
  create_parent_title: string | null;
};

const TABS: { key: Suggestion["cls"]; label: string; help: string }[] = [
  { key: "check", label: "check these", help: "The label isn't a clear version tag (a year, Freestyle, a name, Part 2…). Approve the ones that really are versions of the song shown." },
  { key: "cross", label: "other artist's song", help: "Remixes whose original is on another artist's page. Approving puts the remix under the original and keeps it listed on the remixer's page." },
  { key: "dupe", label: "marked dupe", help: "Songs labelled \"Dupe\". Approving merges them into the song shown (ratings, collections and comments move across)." },
];

export default function VersionSuggestionsPage() {
  const { user, loading: authLoading } = useAuth();
  const isRealAdmin = useIsRealAdmin();
  const router = useRouter();
  const [tab, setTab] = useState<Suggestion["cls"]>("check");
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && (!user || !isRealAdmin)) router.push("/");
  }, [authLoading, user, isRealAdmin, router]);

  async function load() {
    const { data, error: err } = await supabase.rpc("admin_version_suggestions", { p_cls: null, p_limit: 2000 });
    if (err) { setError(err.message); setItems([]); return; }
    setError(null);
    const all = (data as Suggestion[]) ?? [];
    const c: Record<string, number> = {};
    all.forEach((s) => { c[s.cls] = (c[s.cls] ?? 0) + 1; });
    setCounts(c);
    setItems(all);
    setSelected(new Set());
  }

  useEffect(() => {
    if (isRealAdmin) load();
  }, [isRealAdmin]);

  const shown = useMemo(() => (items ?? []).filter((s) => s.cls === tab), [items, tab]);
  const byArtist = useMemo(() => {
    const out: Record<string, Suggestion[]> = {};
    shown.forEach((s) => { (out[s.track_artist ?? "?"] = out[s.track_artist ?? "?"] || []).push(s); });
    return out;
  }, [shown]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function run(kind: "approve" | "dismiss", ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    setMessage(null);
    let done = 0;
    // Small chunks keep each database call short.
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const fn = kind === "approve" ? "admin_apply_version_suggestions" : "admin_dismiss_version_suggestions";
      const { data, error: err } = await supabase.rpc(fn, { p_ids: chunk });
      if (err) { setMessage(`Stopped: ${err.message}`); break; }
      done += (data as number) ?? 0;
    }
    setBusy(false);
    if (kind === "approve") setMessage(`${done} approved. You can reverse this from the undo history.`);
    else setMessage(`${done} dismissed. They won't be suggested again.`);
    load();
  }

  async function rescan() {
    setBusy(true);
    setMessage(null);
    // A few artists per call keeps each one quick.
    const { data: artists } = await supabase.from("artists").select("id");
    const ids = (artists ?? []).map((a: { id: string }) => a.id);
    let added = 0;
    for (let i = 0; i < ids.length; i += 20) {
      const { data, error: err } = await supabase.rpc("admin_scan_versions", { p_artist_ids: ids.slice(i, i + 20) });
      if (err) { setBusy(false); setMessage(`Rescan stopped: ${err.message}`); load(); return; }
      added += (data as number) ?? 0;
      setMessage(`Rescanning… ${Math.min(i + 20, ids.length)} of ${ids.length} artists`);
    }
    setBusy(false);
    setMessage(`Rescan done: ${added} new suggestion${added === 1 ? "" : "s"}.`);
    load();
  }

  if (!isRealAdmin) return null;
  const help = TABS.find((t) => t.key === tab)?.help;
  const selectedHere = shown.filter((s) => selected.has(s.id)).map((s) => s.id);

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/review")}>← back to review</button>
      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>Sub-versions</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        Clear versions (Live, Demo, Remix, V2, Reference…) are linked under their main song automatically, including
        new songs as they&apos;re added. These are the ones that need a look first.{" "}
        <Link href="/admin/batches" className="listen-link">undo history</Link>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? "active" : ""}`} onClick={() => { setTab(t.key); setSelected(new Set()); }}>
            {t.label} ({counts[t.key] ?? 0})
          </button>
        ))}
        <button className="tab" disabled={busy} onClick={rescan} title="Look for new suggestions across every artist">
          rescan
        </button>
      </div>

      {help && <div className="comment-meta" style={{ marginBottom: 12 }}>{help}</div>}
      {message && <div className="comments-panel" style={{ marginBottom: 12 }}>{message}</div>}
      {error && <div className="comment-meta" style={{ marginBottom: 12 }}>Couldn&apos;t load suggestions: {error}</div>}
      {items === null && <div className="empty-state">loading…</div>}
      {items && shown.length === 0 && !error && <div className="empty-state">Nothing to check here.</div>}

      {shown.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, position: "sticky", top: 0, background: "var(--bg, inherit)", padding: "6px 0", zIndex: 2 }}>
          <button className="tab" onClick={() => setSelected(new Set(shown.map((s) => s.id)))}>select all</button>
          <button className="tab" onClick={() => setSelected(new Set())}>select none</button>
          <button className="tab active" disabled={busy || selectedHere.length === 0} onClick={() => run("approve", selectedHere)}>
            {busy ? "working…" : `approve selected (${selectedHere.length})`}
          </button>
          <button className="tab" disabled={busy || selectedHere.length === 0} onClick={() => run("dismiss", selectedHere)}>
            dismiss selected
          </button>
        </div>
      )}

      {Object.keys(byArtist).map((artist) => (
        <div key={artist} style={{ marginBottom: 14 }}>
          <div className="section-label">{artist}</div>
          {byArtist[artist].map((s) => (
            <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "4px 0", flexWrap: "wrap" }}>
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} aria-label={`select ${s.track_title}`} />
              <Link href={`/artist/${s.track_artist_id}?highlight=${s.track_id}`} className="comment-body" style={{ color: "var(--bone)" }}>
                {s.track_title}
              </Link>
              <span className="comment-meta">
                {s.action === "merge" ? "merge into" : "→ version of"}{" "}
                {s.parent_track_id ? (
                  <>
                    <strong>{s.parent_title}</strong>
                    {s.parent_artist && s.parent_artist !== s.track_artist ? ` (${s.parent_artist})` : ""}
                  </>
                ) : (
                  <strong>{s.create_parent_title} (new main song)</strong>
                )}
              </span>
              {s.version && <span className="feature-tag">{s.version}</span>}
              <span style={{ display: "inline-flex", gap: 6 }}>
                <button className="rating-chip" disabled={busy} onClick={() => run("approve", [s.id])}>approve</button>
                <button className="rating-chip" disabled={busy} onClick={() => run("dismiss", [s.id])}>dismiss</button>
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
