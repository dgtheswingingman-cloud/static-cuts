"use client";

// "Not here? Ask for them": for a search that found no artist. The ask goes to
// the front of the new-artist queue (rpc_ask_for_artist); the guest-artists
// job checks them on Deezer within about 10 minutes, and if they're added,
// everyone who asked is following them and gets a notification.

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin } from "../useIsAdmin";

type Res = { state: "here"; artist_id: string } | { state: "queued"; asks: number } | { state: "checked"; note: string | null };

export default function AskForArtist({ name }: { name: string }) {
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const shown = name.trim();
  if (isAdmin || shown.length < 2) return null;

  async function ask() {
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc("rpc_ask_for_artist", { p_name: shown });
    setBusy(false);
    if (error) setErr(error.message);
    else setRes(data as Res);
  }

  const here = typeof window === "undefined" ? "/" : window.location.pathname + window.location.search;

  return (
    <div className="ask-artist">
      {!res && (
        <>
          <div>
            <strong>Not here? Ask for {shown}</strong>
            <small>We check them on Deezer within a few minutes. If they&apos;re added, you&apos;ll be following them.</small>
          </div>
          {user
            ? <button className="tab active" disabled={busy} onClick={ask}>{busy ? "asking…" : "Ask for them"}</button>
            : <Link className="tab active" href={`/login?mode=signup&next=${encodeURIComponent(here)}`}>Sign up to ask</Link>}
        </>
      )}
      {res?.state === "here" && (
        <div><strong>They&apos;re here under another name.</strong> <Link className="text-link" href={`/artist/${res.artist_id}`}>Go to their page →</Link></div>
      )}
      {res?.state === "queued" && (
        <div>
          <strong>✓ Asked for {shown}</strong>
          <small>
            They&apos;re first in line to be checked{res.asks > 1 ? ` (${res.asks} people have asked)` : ""}. You&apos;ll get a notification if they&apos;re added.
          </small>
        </div>
      )}
      {res?.state === "checked" && (
        <div>
          <strong>We looked for {shown} before and couldn&apos;t confirm who they are.</strong>
          <small>
            {res.note ? `${res.note} ` : ""}You can add them yourself:{" "}
            <Link className="text-link" href={`/submit?prefill_name=${encodeURIComponent(shown)}`}>suggest a new artist →</Link>
          </small>
        </div>
      )}
      {err && <small className="ask-artist-err">{err}</small>}
    </div>
  );
}
