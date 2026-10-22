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
import ExportifyImport from "./ExportifyImport";

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

  // A Google Sheets link (shared as "anyone with the link can view").
  const [sheetUrl, setSheetUrl] = useState("");
  async function readSheet() {
    setBusy("sheet");
    setMessage(null);
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch("https://pcuyzaamcsegblrauxsa.functions.supabase.co/sheet-import", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
      body: JSON.stringify({ action: "user_csv", url: sheetUrl.trim() }),
    });
    const r = await res.json().catch(() => ({ error: `Failed (${res.status}).` }));
    setBusy(null);
    if (!res.ok || r.error) { setMessage(r.error ?? "Couldn't read that sheet."); return; }
    setText(r.csv);
    setMatches(null);
    setTitleCol(-1);
    setArtistCol(-1);
  }

  // Songs that weren't found: search for the right one by hand.
  const [fixing, setFixing] = useState<number | null>(null);
  const [fixQ, setFixQ] = useState("");
  const [fixHits, setFixHits] = useState<{ id: string; title: string; artist: string }[]>([]);
  useEffect(() => {
    const q = fixQ.trim();
    if (fixing === null || q.length < 2) { setFixHits([]); return; }
    const t = setTimeout(() => {
      supabase.from("tracks").select("id, title, artists!artist_id(name)").ilike("title", `%${q}%`).order("title").limit(10)
        .then(({ data }) => setFixHits(((data ?? []) as unknown as { id: string; title: string; artists: { name: string } | { name: string }[] | null }[])
          .map((x) => ({ id: x.id, title: x.title, artist: (Array.isArray(x.artists) ? x.artists[0]?.name : x.artists?.name) ?? "" }))));
    }, 250);
    return () => clearTimeout(t);
  }, [fixQ, fixing]);
  function pickFix(row: number, hit: { id: string; title: string }) {
    setMatches((prev) => (prev ?? []).map((m) => (m.row === row ? { ...m, track_id: hit.id, title: hit.title, owned: false } : m)));
    setFixing(null);
    setFixQ("");
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
      <button className="back-btn" onClick={() => router.push("/settings")}>← settings</button>
      <h1 className="detail-name page-title">Import Your Music</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        Tick the songs you already have in your collection, so you don&apos;t start from zero. Only your collection
        changes; nothing is added to the archive (except from Spotify, below).
      </div>

      <div className="section-label">From Spotify</div>
      <div className="detail-meta" style={{ marginBottom: 10 }}>
        Your Liked Songs and playlists on Spotify: songs already here are collected, and official songs by artists in the archive
        that are missing get added too. Invited testers only for now (Spotify limits new sites to a few accounts).
      </div>
      <Link href="/settings#spotify-import" className="tab active" style={{ display: "inline-block", textDecoration: "none", marginBottom: 18 }}>
        import from Spotify
      </Link>
      <ExportifyImport />

      <div className="section-label">From a spreadsheet</div>
      <div className="detail-meta" style={{ marginBottom: 12 }}>
        Paste a Google Sheets link, pick a CSV file, or paste the rows.
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <input className="search-input" style={{ flex: "1 1 260px" }} placeholder="Google Sheets link (shared as anyone with the link can view)"
          value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
        <button className="tab active" disabled={!sheetUrl.trim() || !!busy} onClick={readSheet}>{busy === "sheet" ? "reading…" : "read sheet"}</button>
      </div>
      <div className="comment-meta" style={{ marginBottom: 6 }}>or pick a CSV file:</div>
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
                Different spellings, or songs the archive doesn&apos;t have yet. Press <b>find</b> to pick the right song
                yourself; missing ones can be suggested from the artist&apos;s page.
              </div>
              {missing.slice(0, 150).map((m) => (
                <div key={m.row} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="review-row-title">{m.title_in}</div>
                    {m.artist_in && <div className="review-row-meta"><span>{m.artist_in}</span></div>}
                    {fixing === m.row && (
                      <div style={{ marginTop: 6 }}>
                        <input className="search-input" autoFocus style={{ width: "100%" }} placeholder="Search for the song…" value={fixQ}
                          onChange={(e) => setFixQ(e.target.value)} />
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                          {fixHits.map((h) => (
                            <button key={h.id} className="rating-chip" onClick={() => pickFix(m.row, h)}>{h.title} · {h.artist}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <button className="rating-chip" onClick={() => { setFixing(fixing === m.row ? null : m.row); setFixQ(m.title_in); }}>
                    {fixing === m.row ? "cancel" : "find"}
                  </button>
                </div>
              ))}
              {missing.length > 150 && <div className="comment-meta">…and {missing.length - 150} more.</div>}
            </>
          )}
        </>
      )}
    </div>
  );
}
