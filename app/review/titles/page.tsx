"use client";

// Archive checks (admins): rule-based checks over the whole catalogue, no AI.
//   Cut-off titles: cut at 28-30 characters mid-word (old MP3 tags cap
//     titles at 30; nearly all came from Last.fm) where the same artist has
//     the full-title song. Merge into the right one (collections, ratings,
//     versions and links move over, the old page redirects), or "not the
//     same".
//   Garbled text: broken characters, leftover HTML and stray spaces, each
//     with its fix ready. Titles that can't be fixed for certain aren't
//     listed.
//   Dates (live): an unreleased song's release date that's only a copy of
//     its leak date (clear it); a leaked song whose only date is in
//     "release date" (move it to the leak date); an "unreleased" song with a
//     Spotify track link (maybe released). Other release dates on unreleased
//     songs are mostly trackers' recording dates and are left alone.
// Merges and fixes are in Undo.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";
import { ModPage, ModToolbar, ModTabs, ModRow, ModButton, ModTag, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

type Cand = { id: string; title: string; status: string | null };
type Cut = { id: string; title: string; artist_id: string; artist: string; status: string | null; candidates: Cand[] };
type Garbled = { id: string; title: string; artist_id: string; artist: string; fixed: string };
type Data = { cut: Cut[]; garbled: Garbled[]; checked_at: string | null };
type DateRow = { id: string; title: string; artist_id: string; artist: string; status: string; release_date: string | null; leak_date: string | null; spotify_url: string | null };
type Dates = { copied: DateRow[]; noleak: DateRow[]; linked: DateRow[]; held: number };
type DateKind = "copied" | "noleak" | "linked";
type Cross = { id: string; title: string; artist_id: string; artist: string; status: string | null; parent_id: string; parent_title: string; parent_artist_id: string; parent_artist: string };
type Tab = "cut" | "garbled" | DateKind | "cross";
const fmt = (d: string | null) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "none");

export default function TitleChecksPage() {
  const { loading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const [data, setData] = useState<Data | null>(null);
  const [dates, setDates] = useState<Dates | null>(null);
  const [cross, setCross] = useState<Cross[] | null>(null);
  const [tab, setTab] = useState<Tab>("cut");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "done" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.rpc("admin_title_checks").then(({ data: d, error }) => {
      if (error) { setNotice({ kind: "error", text: error.message }); setData({ cut: [], garbled: [], checked_at: null }); return; }
      setData((d as Data) ?? { cut: [], garbled: [], checked_at: null });
    });
    supabase.rpc("admin_date_checks").then(({ data: d }) => setDates((d as Dates) ?? { copied: [], noleak: [], linked: [], held: 0 }));
    supabase.rpc("admin_cross_versions").then(({ data: d }) => setCross((d as Cross[]) ?? []));
  }, [isAdmin]);

  // Dates: one song, or all of a kind (track null).
  async function dateAct(kind: DateKind, action: "clear" | "move" | "released" | "dismiss", id: string | null) {
    setBusy(`${kind}|${id ?? "all"}`);
    const { data: n, error } = await supabase.rpc("admin_date_check_action", { p_kind: kind, p_action: action, p_track: id });
    setBusy(null);
    if (error) { setNotice({ kind: "error", text: error.message }); return; }
    setDates((d) => d && { ...d, [kind]: id ? d[kind].filter((x) => x.id !== id) : [] });
    if (!id) setNotice({ kind: "done", text: `Done: ${n} song${n === 1 ? "" : "s"}. Undo has it if that was wrong.` });
  }

  async function act(kind: "cut" | "garbled", id: string, action: "merge" | "dismiss" | "fix", target?: string) {
    setBusy(`${kind}|${id}`);
    const { error } = await supabase.rpc("admin_title_check_action", { p_track: id, p_kind: kind, p_action: action, p_target: target ?? null });
    setBusy(null);
    if (error) { setNotice({ kind: "error", text: error.message }); return false; }
    setData((d) => d && { ...d, [kind]: (d[kind] as { id: string }[]).filter((x) => x.id !== id) } as Data);
    return true;
  }

  async function fixAll() {
    const list = data?.garbled ?? [];
    let done = 0;
    for (const g of list) if (await act("garbled", g.id, "fix")) done++;
    setNotice({ kind: "done", text: `Fixed ${done} title${done === 1 ? "" : "s"}.` });
  }

  if (!isAdmin) return <NoAccess loading={authLoading} who="admin" />;
  const cut = data?.cut ?? [];
  const garbled = data?.garbled ?? [];
  return (
    <ModPage title="Archive checks"
      intro={<>Problems found across the whole archive: titles are checked every night, dates live. Nothing changes until you choose; merges and fixes can be undone from the <UndoHistoryLink />.</>}>
      {notice && <ModNotice kind={notice.kind} onClose={() => setNotice(null)}>{notice.text}</ModNotice>}
      <ModToolbar right={tab === "garbled" && garbled.length > 1
        ? <ModButton kind="approve" busy={!!busy} confirm={`Apply all ${garbled.length} fixes?`} onClick={fixAll}>fix all {garbled.length}</ModButton> : undefined}>
        <ModTabs<Tab> value={tab} onChange={setTab} tabs={[
          { key: "cut", label: "Cut-off titles", count: cut.length },
          { key: "garbled", label: "Garbled text", count: garbled.length },
          { key: "copied", label: "Copied dates", count: dates?.copied.length ?? null },
          { key: "noleak", label: "Leak date in the wrong place", count: dates?.noleak.length ?? null },
          { key: "linked", label: "Maybe released", count: dates?.linked.length ?? null },
          { key: "cross", label: "Version under another artist", count: cross?.length ?? null },
        ]} />
      </ModToolbar>
      {!data && <ModLoading />}
      {dates && dates.held > 0 && (tab === "copied" || tab === "noleak" || tab === "linked") && (
        <p className="comment-meta">{dates.held} song{dates.held === 1 ? " is" : "s are"} on store pre-release: shown as announced until their release date, then released automatically.</p>
      )}
      {data?.checked_at && <p className="comment-meta">Last checked {new Date(data.checked_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.</p>}

      {data && tab === "cut" && (<>
        <p className="comment-meta">Titles cut off part-way (old MP3 tags only hold 30 characters, so most came in from Last.fm like this), where the artist also has the full title. Merge into the right one: collections, ratings, versions and links move over and the old page redirects. If the full one is a different recording (a live version, say), choose &ldquo;not the same&rdquo;.</p>
        {cut.length === 0 && <ModEmpty>None left.</ModEmpty>}
        {cut.map((c) => (
          <ModRow key={c.id}
            title={<><Link href={`/song/${c.id}`}>&ldquo;{c.title}&rdquo;</Link> {c.status && <ModTag>{c.status}</ModTag>}</>}
            meta={<>
              <Link href={`/artist/${c.artist_id}`}>{c.artist}</Link>
              {c.candidates.map((o) => (
                <span key={o.id} className="tc-cand">full: <Link href={`/song/${o.id}`}>&ldquo;{o.title}&rdquo;</Link>{o.status ? ` (${o.status})` : ""}{" "}
                  <ModButton kind="approve" busy={busy === `cut|${c.id}`} confirm={`Merge “${c.title}” into “${o.title}”?`}
                    onClick={() => act("cut", c.id, "merge", o.id)}>merge into this</ModButton>
                </span>
              ))}
            </>}
            actions={<ModButton kind="dismiss" busy={busy === `cut|${c.id}`} onClick={() => act("cut", c.id, "dismiss")}>not the same</ModButton>}
          />
        ))}
      </>)}

      {tab === "copied" && dates && (<>
        <p className="comment-meta">Unreleased songs whose release date is just a copy of their leak date. The leak date stays; only the copy goes.</p>
        {dates.copied.length === 0 && <ModEmpty>None left.</ModEmpty>}
        {dates.copied.length > 0 && <p><ModButton kind="approve" busy={busy === "copied|all"} confirm={`Clear the copied release date on all ${dates.copied.length} songs? Their leak dates stay.`} onClick={() => dateAct("copied", "clear", null)}>clear all {dates.copied.length}</ModButton></p>}
        {dates.copied.map((r) => (
          <ModRow key={r.id}
            title={<><Link href={`/song/${r.id}`}>{r.title}</Link> <ModTag>{r.status}</ModTag></>}
            meta={<><Link href={`/artist/${r.artist_id}`}>{r.artist}</Link><span>release {fmt(r.release_date)} · leak {fmt(r.leak_date)}</span></>}
            actions={<>
              <ModButton kind="approve" busy={busy === `copied|${r.id}`} onClick={() => dateAct("copied", "clear", r.id)}>clear release date</ModButton>
              <ModButton kind="dismiss" busy={busy === `copied|${r.id}`} onClick={() => dateAct("copied", "dismiss", r.id)}>leave it</ModButton>
            </>} />
        ))}
      </>)}

      {tab === "noleak" && dates && (<>
        <p className="comment-meta">Leaked songs whose only date is in &ldquo;release date&rdquo;. Leaked songs don&apos;t have a release date, so it most likely belongs in the leak date.</p>
        {dates.noleak.length === 0 && <ModEmpty>None left.</ModEmpty>}
        {dates.noleak.length > 1 && <p><ModButton kind="approve" busy={busy === "noleak|all"} confirm={`Move the date to the leak date on all ${dates.noleak.length} songs?`} onClick={() => dateAct("noleak", "move", null)}>move all {dates.noleak.length}</ModButton></p>}
        {dates.noleak.map((r) => (
          <ModRow key={r.id}
            title={<><Link href={`/song/${r.id}`}>{r.title}</Link> <ModTag>{r.status}</ModTag></>}
            meta={<><Link href={`/artist/${r.artist_id}`}>{r.artist}</Link><span>release {fmt(r.release_date)} · leak none</span></>}
            actions={<>
              <ModButton kind="approve" busy={busy === `noleak|${r.id}`} onClick={() => dateAct("noleak", "move", r.id)}>move to leak date</ModButton>
              <ModButton kind="dismiss" busy={busy === `noleak|${r.id}`} onClick={() => dateAct("noleak", "dismiss", r.id)}>leave it</ModButton>
            </>} />
        ))}
      </>)}

      {tab === "cross" && cross && (<>
        <p className="comment-meta">Versions filed under another artist&apos;s song, with nothing linking the two (neither artist is in the other&apos;s title, features or credits). Often two different songs that share a title, or a generic &ldquo;Intro&rdquo;. A remixer&apos;s own remix is fine.</p>
        {cross.length === 0 && <ModEmpty>None left.</ModEmpty>}
        {cross.map((c) => (
          <ModRow key={c.id}
            title={<><Link href={`/song/${c.id}`}>{c.title}</Link> <span className="comment-meta">by <Link href={`/artist/${c.artist_id}`}>{c.artist}</Link></span></>}
            meta={<span>filed as a version of <Link href={`/song/${c.parent_id}`}>&ldquo;{c.parent_title}&rdquo;</Link> by <Link href={`/artist/${c.parent_artist_id}`}>{c.parent_artist}</Link></span>}
            actions={<>
              <ModButton kind="approve" busy={busy === `cross|${c.id}`} onClick={async () => {
                setBusy(`cross|${c.id}`);
                const { error } = await supabase.rpc("admin_cross_version_action", { p_track: c.id, p_action: "own" });
                setBusy(null);
                if (error) { setNotice({ kind: "error", text: error.message }); return; }
                setCross((l) => (l ?? []).filter((x) => x.id !== c.id));
                setNotice({ kind: "done", text: `“${c.title}” is its own song now.` });
              }}>make it its own song</ModButton>
              <ModButton kind="dismiss" busy={busy === `cross|${c.id}`} onClick={async () => {
                setBusy(`cross|${c.id}`);
                const { error } = await supabase.rpc("admin_cross_version_action", { p_track: c.id, p_action: "fine" });
                setBusy(null);
                if (error) { setNotice({ kind: "error", text: error.message }); return; }
                setCross((l) => (l ?? []).filter((x) => x.id !== c.id));
              }}>it&apos;s right</ModButton>
            </>} />
        ))}
      </>)}

      {tab === "linked" && dates && (<>
        <p className="comment-meta">Marked unreleased but linked to a Spotify track. Open the link: if it&apos;s really this song out on Spotify, it&apos;s released.</p>
        {dates.linked.length === 0 && <ModEmpty>None left.</ModEmpty>}
        {dates.linked.map((r) => (
          <ModRow key={r.id}
            title={<><Link href={`/song/${r.id}`}>{r.title}</Link> <ModTag>{r.status}</ModTag></>}
            meta={<><Link href={`/artist/${r.artist_id}`}>{r.artist}</Link>{r.spotify_url && <a href={r.spotify_url} target="_blank" rel="noopener noreferrer">open on Spotify ↗</a>}</>}
            actions={<>
              <ModButton kind="approve" busy={busy === `linked|${r.id}`} onClick={() => dateAct("linked", "released", r.id)}>it&apos;s released</ModButton>
              <ModButton kind="dismiss" busy={busy === `linked|${r.id}`} onClick={() => dateAct("linked", "dismiss", r.id)}>it isn&apos;t</ModButton>
            </>} />
        ))}
      </>)}

      {data && tab === "garbled" && (<>
        <p className="comment-meta">Broken characters (from text read in the wrong format), leftover web code like &ldquo;&amp;apos;&rdquo;, and stray spaces. Each has its fix ready.</p>
        {garbled.length === 0 && <ModEmpty>None left.</ModEmpty>}
        {garbled.map((g) => (
          <ModRow key={g.id}
            title={<><Link href={`/song/${g.id}`} className="tc-old">{g.title}</Link> → <b>{g.fixed}</b></>}
            meta={<Link href={`/artist/${g.artist_id}`}>{g.artist}</Link>}
            actions={<>
              <ModButton kind="approve" busy={busy === `garbled|${g.id}`} onClick={async () => { if (await act("garbled", g.id, "fix")) setNotice({ kind: "done", text: `Now “${g.fixed}”.` }); }}>fix</ModButton>
              <ModButton kind="dismiss" busy={busy === `garbled|${g.id}`} onClick={() => act("garbled", g.id, "dismiss")}>leave it</ModButton>
            </>}
          />
        ))}
      </>)}
    </ModPage>
  );
}
