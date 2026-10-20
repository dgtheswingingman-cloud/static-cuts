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
import { useIsModerator } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";

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

// Labels that are almost always a real version of the song: a year, or a
// production/edition word. "Freestyle", "Part 2" and plain numbers aren't
// here: those are often different songs.
const LIKELY = /^(\(?\d{4}\)?|.*\b(drums?|orchestral|piano|fx|rehearsals?|edition|nft|session|version|mix|edit|acoustic|instrumental|live|demo|cdq|og|alt|reference|extended|radio|mono|stereo|remaster(ed)?|a cappella|acapella|clean|explicit|sped up|slowed|reverb|leak|snippet|early|final|original)\b.*)$/i;

function labelOf(s: { version: string | null }) {
  return (s.version ?? "").trim() || "no label";
}

const TABS: { key: Suggestion["cls"]; label: string; help: string }[] = [
  { key: "check", label: "check these", help: "The label isn't a clear version tag (a year, Freestyle, a name, Part 2…). Approve the ones that really are versions of the song shown." },
  { key: "cross", label: "other artist's song", help: "Remixes whose original is on another artist's page. Approving puts the remix under the original and keeps it listed on the remixer's page." },
  { key: "dupe", label: "marked dupe", help: "Songs labelled \"Dupe\". Approving merges them into the song shown (ratings, collections and comments move across)." },
];

export default function VersionSuggestionsPage() {
  const { user, loading: authLoading } = useAuth();
  const isRealAdmin = useIsModerator();
  const router = useRouter();
  const [tab, setTab] = useState<Suggestion["cls"]>("check");
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"artist" | "label">("artist");

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
  // Grouped by artist, or by label ("2022 ×28") so a whole kind can be
  // approved in one go. Biggest label groups first.
  const byArtist = useMemo(() => {
    const out: Record<string, Suggestion[]> = {};
    shown.forEach((s) => {
      const k = groupBy === "label" ? labelOf(s) : s.track_artist ?? "?";
      (out[k] = out[k] || []).push(s);
    });
    if (groupBy !== "label") return out;
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])));
  }, [shown, groupBy]);
  const likely = useMemo(() => shown.filter((s) => s.cls === "cross" || s.cls === "dupe" || LIKELY.test(labelOf(s))), [shown]);
  const ordered = useMemo(() => Object.values(byArtist).flat(), [byArtist]);

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
    // Groups of artists per call keeps each one quick.
    const { data: artists } = await supabase.from("artists").select("id");
    const ids = (artists ?? []).map((a: { id: string }) => a.id);
    const size = 50;
    let added = 0;
    for (let i = 0; i < ids.length; i += size) {
      const { data, error: err } = await supabase.rpc("admin_scan_versions", { p_artist_ids: ids.slice(i, i + size) });
      if (err) { setBusy(false); setMessage(`Rescan stopped: ${err.message}`); load(); return; }
      added += (data as number) ?? 0;
      setMessage(`Rescanning… ${Math.min(i + size, ids.length)} of ${ids.length} artists`);
    }
    setBusy(false);
    setMessage(`Rescan done: ${added} new suggestion${added === 1 ? "" : "s"}.`);
    load();
  }

  // One at a time (row buttons): no full reload, it just
  // leaves the list.
  async function quick(kind: "approve" | "dismiss", s: Suggestion) {
    setBusy(true);
    const fn = kind === "approve" ? "admin_apply_version_suggestions" : "admin_dismiss_version_suggestions";
    const { error: err } = await supabase.rpc(fn, { p_ids: [s.id] });
    setBusy(false);
    if (err) { setMessage(`Couldn't ${kind === "approve" ? "approve" : "dismiss"} "${s.track_title}": ${err.message}`); return; }
    setItems((prev) => (prev ?? []).filter((x) => x.id !== s.id));
    setCounts((prev) => ({ ...prev, [s.cls]: Math.max(0, (prev[s.cls] ?? 1) - 1) }));
    setSelected((prev) => { const next = new Set(prev); next.delete(s.id); return next; });
  }


  if (!isRealAdmin) return <NoAccess loading={authLoading} who="moderators" />;
  const help = TABS.find((t) => t.key === tab)?.help;
  const selectedHere = shown.filter((s) => selected.has(s.id)).map((s) => s.id);

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/review")}>← moderation</button>
      <h1 className="detail-name page-title">Sub-versions</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        Clear versions (Live, Demo, Remix, V2, Reference…) are linked under their main song automatically, including
        new songs as they&apos;re added. These are the ones that need a look first. Anything approved can be reversed
        from the <UndoHistoryLink />.
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
        <div className="review-toolbar"><div className="review-toolbar-row">
          <button className="tab" onClick={() => setSelected(new Set(shown.map((s) => s.id)))}>select all</button>
          <button className="tab" onClick={() => setSelected(new Set())}>select none</button>
          <button className="tab" disabled={likely.length === 0} onClick={() => setSelected(new Set(likely.map((s) => s.id)))}
            title="Years, and labels like Drums, Orchestral, Piano, Live, Demo, Edition, Remix">
            select likely ones ({likely.length})
          </button>
          <button className="tab active" disabled={busy || selectedHere.length === 0} onClick={() => run("approve", selectedHere)}>
            {busy ? "working…" : `approve selected (${selectedHere.length})`}
          </button>
          <button className="tab" disabled={busy || selectedHere.length === 0} onClick={() => run("dismiss", selectedHere)}>
            dismiss selected
          </button>
        </div>
        <div className="review-toolbar-row">
          <span className="review-toolbar-label">group by</span>
          <button className={`tab ${groupBy === "artist" ? "active" : ""}`} onClick={() => setGroupBy("artist")}>artist</button>
          <button className={`tab ${groupBy === "label" ? "active" : ""}`} onClick={() => setGroupBy("label")}>label</button>
        </div></div>
      )}

      {Object.keys(byArtist).map((artist) => (
        <div key={artist}>
          <div className="review-group-head">
            <span className="section-label" style={{ margin: 0 }}>{artist} ({byArtist[artist].length})</span>
            <button className="rating-chip" onClick={() => setSelected((prev) => new Set([...prev, ...byArtist[artist].map((s) => s.id)]))}>
              select these
            </button>
          </div>
          {byArtist[artist].map((s) => (
            <div key={s.id} data-row-id={s.id} className="review-row">
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} aria-label={`select ${s.track_title}`} />
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title">
                  <Link href={`/artist/${s.track_artist_id}?highlight=${s.track_id}`}>{s.track_title}</Link>
                </div>
                <div className="review-row-meta">
                  <span>
                    {s.action === "merge" ? "merge into" : "version of"}{" "}
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
                  {groupBy === "label" && s.track_artist && <span>{s.track_artist}</span>}
                </div>
              </div>
              <div className="review-row-actions">
                <button className="rating-chip" disabled={busy} onClick={() => quick("approve", s)}>approve</button>
                <button className="rating-chip" disabled={busy} onClick={() => quick("dismiss", s)}>dismiss</button>
              </div>
            </div>
          ))}
        </div>
      ))}

    </div>
  );
}
