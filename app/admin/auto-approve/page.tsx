"use client";

// Rules for approving ChatGPT finds without waiting for review, and a log
// of what they've approved. Every auto-approval can be undone from the undo
// history.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsRealAdmin } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";

type Settings = {
  enabled: boolean;
  spotify_releases: boolean;
  min_confirmations: number;
  trusted_min_approved: number;
  trusted_max_dismissed_pct: number;
  link_votes: number;
  updated_at: string;
  recent_links: { at: string; label: string; undone: boolean }[];
  waiting: number;
  recent: { at: string; title: string; artist_id: string; artist: string | null; status: string | null; reason: string }[];
};

export default function AutoApprovePage() {
  const { user, loading: authLoading } = useAuth();
  const isRealAdmin = useIsRealAdmin();
  const router = useRouter();
  const [s, setS] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Partial<Settings>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.rpc("admin_auto_approve_settings");
    if (error) { setMessage(error.message); return; }
    setS(data as Settings);
    setDraft({});
  }

  useEffect(() => {
    if (isRealAdmin) load();
  }, [isRealAdmin]);

  async function save() {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.rpc("admin_set_auto_approve", { p: draft });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setMessage("Saved.");
    load();
  }

  async function applyNow() {
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.rpc("admin_auto_approve_waiting");
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setMessage(`${data ?? 0} waiting find${data === 1 ? "" : "s"} approved by the rules.`);
    load();
  }

  if (!isRealAdmin) return <NoAccess loading={authLoading} who="admin" />;
  const v = { ...s, ...draft } as Settings;
  const changed = Object.keys(draft).length > 0;

  return (
    <div className="wrap" style={{ maxWidth: 680 }}>
      <button className="back-btn" onClick={() => router.push("/review")}>← review</button>
      <h1 className="detail-name page-title">Auto-approve</h1>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        ChatGPT finds that match a rule below are added straight away instead of waiting in the review queue.
        Rumours, takedowns and songs with an open takedown request always wait for you. Each one is a separate
        entry in the <UndoHistoryLink />, so a bad one is one
        click to reverse.
      </div>

      {!s && !message && <div className="empty-state">loading…</div>}
      {message && <div className="comments-panel" style={{ marginBottom: 14 }}>{message}</div>}

      {s && (
        <>
          <div className="comments-panel" style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
            <label className="comment-body" style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input id="aa-enabled" type="checkbox" checked={v.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
              <strong>Auto-approve is {v.enabled ? "on" : "off"}</strong>
            </label>

            <div style={{ opacity: v.enabled ? 1 : 0.5, display: "flex", flexDirection: "column", gap: 14 }}>
              <label className="comment-body" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <input id="aa-spotify" type="checkbox" checked={v.spotify_releases} disabled={!v.enabled}
                  onChange={(e) => setDraft({ ...draft, spotify_releases: e.target.checked })} />
                <span>
                  Official releases with a Spotify link
                  <div className="comment-meta">A find marked released that includes a Spotify track link.</div>
                </span>
              </label>

              <div className="comment-body">
                Confirmed by at least{" "}
                <select id="aa-confirm" className="sort-select" disabled={!v.enabled} value={v.min_confirmations}
                  onChange={(e) => setDraft({ ...draft, min_confirmations: Number(e.target.value) })}>
                  <option value={0}>off</option>
                  {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>{" "}
                different people
                <div className="comment-meta">Several people&apos;s ChatGPT routines reported the same thing separately.</div>
              </div>

              <div className="comment-body">
                Found by a trusted contributor: at least{" "}
                <select id="aa-trusted" className="sort-select" disabled={!v.enabled} value={v.trusted_min_approved}
                  onChange={(e) => setDraft({ ...draft, trusted_min_approved: Number(e.target.value) })}>
                  <option value={0}>off</option>
                  {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>{" "}
                approved, with no more than{" "}
                <select id="aa-dismissed" className="sort-select" disabled={!v.enabled} value={v.trusted_max_dismissed_pct}
                  onChange={(e) => setDraft({ ...draft, trusted_max_dismissed_pct: Number(e.target.value) })}>
                  {[0, 5, 10, 20].map((n) => <option key={n} value={n}>{n}%</option>)}
                </select>{" "}
                turned down
                <div className="comment-meta">
                  Counts their approved finds and submissions. This includes you: with it on, your own routine&apos;s
                  finds go straight in once you pass the threshold.
                </div>
              </div>
              <div className="comment-meta">The last two rules also need ChatGPT to be fairly sure (confidence 0.6 or more).</div>

              <div className="comment-body">
                Possible links: put a link on the song once its score reaches{" "}
                <select id="aa-links" className="sort-select" disabled={!v.enabled} value={v.link_votes}
                  onChange={(e) => setDraft({ ...draft, link_votes: Number(e.target.value) })}>
                  <option value={0}>off</option>
                  {[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <div className="comment-meta">
                  Score is &ldquo;right&rdquo; votes minus &ldquo;wrong&rdquo; votes from the help-wanted page and artist pages.
                  Only songs with no link yet, and only listening sites (Spotify, YouTube, SoundCloud, Bandcamp, Apple Music…).
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="tab active" disabled={busy || !changed} onClick={save}>{busy ? "saving…" : "save"}</button>
              <button className="tab" disabled={busy || !v.enabled || changed} onClick={applyNow}
                title={changed ? "Save first" : undefined}>
                apply to the {s.waiting} waiting find{s.waiting === 1 ? "" : "s"}
              </button>
            </div>
          </div>

          {(s.recent_links ?? []).length > 0 && (
            <>
              <div className="section-label">Links voted in</div>
              {s.recent_links.map((r, i) => (
                <div key={i} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                  <div className="review-row-title" style={{ minWidth: 0 }}>
                    {r.label.replace(/^Link voted in: /, "")}
                    {r.undone && <span className="feature-tag" style={{ marginLeft: 8 }}>undone</span>}
                  </div>
                  <span className="comment-meta">
                    {new Date(r.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </div>
              ))}
            </>
          )}

          <div className="section-label">Recently auto-approved</div>
          {s.recent.length === 0 && <div className="comment-meta">Nothing yet.</div>}
          {s.recent.map((r, i) => (
            <div key={i} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title">
                  <Link href={`/artist/${r.artist_id}`}>{r.title}</Link>
                </div>
                <div className="review-row-meta">
                  {r.artist && <span>{r.artist}</span>}
                  {r.status && <span className="feature-tag">{r.status}</span>}
                  <span>{r.reason}</span>
                </div>
              </div>
              <span className="comment-meta">
                {r.at ? new Date(r.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : ""}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
