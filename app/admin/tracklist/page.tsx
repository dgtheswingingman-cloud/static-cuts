"use client";

// Paste a tracklist: copy a list of songs from anywhere (an album page, a
// tweet, a notes app) and add them to an artist's page in one go. Numbers,
// bullets and running times are tidied off, "feat." names go in the
// featured field, and songs already on the page are skipped. Everything
// added is one batch in the undo history.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin } from "../../useIsAdmin";
import NoAccess, { UndoHistoryLink } from "../../components/NoAccess";
import { ModPage, ModNotice, ModSection } from "../../components/Mod";

const STATUSES = ["released", "leaked", "snippet", "teased", "announced", "rumored", "unconfirmed"];

type Line = { title: string; featuring: string | null };

// "03. Song Name (feat. Someone) 3:12" -> { title: "Song Name", featuring: "Someone" }
function parseLine(raw: string): Line | null {
  let t = raw.trim();
  if (!t) return null;
  // "1. ", "01) ", "3 - " and bullets; not "22 Savage" or "1-800".
  t = t.replace(/^(\d{1,3}\s*[.):\-–]\s+|\d{1,3}[.)]\s*|[-•*–]\s+)/, "");
  t = t.replace(/\s*[\[(]?\b\d{1,2}:\d{2}\b[\])]?\s*$/, "");
  let featuring: string[] = [];
  t = t.replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)\]]*)[)\]]/gi, (_m, who) => { featuring.push(who.trim()); return ""; });
  t = t.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+(.*)$/i, (_m, who) => { featuring.push(who.trim()); return ""; });
  t = t.replace(/^["“”']+|["“”']+$/g, "").replace(/\s{2,}/g, " ").trim();
  featuring = featuring.filter(Boolean);
  return t ? { title: t, featuring: featuring.join(", ") || null } : null;
}

function TracklistInner() {
  const { loading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const params = useSearchParams();
  const [artistId, setArtistId] = useState(params.get("artist") ?? "");
  const [artistName, setArtistName] = useState<string | null>(null);
  const [artistQuery, setArtistQuery] = useState("");
  const [artistHits, setArtistHits] = useState<{ id: string; name: string }[]>([]);
  const [text, setText] = useState("");
  const [album, setAlbum] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("released");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!artistId) { setArtistName(null); return; }
    supabase.from("artists").select("name").eq("id", artistId).maybeSingle()
      .then(({ data }) => setArtistName(data?.name ?? null));
  }, [artistId]);

  useEffect(() => {
    const q = artistQuery.trim();
    if (q.length < 2) { setArtistHits([]); return; }
    const t = setTimeout(() => {
      supabase.from("artists").select("id, name").ilike("name", `%${q}%`).order("name").limit(8)
        .then(({ data }) => setArtistHits((data as { id: string; name: string }[]) ?? []));
    }, 250);
    return () => clearTimeout(t);
  }, [artistQuery]);

  const lines = useMemo(() => text.split(/\r?\n/).map(parseLine).filter(Boolean) as Line[], [text]);

  async function add() {
    if (!artistId || lines.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const { data, error: err } = await supabase.rpc("admin_paste_tracklist", {
      p_artist_id: artistId,
      p_items: lines,
      p_album: album.trim() || null,
      p_release_date: date || null,
      p_status: status,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setResult(data as { added: number; skipped: string[] });
    setText("");
  }

  if (!isAdmin) return <NoAccess loading={authLoading} who="admin" />;

  return (
    <ModPage
      title="Paste a tracklist"
      back={artistId ? `/artist/${artistId}` : "/control"}
      backLabel={artistId ? artistName ?? "artist" : "control room"}
      intro={<>
        One song per line, copied from anywhere. Numbers, bullets and running times are tidied off, &quot;feat.&quot; names
        go in the featured field, and songs already on the page are skipped. You can reverse it from the <UndoHistoryLink />.
      </>}
    >

      {!artistId || !artistName ? (
        <div style={{ marginBottom: 16 }}>
          <input className="search-input" style={{ width: "100%" }} placeholder="Which artist?" value={artistQuery}
            onChange={(e) => setArtistQuery(e.target.value)} autoFocus />
          {artistHits.map((a) => (
            <button key={a.id} className="review-row" style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer" }}
              onClick={() => { setArtistId(a.id); setArtistQuery(""); router.replace(`/admin/tracklist?artist=${a.id}`); }}>
              {a.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="review-toolbar">
          <div className="review-toolbar-row">
            <span className="review-toolbar-label">artist</span>
            <strong>{artistName}</strong>
            <button className="mod-btn plain" onClick={() => { setArtistId(""); setResult(null); }}>change</button>
          </div>
          <div className="review-toolbar-row">
            <span className="review-toolbar-label">album</span>
            <input className="search-input" style={{ flex: "1 1 200px" }} placeholder="optional (adds track numbers)"
              value={album} onChange={(e) => setAlbum(e.target.value)} />
            <input type="date" className="sort-select" aria-label="Release date" value={date} onChange={(e) => setDate(e.target.value)} />
            <select className="sort-select" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      )}

      {artistName && (
        <>
          <textarea className="search-input" style={{ width: "100%", minHeight: 200, fontFamily: "inherit", marginTop: 12 }}
            placeholder={"1. First Song\n2. Second Song (feat. Someone)\n3. Third Song 3:12"}
            value={text} onChange={(e) => setText(e.target.value)} />

          {lines.length > 0 && (
            <>
              <ModSection>{lines.length} song{lines.length === 1 ? "" : "s"} to add</ModSection>
              {lines.map((l, i) => (
                <div key={i} className="review-row" style={{ gridTemplateColumns: "2.2em minmax(0, 1fr)" }}>
                  <span className="comment-meta">{album.trim() ? i + 1 : "·"}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="review-row-title">{l.title}</div>
                    {l.featuring && <div className="review-row-meta"><span>feat. {l.featuring}</span></div>}
                  </div>
                </div>
              ))}
              <button className="mod-btn approve" style={{ marginTop: 12 }} disabled={busy} onClick={add}>
                {busy ? "adding…" : `add ${lines.length} song${lines.length === 1 ? "" : "s"} as ${status}`}
              </button>
            </>
          )}
        </>
      )}

      {error && <div style={{ marginTop: 12 }}><ModNotice kind="error">Couldn&apos;t add them: {error}</ModNotice></div>}
      {result && (
        <div className="mod-notice done" style={{ marginTop: 12, display: "block" }}>
          {result.added} song{result.added === 1 ? "" : "s"} added.
          {result.skipped.length > 0 && <> Already on the page, so skipped: {result.skipped.join(", ")}.</>}{" "}
          <Link href={`/artist/${artistId}`}>See the page</Link>
        </div>
      )}
    </ModPage>
  );
}

export default function TracklistPage() {
  return (
    <Suspense fallback={<div className="wrap"><div className="empty-state">loading…</div></div>}>
      <TracklistInner />
    </Suspense>
  );
}
