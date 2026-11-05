"use client";

// Public form for asking for a song or page to be taken down. Requests go to
// the admin's takedown list (/review/takedowns).

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import InfoShell, { InfoSection } from "../components/info/InfoShell";

const RELATIONSHIPS: { value: string; label: string }[] = [
  { value: "rights_holder", label: "I own the rights (label, publisher, writer)" },
  { value: "representative", label: "I represent the rights holder" },
  { value: "artist", label: "I'm the artist" },
  { value: "other", label: "Something else" },
];

function TakedownForm() {
  const params = useSearchParams();
  const [pageUrl, setPageUrl] = useState(params.get("url") ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("rpc_request_takedown", {
      p_page_url: pageUrl,
      p_name: name,
      p_email: email,
      p_relationship: relationship,
      p_reason: reason,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setSent(true);
  }

  return (
    <InfoShell title="REQUEST A TAKEDOWN" here="/takedown"
      intro={<>Report something you own the rights to and want removed. Static Cuts// lists information about music and links to where it can be found; it doesn&apos;t host audio. We aim to act within a few days and reply by email. See the <Link href="/legal#takedowns" className="text-link">takedown policy</Link>.</>}>
      {sent ? (
        <InfoSection title="Sent">
          <div className="if-sent">
            <span className="sb-tick" aria-hidden="true">✓</span>
            <p className="if-p">Thanks, your request has been sent. We&apos;ll look at it and reply to <b>{email}</b>.</p>
          </div>
        </InfoSection>
      ) : (
        <InfoSection>
          <form onSubmit={submit} className="if-form">
            <label className="wl-label" htmlFor="td-name">Your name <em className="if-req">*</em>
              <input id="td-name" className="sb-text" required placeholder="e.g. John Doe" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="wl-label" htmlFor="td-email">Email <em className="if-req">*</em> <small>(we reply here)</small>
              <input id="td-email" type="email" className="sb-text" required placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="wl-label" htmlFor="td-rel">How you&apos;re connected to the music <em className="if-req">*</em>
              <select id="td-rel" className="sb-text" required value={relationship} onChange={(e) => setRelationship(e.target.value)}>
                <option value="" disabled>Choose one…</option>
                {RELATIONSHIPS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            <label className="wl-label" htmlFor="td-url">Link to the song or page on Static Cuts//
              <input id="td-url" className="sb-text" placeholder="https://static-cuts.com/song/…" value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} />
            </label>
            <label className="wl-label" htmlFor="td-reason">What should be removed, and why <em className="if-req">*</em>
              <textarea id="td-reason" className="sb-text sb-area" required placeholder="e.g. the song, the recording, the artwork" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label className="sb-check if-confirm">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} required />
              I confirm I own the rights to this content (or represent someone who does) and this request is genuine.
            </label>
            {error && <div className="sb-error">{error}</div>}
            <button className="sb-submit" type="submit" disabled={busy || !confirm}>{busy ? "Sending…" : "Submit//"}</button>
          </form>
        </InfoSection>
      )}
    </InfoShell>
  );
}

export default function TakedownPage() {
  return (
    <Suspense fallback={null}>
      <TakedownForm />
    </Suspense>
  );
}
