"use client";

// Deezer check: artists whose Deezer profile barely matches the songs we
// know for them from elsewhere. Deezer sometimes lumps several artists with
// the same name into one profile (Hi-C was three different people), so
// Deezer stops adding new songs to these until you decide. "Looks right"
// lets it carry on; "wrong artist" removes the songs Deezer added (keeping
// ones on albums we know are theirs) and stops it adding more.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";
import { ModPage, ModRow, ModButton, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

type Row = {
  artist_id: string; name: string; deezer_id: string | null; releases: number; matched: number; known: number;
  deezer_songs: number; deezer_sample: string[] | null; known_sample: string[] | null;
};

export default function DeezerCheckPage() {
  const { loading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.rpc("admin_deezer_check_list");
    if (error) setMessage(error.message);
    setRows((data as Row[]) ?? []);
  }
  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  async function decide(r: Row, verdict: "ok" | "wrong") {
    if (verdict === "wrong" && !confirm(`Remove the ${r.deezer_songs} songs Deezer added to ${r.name} (keeping ones on their known albums)?`)) return;
    setBusy(r.artist_id);
    setMessage(null);
    const { data, error } = await supabase.rpc("admin_deezer_check_set", { p_artist: r.artist_id, p_verdict: verdict });
    setBusy(null);
    if (error) { setMessage(error.message); return; }
    if (verdict === "wrong") setMessage(`${r.name}: ${(data as { removed?: number })?.removed ?? 0} songs removed.`);
    setRows((prev) => (prev ?? []).filter((x) => x.artist_id !== r.artist_id));
  }

  if (!isAdmin) return <NoAccess loading={authLoading} who="admin" />;

  return (
    <ModPage
      title="Deezer check"
      intro={<>
        Artists whose Deezer profile matches almost none of the songs we know for them from elsewhere. Sometimes that&apos;s
        Deezer mixing up different artists with the same name; sometimes it&apos;s just lots of compilations. Deezer
        won&apos;t add new songs to these until you decide. <b>Looks right</b> lets it carry on; <b>wrong artist</b> removes
        the songs Deezer added and stops it adding more. Everything is in the <UndoHistoryLink />.
      </>}
    >
      {message && <ModNotice onClose={() => setMessage(null)}>{message}</ModNotice>}
      {!rows && <ModLoading />}
      {rows && rows.length === 0 && <ModEmpty>Nothing to check right now.</ModEmpty>}

      {(rows ?? []).map((r) => (
        <ModRow
          key={r.artist_id}
          title={<Link href={`/artist/${r.artist_id}`} className="text-link">{r.name}</Link>}
          meta={<>
            <span>{r.matched} of {r.releases} Deezer releases match</span>
            <span>{r.deezer_songs} songs added by Deezer · {r.known} from elsewhere</span>
            {r.deezer_sample && r.deezer_sample.length > 0 && <span>Deezer: {r.deezer_sample.join(" · ")}</span>}
            {r.known_sample && r.known_sample.length > 0 && <span>We know: {r.known_sample.join(" · ")}</span>}
            {r.deezer_id && (
              <a href={`https://www.deezer.com/artist/${r.deezer_id}`} target="_blank" rel="noopener noreferrer" className="listen-link">Deezer profile ↗</a>
            )}
          </>}
          actions={<>
            <ModButton kind="approve" busy={busy === r.artist_id} onClick={() => decide(r, "ok")}>looks right</ModButton>
            <ModButton kind="dismiss" busy={busy === r.artist_id} onClick={() => decide(r, "wrong")}>wrong artist</ModButton>
          </>}
        />
      ))}
    </ModPage>
  );
}
