"use client";

// Deezer check: artists whose Deezer profile barely matches the songs we
// know for them from elsewhere. Deezer sometimes lumps several artists with
// the same name into one profile (Hi-C was several different people), so
// Deezer doesn't add their new songs until you've looked.
//   looks right:      Deezer carries on as normal
//   pick releases:    tick which Deezer releases are theirs; unticked ones'
//                     songs go and are never added again, ticked ones are
//                     added. New releases then wait here for a tick.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";
import { ModPage, ModRow, ModButton, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

type Row = {
  artist_id: string; name: string; deezer_id: string | null; releases: number; matched: number; known: number;
  deezer_songs: number; waiting: number; mixed: boolean; known_sample: string[] | null;
};
type Release = { album_id: string; title: string; kind: string | null; year: number | null; link: string | null; review: "keep" | "remove" | null; songs: number | null; known: boolean };

function Picker({ row, onDone }: { row: Row; onDone: (msg: string) => void }) {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("admin_deezer_releases", { p_artist: row.artist_id }).then(({ data, error: err }) => {
      if (err) { setError(err.message); return; }
      const list = (data as Release[]) ?? [];
      setReleases(list);
      // Start with everything ticked except ones already marked as someone else's.
      setKeep(Object.fromEntries(list.map((r) => [r.album_id, r.review !== "remove"])));
    });
  }, [row.artist_id]);

  // Only releases not decided yet (and, the first time, all of them).
  const shown = (releases ?? []).filter((r) => !row.mixed || r.review === null);
  const removing = shown.filter((r) => !keep[r.album_id]);

  async function save() {
    if (removing.length && !confirm(`Remove the songs from ${removing.length} release${removing.length === 1 ? "" : "s"} that aren't ${row.name}?`)) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("admin_deezer_pick", {
      p_artist: row.artist_id,
      p_keep: shown.filter((r) => keep[r.album_id]).map((r) => r.album_id),
      p_remove: removing.map((r) => r.album_id),
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onDone(`${row.name}: ${(data as { removed?: number })?.removed ?? 0} songs removed; the rest stay.`);
  }

  if (error) return <div className="comment-meta error-text">{error}</div>;
  if (!releases) return <div className="comment-meta">Loading releases…</div>;

  return (
    <div style={{ marginTop: 10 }}>
      <div className="comment-meta" style={{ marginBottom: 8 }}>
        Untick the releases that <b>aren&apos;t</b> {row.name}. <span style={{ opacity: 0.8 }}>✓ = matches songs we already have for them.</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button className="rating-clear" onClick={() => setKeep(Object.fromEntries(shown.map((r) => [r.album_id, true])))}>tick all</button>
        <button className="rating-clear" onClick={() => setKeep(Object.fromEntries(shown.map((r) => [r.album_id, false])))}>untick all</button>
      </div>
      <div style={{ maxHeight: 420, overflowY: "auto", border: "1px solid #2a2a2a", padding: 8 }}>
        {shown.map((r) => (
          <label key={r.album_id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0", opacity: keep[r.album_id] ? 1 : 0.5 }}>
            <input type="checkbox" checked={!!keep[r.album_id]} onChange={(e) => setKeep({ ...keep, [r.album_id]: e.target.checked })} />
            <span className="comment-body">
              {r.title}
              <span className="comment-meta"> · {r.kind ?? "release"}{r.year ? ` · ${r.year}` : ""}{r.songs ? ` · ${r.songs} song${r.songs === 1 ? "" : "s"}` : ""}{r.known ? " · ✓" : ""}</span>
            </span>
            {r.link && <a href={r.link} target="_blank" rel="noopener noreferrer" className="listen-link" style={{ fontSize: "0.7rem", marginLeft: "auto" }}>Deezer ↗</a>}
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <ModButton kind="approve" busy={busy} onClick={save}>save</ModButton>
        <span className="comment-meta">{removing.length ? `${removing.length} to remove` : "keeping everything"}</span>
      </div>
    </div>
  );
}

export default function DeezerCheckPage() {
  const { loading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
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

  async function looksRight(r: Row) {
    setBusy(r.artist_id);
    const { error } = await supabase.rpc("admin_deezer_check_ok", { p_artist: r.artist_id });
    setBusy(null);
    if (error) { setMessage(error.message); return; }
    setRows((prev) => (prev ?? []).filter((x) => x.artist_id !== r.artist_id));
  }

  if (!isAdmin) return <NoAccess loading={authLoading} who="admin" />;

  return (
    <ModPage
      title="Deezer check"
      intro={<>
        Artists whose Deezer profile matches few of the songs we know for them from elsewhere. Sometimes that&apos;s Deezer
        mixing up different artists with the same name; sometimes it&apos;s just lots of compilations. Deezer won&apos;t
        add their new songs until you&apos;ve looked. <b>Looks right</b> lets it carry on; <b>pick releases</b> lets you
        untick the ones that are someone else&apos;s (their songs go and never come back). Everything is in the{" "}
        <UndoHistoryLink />.
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
            {r.mixed
              ? <span>{r.waiting} new Deezer release{r.waiting === 1 ? "" : "s"} to tick</span>
              : <span>{r.matched} of {r.releases} Deezer releases match what we know</span>}
            <span>{r.deezer_songs} songs from Deezer · {r.known} from elsewhere</span>
            {r.known_sample && r.known_sample.length > 0 && <span>We know: {r.known_sample.join(" · ")}</span>}
            {r.deezer_id && (
              <a href={`https://www.deezer.com/artist/${r.deezer_id}`} target="_blank" rel="noopener noreferrer" className="listen-link">Deezer profile ↗</a>
            )}
          </>}
          actions={<>
            {!r.mixed && <ModButton kind="approve" busy={busy === r.artist_id} onClick={() => looksRight(r)}>looks right</ModButton>}
            <ModButton busy={busy === r.artist_id} onClick={() => setOpen(open === r.artist_id ? null : r.artist_id)}>
              {open === r.artist_id ? "close" : "pick releases"}
            </ModButton>
          </>}
        >
          {open === r.artist_id && (
            <Picker row={r} onDone={(msg) => { setMessage(msg); setOpen(null); load(); }} />
          )}
        </ModRow>
      ))}
    </ModPage>
  );
}
