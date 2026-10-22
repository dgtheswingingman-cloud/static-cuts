"use client";

// Trusted contributors: people whose suggestions go live straight away.
// It happens by itself at 25 approved suggestions (with no more than 1 in 5
// rejected); here a moderator can give it early or take it back.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";

type Person = { user_id: string; name: string; approved: number; rejected: number; pending: number; trusted: boolean; override: string | null };

export default function TrustedPage() {
  const { loading: authLoading } = useAuth();
  const canModerate = useIsModerator();
  const router = useRouter();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.rpc("admin_contributor_trust");
    if (error) { setMessage(error.message); setPeople([]); return; }
    setPeople((data as Person[]) ?? []);
  }
  useEffect(() => { if (canModerate) load(); }, [canModerate]);

  async function set(p: Person, state: "granted" | "revoked" | "auto") {
    setBusy(p.user_id);
    const { error } = await supabase.rpc("admin_set_user_trust", { p_user: p.user_id, p_state: state, p_note: null });
    setBusy(null);
    if (error) { setMessage(error.message); return; }
    load();
  }

  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/control")}>← control room</button>
      <h1 className="detail-name page-title">Trusted Contributors</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        Trusted contributors&apos; suggestions go live straight away instead of waiting here. It happens by itself
        after 25 approved suggestions, as long as no more than 1 in 5 were turned down. Deleting songs and adding
        artists still always wait for a moderator. Their changes show in the <UndoHistoryLink />.
      </div>
      {message && <div className="comments-panel" style={{ marginBottom: 12 }}>{message}</div>}
      {people === null && <div className="empty-state">loading…</div>}
      {people && people.length === 0 && <div className="empty-state">Nobody has sent a suggestion yet.</div>}
      {people?.map((p) => (
        <div key={p.user_id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">
              <Link href={`/profile/${p.user_id}`}>{p.name}</Link>{" "}
              {p.trusted && <span className="feature-tag">trusted</span>}
            </div>
            <div className="review-row-meta">
              <span>{p.approved} approved</span>
              <span>{p.rejected} turned down</span>
              {p.pending > 0 && <span>{p.pending} waiting</span>}
              {p.override === "granted" && <span>given by a moderator</span>}
              {p.override === "revoked" && <span>taken back by a moderator</span>}
              {!p.override && !p.trusted && <span>{Math.max(0, 25 - p.approved)} more to go</span>}
            </div>
          </div>
          <div className="review-row-actions">
            {p.override ? (
              <button className="rating-chip" disabled={busy === p.user_id} onClick={() => set(p, "auto")}>back to automatic</button>
            ) : p.trusted ? (
              <button className="rating-chip danger" disabled={busy === p.user_id} onClick={() => set(p, "revoked")}>take back</button>
            ) : (
              <button className="rating-chip" disabled={busy === p.user_id} onClick={() => set(p, "granted")}>trust now</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
