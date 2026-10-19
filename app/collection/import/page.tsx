"use client";

// Import your own spreadsheet into your collection: the songs you already
// track somewhere else get ticked here, so you don't start from zero.
// Private to you: nothing is added to the archive, only your collection.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../../useIsAdmin";
import { AdminModePage } from "../../components/AdminModeNote";

type Match = { row: number; artist_in: string | null; title_in: string; artist_id: string | null; track_id: string | null; title: string | null; owned: boolean };

// Plain CSV/TSV reading (quoted cells with commas and line breaks work).
function parseTable(text: string): string[][] {
  const sep = text.split("\n")[0].includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const guess = (header: string[], re: RegExp) => header.findIndex((h) => re.test(h.trim()));

export default function CollectionImportPage() {
  const { loading } = useAuth();
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [text, setText] = useState("");
  const [titleCol, setTitleCol] = useState(-1);
  const [artistCol, setArtistCol] = useState(-1);
  const [artistQuery, setArtistQuery] = useState("");
  const [artistHits, setArtistHits] = useState<{ id: string; name: string }[]>([]);
  const [artist, setArtist] = useState<{ id: string; name: string } | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const rows = useMemo(() => parseTable(text), [text]);
  const header = rows[0] ?? [];

  useEffect(() => {
    if (!header.length) return;
    setTitleCol((c) => (c >= 0 ? c : Math.max(0, guess(header, /^(title|song|name|track|song name|track name)$/i))));
    setArtistCol((c) => (c >= 0 ? c : guess(header, /^(artist|artists|main artist)$/i)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header.join("|")]);

  useEffect(() => {
    const q = artistQuery.trim();
    if (q.length < 2) { setArtistHits([]); return; }
    const t = setTimeout(() => {
      supabase.from("artists").select("id, name").ilike("name", `%${q}%`).order("name").limit(8)
        .then(({ data }) => setArtistHits((data as { id: string; name: string }[]) ?? []));
    }, 250);
    return () => clearTimeout(t);
  }, [artistQuery]);

  async function readFile(f: File | undefined) {
    if (!f) return;
    setText(await f.text());
    setMatches(null);
    setTitleCol(-1);
    setArtistCol(-1);
  }

  async function match() {
    const items = rows.slice(1).map((r) => ({ title: (r[titleCol] ?? "").split("\n")[0].trim(), artist: artistCol >= 0 ? (r[artistCol] ?? "").trim() : null }))
      .filter((x) => x.title);
    setBusy("match");
    setMessage(null);
    const out: Match[] = [];
    for (let i = 0; i < items.length; i += 500) {
      const { data, error } = await supabase.rpc("rpc_match_my_songs", { p_items: items.slice(i, i + 500), p_artist_id: artist?.id ?? null });
      if (error) { setMessage(error.message); break; }
      out.push(...((data as Match[]) ?? []).map((m) => ({ ...m, row: m.row + i })));
      setMessage(`Matching… ${Math.min(i + 500, items.length)} of ${items.length}`);
    }
    setBusy(null);
    setMatches(out);
    setMessage(null);
  }

  async function collect() {
    const ids = [...new Set((matches ?? []).filter((m) => m.track_id && !m.owned).map((m) => m.track_id as string))];
    setBusy("collect");
    let added = 0;
    for (let i = 0; i < ids.length; i += 1000) {
      const { data, error } = await supabase.rpc("rpc_collect_many", { p_track_ids: ids.slice(i, i + 1000) });
      if (error) { setMessage(error.message); break; }
      added += (data as number) ?? 0;
    }
    setBusy(null);
    setMessage(`${added} song${added === 1 ? "" : "s"} added to your collection.`);
    setMatches((prev) => (prev ?? []).map((m) => (m.track_id ? { ...m, owned: true } : m)));
  }

  if (isAdmin) return <AdminModePage title="Import my spreadsheet" />;
  if (!loading && !user) {
    return <div className="wrap"><div className="empty-state"><Link href="/login" className="text-link">Log in</Link> to import your collection.</div></div>;
  }

  const found = (matches ?? []).filter((m) => m.track_id);
  const newOnes = found.filter((m) => !m.owned);
  const missing = (matches ?? []).filter((m) => !m.track_id);
  const ready = rows.length > 1 && titleCol >= 0 && (artistCol >= 0 || artist);

  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <button className="back-btn" onClick={() => router.push(user ? `/profile/${user.id}` : "/")}>← profile</button>
      <h1 className="detail-name page-title">Import My Spreadsheet</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        Already track what you have in a spreadsheet? Bring it here and the songs you list get ticked in your
        collection. In Google Sheets use File → Download → CSV, then pick the file below (or paste the rows).
        Only your collection changes; nothing is added to the archive.
      </div>

      <input type="file" accept=".csv,.tsv,.txt" onChange={(e) => readFile(e.target.files?.[0])} style={{ marginBottom: 10 }} />
      <textarea className="search-input" style={{ width: "100%", minHeight: 110, fontFamily: "inherit" }}
        placeholder={"or paste here, with a header row:\nArtist,Song\nPlayboi Carti,Magnolia"}
        value={text} onChange={(e) => { setText(e.target.value); setMatches(null); }} />

      {header.length > 0 && (
        <div className="review-toolbar" style={{ marginTop: 12 }}>
          <div className="review-toolbar-row">
            <span className="review-toolbar-label">song column</span>
            <select className="sort-select" value={titleCol} onChange={(e) => { setTitleCol(Number(e.target.value)); setMatches(null); }}>
              {header.map((h, i) => <option key={i} value={i}>{h || `column ${i + 1}`}</option>)}
            </select>
            <span className="review-toolbar-label">artist column</span>
            <select className="sort-select" value={artistCol} onChange={(e) => { setArtistCol(Number(e.target.value)); setMatches(null); }}>
              <option value={-1}>none: one artist</option>
              {header.map((h, i) => <option key={i} value={i}>{h || `column ${i + 1}`}</option>)}
            </select>
          </div>
          {artistCol < 0 && (
            <div className="review-toolbar-row">
              <span className="review-toolbar-label">all by</span>
              {artist ? (
                <><strong>{artist.name}</strong><button className="rating-chip" onClick={() => setArtist(null)}>change</button></>
              ) : (
                <div style={{ flex: "1 1 220px" }}>
                  <input className="search-input" style={{ width: "100%" }} placeholder="Which artist?" value={artistQuery}
                    onChange={(e) => setArtistQuery(e.target.value)} />
                  {artistHits.map((a) => (
                    <button key={a.id} className="rating-chip" style={{ margin: "4px 4px 0 0" }}
                      onClick={() => { setArtist(a); setArtistQuery(""); setMatches(null); }}>{a.name}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="review-toolbar-row">
            <span className="comment-meta">{rows.length - 1} rows</span>
            <button className="tab active" disabled={!ready || !!busy} onClick={match}>find my songs</button>
          </div>
        </div>
      )}

      {message && <div className="comments-panel" style={{ marginTop: 12 }}>{message}</div>}

      {matches && (
        <>
          <div className="section-label">
            Found {found.length} of {matches.length}{newOnes.length < found.length ? ` (${found.length - newOnes.length} already collected)` : ""}
          </div>
          {newOnes.length > 0 && (
            <button className="tab active" disabled={!!busy} onClick={collect} style={{ marginBottom: 12 }}>
              {busy === "collect" ? "adding…" : `add ${newOnes.length} to my collection`}
            </button>
          )}
          {found.slice(0, 200).map((m) => (
            <div key={m.row} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title"><Link href={`/song/${m.track_id}`} target="_blank">{m.title}</Link></div>
                <div className="review-row-meta">
                  {m.title_in !== m.title && <span>yours: {m.title_in}</span>}
                  {m.artist_in && <span>{m.artist_in}</span>}
                </div>
              </div>
              {m.owned && <span className="feature-tag">collected</span>}
            </div>
          ))}
          {found.length > 200 && <div className="comment-meta">…and {found.length - 200} more.</div>}
          {missing.length > 0 && (
            <>
              <div className="section-label">Not found here ({missing.length})</div>
              <div className="comment-meta" style={{ marginBottom: 6 }}>
                Different spellings, or songs the archive doesn&apos;t have yet. You can suggest missing ones from the artist&apos;s page.
              </div>
              <div className="comment-meta" style={{ lineHeight: 1.7 }}>
                {missing.slice(0, 150).map((m) => `${m.title_in}${m.artist_in ? ` (${m.artist_in})` : ""}`).join(" · ")}
                {missing.length > 150 ? ` · …and ${missing.length - 150} more` : ""}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
