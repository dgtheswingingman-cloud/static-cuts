"use client";

// Public form for asking for a song or page to be taken down. Requests go to
// the admin's takedown list (/review/takedowns).

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

const RELATIONSHIPS: { value: string; label: string }[] = [
  { value: "rights_holder", label: "I own the rights (label, publisher, writer)" },
  { value: "representative", label: "I represent the rights holder" },
  { value: "artist", label: "I'm the artist" },
  { value: "other", label: "Something else" },
];

function TakedownForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [pageUrl, setPageUrl] = useState(params.get("url") ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

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
    <div className="wrap" style={{ maxWidth: 620 }}>
      <button className="back-btn" onClick={() => router.push("/")}>← home</button>
      <h1 className="detail-name page-title">Request a Takedown</h1>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        Static Cuts// lists information about music and links to where it can be found. It doesn&apos;t host audio.
        If you own the rights to something listed here and want it taken down, tell us below. We aim to act within
        a few days, and we&apos;ll reply by email. See the{" "}
        <Link href="/legal#takedowns" className="text-link">takedown policy</Link>.
      </div>

      {sent ? (
        <div className="comments-panel">
          Thanks, your request has been sent. We&apos;ll look at it and reply to {email}.
        </div>
      ) : (
        <form onSubmit={submit} className="comments-panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="comment-meta" htmlFor="td-url">
            Link to the song or page on Static Cuts//
            <input id="td-url" className="search-input" style={{ width: "100%", marginTop: 4 }}
              placeholder="https://static-cuts.com/artist/…" value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} />
          </label>
          <label className="comment-meta" htmlFor="td-name">
            Your name
            <input id="td-name" className="search-input" style={{ width: "100%", marginTop: 4 }} required
              value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="comment-meta" htmlFor="td-email">
            Email (we reply here)
            <input id="td-email" type="email" className="search-input" style={{ width: "100%", marginTop: 4 }} required
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="comment-meta" htmlFor="td-rel">
            How you&apos;re connected to the music
            <select id="td-rel" className="sort-select" style={{ width: "100%", marginTop: 4 }} required
              value={relationship} onChange={(e) => setRelationship(e.target.value)}>
              <option value="" disabled>Choose one</option>
              {RELATIONSHIPS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <label className="comment-meta" htmlFor="td-reason">
            What should be removed, and why
            <textarea id="td-reason" className="search-input" style={{ width: "100%", marginTop: 4, minHeight: 120 }} required
              value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {error && <div className="comment-meta error-text">{error}</div>}
          <div>
            <button className="tab active" type="submit" disabled={busy}>{busy ? "sending…" : "send request"}</button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function TakedownPage() {
  return (
    <Suspense fallback={null}>
      <TakedownForm />
    </Suspense>
  );
}
