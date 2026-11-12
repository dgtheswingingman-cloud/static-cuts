"use client";

// Launch clean-up (moderators): the launch artists and what's still missing
// on their songs (unconfirmed imports, covers, leak and release dates,
// albums / eras), so it's clear when each one is ready to promote. Tap a
// number for the songs behind it, open them to fix, or copy the list for
// ChatGPT. Unconfirmed songs can be ticked and marked released / leaked /
// snippet, or removed if they aren't real songs (quietly, undoable). Ones
// that look like a copy of another song by the artist (same title, a typo,
// or the other's name in brackets) say so, with a button to merge them in
// (undoable from the undo history).
// Admins can add or take artists off the list.

import "../../styles/launch.css";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { thumb } from "@/lib/thumb";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin, useIsModerator } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";
import { ModPage, ModNotice, ModLoading, ModEmpty } from "../../components/Mod";

type Kind = "unconfirmed" | "cover" | "leak_date" | "release_date" | "album";
type Health = { artist_id: string; artist: string; photo: string | null; songs: number; clean: number } & Record<Kind, number>;
type Twin = { id: string; title: string; status: string; why: "same" | "spell" | "alt" };
type Gap = { id: string; title: string; status: string; album: string | null; release_date: string | null; leak_date: string | null; code: string | null; twin?: Twin | null };
const WHY: Record<Twin["why"], string> = { same: "same title", spell: "spelled differently", alt: "other name for it" };

const KINDS: [Kind, string, string][] = [
  ["unconfirmed", "Unconfirmed", "Imports with no status yet: released, leaked, or not a real song?"],
  ["cover", "No cover", "Released songs, leaks and snippets with no cover and no fan cover."],
  ["leak_date", "Leak, no date", "Leaks with no leak date."],
  ["release_date", "Released, no date", "Released songs with no release date."],
  ["album", "No album / era", "Released songs, leaks and snippets with no album or era."],
];
const ASK: Record<Kind, string> = {
  unconfirmed: "work out the real status (released, leaked, snippet, or not a real song) of",
  cover: "find cover art (with the page it's from) for",
  leak_date: "find when each of these leaked (with a source) for",
  release_date: "find the release date (with a source) for",
  album: "find the album or era for",
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 100);

function Gaps({ h, kind, onClose, onChanged }: { h: Health; kind: Kind; onClose: () => void; onChanged: () => void }) {
  const [list, setList] = useState<Gap[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [copiesOnly, setCopiesOnly] = useState(false);
  const triage = kind === "unconfirmed";
  const copies = (list ?? []).filter((g) => g.twin);
  const shown = copiesOnly ? copies : list;
  // Merge each song into the one it looks like a copy of. Skips a pair whose
  // other half was already merged away in this go.
  async function merge(ids: string[]) {
    const todo = (list ?? []).filter((g) => ids.includes(g.id) && g.twin);
    if (!todo.length) return;
    if (!window.confirm(todo.length === 1
      ? `Merge "${todo[0].title}" into "${todo[0].twin!.title}"? (Undoable from the undo history.)`
      : `Merge ${todo.length} songs into the songs they look like copies of? (Undoable from the undo history.)`)) return;
    setBusy(true); setErr(null);
    const gone = new Set<string>();
    let n = 0;
    for (const g of todo) {
      if (gone.has(g.id) || gone.has(g.twin!.id)) continue;
      const { error } = await supabase.rpc("admin_merge_duplicates", { p_survivor: g.twin!.id, p_duplicates: [g.id] });
      if (error) { setErr(error.message); break; }
      gone.add(g.id); n++;
    }
    setBusy(false);
    setDone(`${n} merged.`);
    setList((l) => (l ?? []).filter((g) => !gone.has(g.id)).map((g) => (g.twin && gone.has(g.twin.id) ? { ...g, twin: null } : g)));
    setPicked(new Set());
    onChanged();
  }
  async function act(action: "released" | "leaked" | "snippet" | "remove") {
    const ids = [...picked];
    if (!ids.length) return;
    if (action === "remove" && !window.confirm(`Remove ${ids.length} entr${ids.length === 1 ? "y" : "ies"} that aren't real songs? (Undoable from the undo history.)`)) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("admin_launch_triage", { p_ids: ids, p_action: action });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDone(`${data ?? 0} ${action === "remove" ? "removed" : `marked ${action}`}.`);
    setList((l) => (l ?? []).filter((g) => !picked.has(g.id)));
    setPicked(new Set());
    onChanged();
  }
  useEffect(() => {
    setList(null); setErr(null); setPicked(new Set()); setDone(null);
    supabase.rpc("admin_launch_gaps", { p_artist: h.artist_id, p_kind: kind, p_limit: 1000 }).then(({ data, error }) => {
      if (error) setErr(error.message); else setList((data as Gap[]) ?? []);
    });
  }, [h.artist_id, kind]);
  const label = KINDS.find((k) => k[0] === kind)!;
  async function copy() {
    if (!list) return;
    const text = `For ${h.artist} on Static-Cuts, ${ASK[kind]} these songs, and send what you find through the Static-Cuts connector:\n`
      + list.map((g) => `- ${g.title}${g.code ? ` (${g.code})` : ""}${g.album ? ` [${g.album}]` : ""}`).join("\n");
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  }
  return (
    <div className="lh-gaps">
      <div className="lh-gaps-head">
        <b>{h.artist} · {label[1]}</b>
        <small>{label[2]}</small>
        <span className="lh-gaps-actions">
          <button className="tab" onClick={copy} disabled={!list?.length}>{copied ? "Copied" : "Copy for ChatGPT"}</button>
          <button className="tab" onClick={onClose}>Close</button>
        </span>
      </div>
      {err && <ModNotice kind="error">{err}</ModNotice>}
      {done && <ModNotice kind="done" onClose={() => setDone(null)}>{done}</ModNotice>}
      {triage && list && list.length > 0 && copies.length > 0 && (
        <div className="lh-triage">
          <span className="lh-small">{copies.length} look like copies of other songs.</span>
          <button className={`tab${copiesOnly ? " active" : ""}`} onClick={() => { setCopiesOnly(!copiesOnly); setPicked(new Set()); }}>
            {copiesOnly ? "Show all" : "Only copies"}
          </button>
        </div>
      )}
      {triage && shown && shown.length > 0 && (
        <div className="lh-triage">
          <label className="lh-all"><input type="checkbox" checked={picked.size === shown.length}
            onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((g) => g.id)) : new Set())} /> All</label>
          <span className="lh-small">{picked.size} ticked:</span>
          {(["released", "leaked", "snippet"] as const).map((a) => (
            <button key={a} className="tab" disabled={busy || !picked.size} onClick={() => act(a)}>Mark {a}</button>
          ))}
          <button className="tab lh-remove" disabled={busy || !picked.size} onClick={() => act("remove")}>Not a real song</button>
          {copies.some((g) => picked.has(g.id)) && (
            <button className="tab" disabled={busy} onClick={() => merge([...picked])}>Merge ticked copies</button>
          )}
        </div>
      )}
      {!list && !err && <ModLoading what="songs" />}
      {list && list.length === 0 && <ModEmpty>Nothing left here.</ModEmpty>}
      {shown && shown.length > 0 && (
        <ul className="lh-list">
          {shown.map((g) => (
            <li key={g.id} className={g.twin ? "lh-has-twin" : undefined}>
              {triage && <input type="checkbox" checked={picked.has(g.id)} aria-label={`Tick ${g.title}`}
                onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(g.id); else n.delete(g.id); return n; })} />}
              <Link href={`/song/${g.id}`} target="_blank" className="lh-song">{g.title}</Link>
              <span className="lh-meta">{g.status}{g.album ? ` · ${g.album}` : ""}{g.code ? ` · ${g.code}` : ""}</span>
              {g.twin && (
                <span className="lh-twin">
                  Copy of <Link href={`/song/${g.twin.id}`} target="_blank">{g.twin.title}</Link>
                  <small>{g.twin.status} · {WHY[g.twin.why]}</small>
                  <button className="tab" disabled={busy} onClick={() => merge([g.id])}>Merge into it</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {list && list.length >= 1000 && <p className="lh-small">Showing the first 1,000.</p>}
    </div>
  );
}

export default function LaunchPage() {
  const { loading: authLoading } = useAuth();
  const canModerate = useIsModerator();
  const isAdmin = useIsAdmin();
  const [rows, setRows] = useState<Health[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<{ artist: string; kind: Kind } | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; name: string }[]>([]);

  async function load() {
    const { data, error } = await supabase.rpc("admin_launch_health");
    if (error) setErr(error.message); else setRows((data as Health[]) ?? []);
  }
  useEffect(() => { if (canModerate) load(); }, [canModerate]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => {
      supabase.from("artists").select("id, name").ilike("name", `%${q.trim()}%`).order("name").limit(6)
        .then(({ data }) => setHits((data as { id: string; name: string }[]) ?? []));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function setOn(id: string, on: boolean) {
    const { error } = await supabase.rpc("admin_launch_set", { p_artist: id, p_on: on });
    if (error) { setErr(error.message); return; }
    setQ(""); setHits([]); setOpen(null); load();
  }

  if (authLoading) return <ModPage title="LAUNCH CLEAN-UP"><ModLoading /></ModPage>;
  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;

  const total = (rows ?? []).reduce((a, r) => a + r.songs, 0);
  const clean = (rows ?? []).reduce((a, r) => a + r.clean, 0);
  const ready = (rows ?? []).filter((r) => KINDS.every(([k]) => r[k] === 0)).length;

  return (
    <ModPage title="LAUNCH CLEAN-UP"
      intro={<>What&apos;s still missing on the launch artists&apos; songs. An artist is ready when every number is 0. Tap a number for the songs behind it; &ldquo;Copy for ChatGPT&rdquo; makes a ready-to-paste request for a routine.</>}>
      {err && <ModNotice kind="error" onClose={() => setErr(null)}>{err}</ModNotice>}
      {!rows && !err && <ModLoading what="launch artists" />}
      {rows && (
        <>
          <div className="lh-summary">
            <span><b>{ready}</b> of {rows.length} ready</span>
            <span><b>{pct(clean, total)}%</b> of {total.toLocaleString("en-GB")} songs complete</span>
          </div>
          <div className="lh-table" role="table">
            <div className="lh-row lh-th" role="row">
              <span role="columnheader">Artist</span>
              {KINDS.map(([k, label, why]) => <span key={k} role="columnheader" title={why}>{label}</span>)}
              <span role="columnheader">Complete</span>
            </div>
            {rows.map((r) => {
              const done = KINDS.every(([k]) => r[k] === 0);
              return (
                <div key={r.artist_id} className="lh-block">
                  <div className={`lh-row${done ? " ready" : ""}`} role="row">
                    <span className="lh-artist" role="cell">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {r.photo ? <img src={thumb(r.photo)} alt="" /> : <span className="lh-blank" />}
                      <Link href={`/artist/${r.artist_id}`} target="_blank">{r.artist}</Link>
                      {done && <span className="lh-ready">READY</span>}
                      {isAdmin && <button className="lh-x" title="Take off the launch list" onClick={() => setOn(r.artist_id, false)}>✕</button>}
                    </span>
                    {KINDS.map(([k, label]) => (
                      <span key={k} role="cell" data-label={label}>
                        {r[k] === 0 ? <span className="lh-zero">0</span> : (
                          <button className={`lh-n${open?.artist === r.artist_id && open.kind === k ? " on" : ""}`}
                            onClick={() => setOpen(open?.artist === r.artist_id && open.kind === k ? null : { artist: r.artist_id, kind: k })}>
                            {r[k].toLocaleString("en-GB")}
                          </button>
                        )}
                      </span>
                    ))}
                    <span role="cell" data-label="Complete" className="lh-pct">
                      <b>{pct(r.clean, r.songs)}%</b>
                      <span className="lh-bar"><span style={{ width: `${pct(r.clean, r.songs)}%` }} /></span>
                    </span>
                  </div>
                  {open?.artist === r.artist_id && <Gaps h={r} kind={open.kind} onClose={() => setOpen(null)} onChanged={load} />}
                </div>
              );
            })}
          </div>
          {isAdmin && (
            <div className="lh-add">
              <input className="st-input" placeholder="Add an artist to the launch list…" value={q} onChange={(e) => setQ(e.target.value)} />
              {hits.length > 0 && (
                <div className="lh-hits">
                  {hits.filter((h) => !rows.some((r) => r.artist_id === h.id)).map((h) => (
                    <button key={h.id} className="tab" onClick={() => setOn(h.id, true)}>+ {h.name}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="lh-small">Launch artists also go first in the automatic cover and Deezer search.</p>
        </>
      )}
    </ModPage>
  );
}
