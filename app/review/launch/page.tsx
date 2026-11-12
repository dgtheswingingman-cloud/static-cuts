"use client";

// Launch clean-up (moderators): the launch artists and what's still missing
// on their songs (unconfirmed imports, covers, leak and release dates,
// albums / eras), so it's clear when each one is ready to promote. Tap a
// number for the songs behind it, open them to fix, or copy the list for
// ChatGPT. Admins can add or take artists off the list.

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
type Gap = { id: string; title: string; status: string; album: string | null; release_date: string | null; leak_date: string | null; code: string | null };

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

function Gaps({ h, kind, onClose }: { h: Health; kind: Kind; onClose: () => void }) {
  const [list, setList] = useState<Gap[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setList(null); setErr(null);
    supabase.rpc("admin_launch_gaps", { p_artist: h.artist_id, p_kind: kind, p_limit: 500 }).then(({ data, error }) => {
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
      {!list && !err && <ModLoading what="songs" />}
      {list && list.length === 0 && <ModEmpty>Nothing left here.</ModEmpty>}
      {list && list.length > 0 && (
        <ul className="lh-list">
          {list.map((g) => (
            <li key={g.id}>
              <Link href={`/song/${g.id}`} target="_blank" className="lh-song">{g.title}</Link>
              <span className="lh-meta">{g.status}{g.album ? ` · ${g.album}` : ""}{g.code ? ` · ${g.code}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {list && list.length >= 500 && <p className="lh-small">Showing the first 500.</p>}
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
                  {open?.artist === r.artist_id && <Gaps h={r} kind={open.kind} onClose={() => setOpen(null)} />}
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
