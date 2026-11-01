"use client";

// Trusted contributors: people whose suggestions go live straight away.
// It happens by itself at 25 approved suggestions (with no more than 1 in 5
// rejected); here a moderator can give it early or take it back.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";
import { ModPage, ModRow, ModButton, ModTag, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

type Person = { user_id: string; name: string; approved: number; rejected: number; pending: number; trusted: boolean; override: string | null };

export default function TrustedPage() {
  const { loading: authLoading } = useAuth();
  const canModerate = useIsModerator();
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
    <ModPage
      title="Trusted contributors"
      intro={<>
        Trusted contributors&apos; suggestions go live straight away instead of waiting here. It happens by itself
        after 25 approved suggestions, as long as no more than 1 in 5 were turned down. Deleting songs and adding
        artists still always wait for a moderator. Their changes show in the <UndoHistoryLink />.
      </>}
    >
      {message && <ModNotice kind="error" onClose={() => setMessage(null)}>{message}</ModNotice>}
      {people === null && <ModLoading />}
      {people && people.length === 0 && <ModEmpty>Nobody has sent a suggestion yet.</ModEmpty>}
      {people?.map((p) => (
        <ModRow
          key={p.user_id}
          title={<><Link href={`/profile/${p.user_id}`}>{p.name}</Link>{p.trusted && <ModTag kind="good">trusted</ModTag>}</>}
          meta={<>
            <span>{p.approved} approved</span>
            <span>{p.rejected} turned down</span>
            {p.pending > 0 && <span>{p.pending} waiting</span>}
            {p.override === "granted" && <span>given by a moderator</span>}
            {p.override === "revoked" && <span>taken back by a moderator</span>}
            {!p.override && !p.trusted && <span>{Math.max(0, 25 - p.approved)} more to go</span>}
          </>}
          actions={p.override ? (
            <ModButton busy={busy === p.user_id} onClick={() => set(p, "auto")}>back to automatic</ModButton>
          ) : p.trusted ? (
            <ModButton kind="danger" busy={busy === p.user_id} confirm={`Stop trusting ${p.name}? Their suggestions will wait for review again.`} onClick={() => set(p, "revoked")}>take back</ModButton>
          ) : (
            <ModButton kind="approve" busy={busy === p.user_id} onClick={() => set(p, "granted")}>trust now</ModButton>
          )}
        />
      ))}
    </ModPage>
  );
}
