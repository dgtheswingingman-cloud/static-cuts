"use client";

// Title checks (admins): rule-based checks over the whole catalogue, run
// nightly, no AI.
//   Cut-off titles: cut at 28-30 characters mid-word (old MP3 tags cap
//     titles at 30; nearly all came from Last.fm) where the same artist has
//     the full-title song. Merge into the right one (collections, ratings,
//     versions and links move over, the old page redirects), or "not the
//     same".
//   Garbled text: broken characters, leftover HTML and stray spaces, each
//     with its fix ready. Titles that can't be fixed for certain aren't
//     listed.
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
type Tab = "cut" | "garbled";

export default function TitleChecksPage() {
  const { loading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>("cut");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "done" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.rpc("admin_title_checks").then(({ data: d, error }) => {
      if (error) { setNotice({ kind: "error", text: error.message }); setData({ cut: [], garbled: [], checked_at: null }); return; }
      setData((d as Data) ?? { cut: [], garbled: [], checked_at: null });
    });
  }, [isAdmin]);

  async function act(kind: Tab, id: string, action: "merge" | "dismiss" | "fix", target?: string) {
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
    <ModPage title="Title checks"
      intro={<>Problems found in song titles across the whole archive, checked every night. Nothing changes until you choose; merges and fixes can be undone from the <UndoHistoryLink />.</>}>
      {notice && <ModNotice kind={notice.kind} onClose={() => setNotice(null)}>{notice.text}</ModNotice>}
      <ModToolbar right={tab === "garbled" && garbled.length > 1
        ? <ModButton kind="approve" busy={!!busy} confirm={`Apply all ${garbled.length} fixes?`} onClick={fixAll}>fix all {garbled.length}</ModButton> : undefined}>
        <ModTabs<Tab> value={tab} onChange={setTab} tabs={[
          { key: "cut", label: "Cut-off titles", count: cut.length },
          { key: "garbled", label: "Garbled text", count: garbled.length },
        ]} />
      </ModToolbar>
      {!data && <ModLoading />}
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
