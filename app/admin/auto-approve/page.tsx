"use client";

// Rules for approving ChatGPT finds without waiting for review, and a log
// of what they've approved. Every auto-approval can be undone from the undo
// history.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsOwner } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";
import { ModPage, ModButton, ModTag, ModNotice, ModLoading, ModEmpty, ModSection } from "../../components/Mod";

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
  const isRealAdmin = useIsOwner();
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

  if (!isRealAdmin) return <NoAccess loading={authLoading} who="owner" />;
  const v = { ...s, ...draft } as Settings;
  const changed = Object.keys(draft).length > 0;

  const row = { gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center" } as const;
  const when = (at: string) => new Date(at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const pick = (id: string, value: number, options: number[], onPick: (n: number) => void, suffix = "") => (
    <select id={id} className="sort-select" disabled={!v.enabled} value={value} onChange={(e) => onPick(Number(e.target.value))}>
      {options.map((n) => <option key={n} value={n}>{n === 0 && !suffix ? "off" : `${n}${suffix}`}</option>)}
    </select>
  );

  return (
    <ModPage
      title="Auto-approve"
      back="/control?tab=owner"
      intro={<>
        ChatGPT finds that match a rule below go straight in instead of waiting for review. Rumours, takedowns and
        songs with an open takedown request always wait for you. Each one is its own entry in the <UndoHistoryLink />,
        so a bad one is one click to reverse.
      </>}
    >
      {!s && !message && <ModLoading />}
      {message && <ModNotice onClose={() => setMessage(null)}>{message}</ModNotice>}

      {s && (
        <>
          <ModSection>Rules</ModSection>
          <div className="review-row" style={row}>
            <div style={{ minWidth: 0 }}>
              <div className="review-row-title">Auto-approve</div>
              <div className="review-row-meta"><span>Turns every rule below on or off.</span></div>
            </div>
            <button className={`tab ${v.enabled ? "active" : ""}`} onClick={() => setDraft({ ...draft, enabled: !v.enabled })}>
              {v.enabled ? "on" : "off"}
            </button>
          </div>

          <div style={{ opacity: v.enabled ? 1 : 0.5 }}>
            <div className="review-row" style={row}>
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title">Official releases with a Spotify link</div>
                <div className="review-row-meta"><span>A find marked released that includes a Spotify track link.</span></div>
              </div>
              <button className={`tab ${v.spotify_releases ? "active" : ""}`} disabled={!v.enabled}
                onClick={() => setDraft({ ...draft, spotify_releases: !v.spotify_releases })}>
                {v.spotify_releases ? "on" : "off"}
              </button>
            </div>

            <div className="review-row" style={row}>
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title">Confirmed by several people</div>
                <div className="review-row-meta">
                  <span>Different people&apos;s ChatGPT routines reported the same thing separately. Needs ChatGPT to be fairly sure (0.6+).</span>
                </div>
              </div>
              {pick("aa-confirm", v.min_confirmations, [0, 2, 3, 4, 5], (n) => setDraft({ ...draft, min_confirmations: n }))}
            </div>

            <div className="review-row" style={row}>
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title">Found by a trusted contributor</div>
                <div className="review-row-meta">
                  <span>
                    Someone with at least this many approved finds and submissions, and no more than{" "}
                    {pick("aa-dismissed", v.trusted_max_dismissed_pct, [0, 5, 10, 20], (n) => setDraft({ ...draft, trusted_max_dismissed_pct: n }), "%")}{" "}
                    turned down. Includes you. Needs ChatGPT to be fairly sure (0.6+).
                  </span>
                </div>
              </div>
              {pick("aa-trusted", v.trusted_min_approved, [0, 10, 25, 50, 100], (n) => setDraft({ ...draft, trusted_min_approved: n }))}
            </div>

            <div className="review-row" style={row}>
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title">Possible links voted in</div>
                <div className="review-row-meta">
                  <span>
                    Puts a link on a song once its score (&ldquo;right&rdquo; minus &ldquo;wrong&rdquo; votes) reaches this. Only songs
                    with no link yet, and only listening sites (Spotify, YouTube, SoundCloud, Bandcamp, Apple Music…).
                  </span>
                </div>
              </div>
              {pick("aa-links", v.link_votes, [0, 3, 5, 8, 10], (n) => setDraft({ ...draft, link_votes: n }))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0 28px" }}>
            <ModButton kind="approve" busy={busy} disabled={!changed} onClick={save}>{busy ? "saving…" : changed ? "save changes" : "saved"}</ModButton>
            <ModButton busy={busy} disabled={!v.enabled || changed} onClick={applyNow} title={changed ? "Save first" : undefined}>
              apply to the {s.waiting} waiting find{s.waiting === 1 ? "" : "s"}
            </ModButton>
          </div>

          {(s.recent_links ?? []).length > 0 && (
            <>
              <ModSection>Links voted in</ModSection>
              {s.recent_links.map((r, i) => (
                <div key={i} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                  <div className="review-row-title" style={{ minWidth: 0 }}>
                    {r.label.replace(/^Link voted in: /, "")}
                    {r.undone && <ModTag kind="warn">undone</ModTag>}
                  </div>
                  <span className="comment-meta">{when(r.at)}</span>
                </div>
              ))}
            </>
          )}

          <ModSection>Recently auto-approved</ModSection>
          {s.recent.length === 0 && <ModEmpty>Nothing yet.</ModEmpty>}
          {s.recent.map((r, i) => (
            <div key={i} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title">
                  <Link href={`/artist/${r.artist_id}`}>{r.title}</Link>
                </div>
                <div className="review-row-meta">
                  {r.artist && <span>{r.artist}</span>}
                  {r.status && <ModTag>{r.status}</ModTag>}
                  <span>{r.reason}</span>
                </div>
              </div>
              <span className="comment-meta">{r.at ? when(r.at) : ""}</span>
            </div>
          ))}
        </>
      )}
    </ModPage>
  );
}
