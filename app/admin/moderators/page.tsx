"use client";

// The team (owner only): choose admins and moderators.
//   moderators: work through the lists, edit, add, merge and delete songs.
//   admins:     everything moderators do, plus site health, people stats,
//               trackers, imports and the undo history.
// Choosing the team, API keys, auto-approve rules and leak file links stay
// with the owner. Everything anyone does shows in the undo history with
// their name.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsOwner } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";
import { ModPage, ModRow, ModButton, ModTag, ModNotice, ModLoading, ModEmpty, ModSection } from "../../components/Mod";

type Role = "admin" | "moderator";
type Member = { user_id: string; display_name: string | null; added_at: string; note: string | null; actions: number; role?: Role };
type Person = { user_id: string; display_name: string | null; is_moderator: boolean; contributions: number };

export default function TeamPage() {
  const { user, loading: authLoading } = useAuth();
  const isOwner = useIsOwner();
  const [team, setTeam] = useState<Member[] | null>(null);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.rpc("admin_list_moderators");
    if (error) { setMessage(error.message); return; }
    setTeam((data as Member[]) ?? []);
  }

  useEffect(() => {
    if (isOwner) load();
  }, [isOwner]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setPeople([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("admin_find_people", { p_query: q });
      setPeople((data as Person[]) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function setRole(userId: string, role: Role | "none", name: string | null) {
    const who = name ?? "this person";
    if (role === "none" && !confirm(`Take ${who} off the team?`)) return;
    if (role === "admin" && !confirm(`Make ${who} an admin? Admins see site health, people stats and the undo history, and can undo changes.`)) return;
    setBusy(userId);
    setMessage(null);
    const { error } = await supabase.rpc("admin_set_role", { p_user: userId, p_role: role });
    setBusy(null);
    if (error) { setMessage(error.message); return; }
    setMessage(role === "none" ? `${name ?? "They"} is off the team.` : `${name ?? "They"} is now ${role === "admin" ? "an admin" : "a moderator"}.`);
    setPeople((prev) => prev.map((p) => (p.user_id === userId ? { ...p, is_moderator: role !== "none" } : p)));
    load();
  }

  if (!isOwner) return <NoAccess loading={authLoading} who="owner" />;

  return (
    <ModPage
      title="Team"
      back="/control?tab=owner"
      intro={<>
        <b>Moderators</b> work through the lists: suggestions, imports, versions, guests, comments, and they can edit,
        add, merge and delete songs. <b>Admins</b> also see site health, people stats, trackers and the undo history.
        Choosing the team, API keys, auto-approve rules and leak file links stay yours. Everything anyone does shows in
        the <UndoHistoryLink /> with their name.
      </>}
    >
      {message && <ModNotice onClose={() => setMessage(null)}>{message}</ModNotice>}

      <ModSection>The team</ModSection>
      {!team && <ModLoading />}
      {team && team.length === 0 && <ModEmpty>Just you so far. Find someone below.</ModEmpty>}
      {team?.map((m) => {
        const role: Role = m.role ?? "moderator";
        return (
          <ModRow
            key={m.user_id}
            title={<><Link href={`/profile/${m.user_id}`}>{m.display_name ?? "unnamed"}</Link><ModTag kind="good">{role}</ModTag></>}
            meta={<>
              <span>since {new Date(m.added_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              <span>{m.actions} change{m.actions === 1 ? "" : "s"} made</span>
            </>}
            actions={<>
              <ModButton busy={busy === m.user_id} onClick={() => setRole(m.user_id, role === "admin" ? "moderator" : "admin", m.display_name)}>
                {role === "admin" ? "make moderator" : "make admin"}
              </ModButton>
              <ModButton kind="danger" busy={busy === m.user_id} onClick={() => setRole(m.user_id, "none", m.display_name)}>remove</ModButton>
            </>}
          />
        );
      })}

      <ModSection>Add someone</ModSection>
      <input
        className="search-input"
        style={{ width: "100%" }}
        placeholder="Search by display name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim().length >= 2 && people.length === 0 && <div className="comment-meta" style={{ marginTop: 8 }}>No one found.</div>}
      {people.filter((p) => p.user_id !== user?.id).map((p) => (
        <ModRow
          key={p.user_id}
          title={<Link href={`/profile/${p.user_id}`}>{p.display_name ?? "unnamed"}</Link>}
          meta={<span>{p.contributions} contribution{p.contributions === 1 ? "" : "s"}</span>}
          actions={p.is_moderator ? <ModTag>on the team</ModTag> : <>
            <ModButton kind="approve" busy={busy === p.user_id} onClick={() => setRole(p.user_id, "moderator", p.display_name)}>make moderator</ModButton>
            <ModButton busy={busy === p.user_id} onClick={() => setRole(p.user_id, "admin", p.display_name)}>make admin</ModButton>
          </>}
        />
      ))}
    </ModPage>
  );
}
