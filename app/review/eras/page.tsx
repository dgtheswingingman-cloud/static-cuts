"use client";

// Tracker eras (admins): album names that came from community trackers'
// eras ("Before The College Dropout") but sit on released songs. One
// decision per name: a real release (often a mixtape that isn't on
// streaming services) is kept; a tracker era is cleared from that artist's
// released songs only (unreleased songs keep it), as one entry in Undo.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";
import { ModPage, ModRow, ModButton, ModTag, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

type Group = {
  artist_id: string; artist: string; album: string; released: number; unreleased: number;
  examples: string[]; sources: string[];
};

export default function TrackerErasPage() {
  const { loading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "done" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.rpc("admin_era_albums").then(({ data, error }) => {
      if (error) { setNotice({ kind: "error", text: error.message }); setGroups([]); return; }
      setGroups((data as Group[]) ?? []);
    });
  }, [isAdmin]);

  async function decide(g: Group, decision: "keep" | "clear") {
    const key = `${g.artist_id}|${g.album}`;
    setBusy(key);
    const { data, error } = await supabase.rpc("admin_era_album_decide", { p_artist: g.artist_id, p_album: g.album, p_decision: decision });
    setBusy(null);
    if (error) { setNotice({ kind: "error", text: error.message }); return; }
    setGroups((prev) => (prev ?? []).filter((x) => `${x.artist_id}|${x.album}` !== key));
    setNotice({ kind: "done", text: decision === "keep"
      ? `Kept “${g.album}” (${g.artist}).`
      : `Cleared “${g.album}” from ${data} released ${g.artist} song${data === 1 ? "" : "s"}. Undo has it if that was wrong.` });
  }

  if (!isAdmin) return <NoAccess loading={authLoading} who="admin" />;
  const songs = (groups ?? []).reduce((n, g) => n + g.released, 0);
  return (
    <ModPage title="Tracker eras"
      intro={<>Album names from community trackers&apos; eras that are on <b>released</b> songs and don&apos;t match any of the artist&apos;s releases on Deezer, Spotify or Apple. Some are real mixtapes that just aren&apos;t on streaming: keep those. Clearing only touches the artist&apos;s released songs; their unreleased songs keep the era. Cleared songs then show up in Help Wanted&apos;s Missing info.</>}>
      {notice && <ModNotice kind={notice.kind} onClose={() => setNotice(null)}>{notice.text}</ModNotice>}
      {!groups && <ModLoading />}
      {groups && groups.length === 0 && <ModEmpty>None left to decide.</ModEmpty>}
      {groups && groups.length > 0 && (
        <p className="comment-meta">{groups.length.toLocaleString("en-GB")} names · {songs.toLocaleString("en-GB")} released songs</p>
      )}
      {groups?.map((g) => {
        const key = `${g.artist_id}|${g.album}`;
        return (
          <ModRow key={key}
            title={<><Link href={`/artist/${g.artist_id}`}>{g.artist}</Link> · “{g.album}”</>}
            meta={<>
              <span>{g.released} released · {g.unreleased} unreleased</span>
              <span>e.g. {g.examples.join(", ")}</span>
              {g.sources.map((s) => <ModTag key={s}>{s}</ModTag>)}
            </>}
            actions={<>
              <ModButton kind="approve" busy={busy === key} onClick={() => decide(g, "keep")}>real release, keep</ModButton>
              <ModButton kind="danger" busy={busy === key}
                confirm={`Clear “${g.album}” from ${g.released} released ${g.artist} song${g.released === 1 ? "" : "s"}? Unreleased songs keep it.`}
                onClick={() => decide(g, "clear")}>tracker era, clear</ModButton>
            </>}
          />
        );
      })}
    </ModPage>
  );
}
