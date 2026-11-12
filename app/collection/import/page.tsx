"use client";

// Import your own spreadsheet into your collection: the songs you already
// track somewhere else get ticked here, so you don't start from zero.
// Private to you: nothing is added to the archive, only your collection.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../../useIsAdmin";
import { AdminModePage } from "../../components/AdminModeNote";
import ExportifyImport from "./ExportifyImport";
import SpotifyImport from "./SpotifyImport";
import Missing from "../../components/Missing";
import { usePremium } from "../../usePremium";

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
  const [src, setSrc] = useState<"spotify" | "apple" | "file">("spotify");
  const [owned, setOwned] = useState<number | null>(null);
  const [imported, setImported] = useState(0); // bumps after an import, to recount
  const { premium } = usePremium();
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

  useEffect(() => {
    try {
      const h = window.location.hash.slice(1);
      if (h === "apple" || h === "file") setSrc(h);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (!user) return;
    supabase.from("track_ownership").select("track_id", { count: "exact", head: true }).eq("user_id", user.id)
      .then(({ count }) => setOwned(count ?? 0));
  }, [user, matches, imported]);

  async function readFile(f: File | undefined) {
    if (!f) return;
    // Apple Music / iTunes "Export Playlist" saves UTF-16 text: read it as such.
    const buf = new Uint8Array(await f.arrayBuffer());
    const utf16 = (buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff);
    setText(new TextDecoder(utf16 ? (buf[0] === 0xff ? "utf-16le" : "utf-16be") : "utf-8").decode(buf).replace(/^\uFEFF/, ""));
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
    <div className="wrap im-page">
      <div className="ls-crumb"><Link href="/library">My Library</Link> / <span>Import</span></div>
      <h1 className="ls-title im-title">IMPORT YOUR MUSIC<span>//</span></h1>
      <p className="sb-lead">Bring your music into Static-Cuts. The songs you already have get ticked in your collection, so you don&apos;t start from zero.</p>

      <div className="im-stats">
        <span className="im-stat">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 3 8l9 5 9-5z" /><path d="m3 13 9 5 9-5" /></svg>
          Your collection: <b>{owned === null ? "…" : owned.toLocaleString("en-GB")}</b> songs
        </span>
        <Link href="/library#export" className="im-export">Export it instead →</Link>
      </div>

      <nav className="im-sources" aria-label="Where from">
        <button className={src === "spotify" ? "on" : undefined} aria-pressed={src === "spotify"} onClick={() => setSrc("spotify")}>
          <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#1DB954" /><path d="M6.5 9.3c3.6-1.1 7.8-.8 11 1M7.2 12.3c3-.9 6.4-.6 9 .9M7.8 15.1c2.4-.6 5-.4 7 .8" stroke="#070707" strokeWidth="1.6" strokeLinecap="round" fill="none" /></svg>
          <span><strong>Spotify//</strong><small>Your Liked Songs and playlists.</small></span>
        </button>
        <button className={src === "apple" ? "on" : undefined} aria-pressed={src === "apple"} onClick={() => setSrc("apple")}>
          <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#FA2D48" /><path d="M10 17.5V8l8-1.6v9.4" stroke="#fff" strokeWidth="1.6" fill="none" /><circle cx="8.6" cy="17.5" r="1.8" fill="#fff" /><circle cx="16.6" cy="15.8" r="1.8" fill="#fff" /></svg>
          <span><strong>Apple Music//</strong><small>A playlist or your library, exported from the Music app.</small></span>
        </button>
        <button className={src === "file" ? "on" : undefined} aria-pressed={src === "file"} onClick={() => setSrc("file")}>
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v4h16v-4" /></svg>
          <span><strong>File / CSV//</strong><small>A Google Sheet, CSV or a pasted list.</small></span>
        </button>
      </nav>

      {src === "spotify" && (
        <section className="nw-panel im-panel">
          <h2 className="nw-h im-h">From Spotify<span>//</span></h2>
          <p className="im-sub">Songs already here are collected, and official songs by artists in the archive that are missing get added too.</p>
          <div className="im-cols">
            <div>
              <h3 className="im-h3">With Exportify <small>(works for everyone, about a minute)</small></h3>
              <ol className="im-steps">
                <li>Open <a href="https://exportify.net" target="_blank" rel="noopener noreferrer" className="text-link">exportify.net</a> and log in with Spotify there.</li>
                <li>Press <b>Export All</b> (or export just the playlists you want). It downloads a file.</li>
                <li>Pick that file here.</li>
              </ol>
              <ExportifyImport onDone={() => setImported((n) => n + 1)} />
            </div>
            <div className="im-side">
              <h3 className="im-h3">Straight from Spotify <small>(invited testers)</small></h3>
              <p className="im-small">Spotify only lets new sites connect a handful of accounts. If it says you&apos;re not allowed, use Exportify.</p>
              <SpotifyImport onDone={() => setImported((n) => n + 1)} />
              <div className="im-what">
                <strong>What happens//</strong>
                <ul>
                  <li>Your songs are matched to the archive and the ones here are collected.</li>
                  <li>Songs by artists not in the archive are suggested for a moderator to add.</li>
                  <li>Big imports can take a few minutes.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      )}

      {src !== "spotify" && (
      <section className="nw-panel im-panel">
      <h2 className="nw-h im-h">{src === "apple" ? "From Apple Music" : "From a file"}<span>//</span></h2>
      {src === "apple" ? (
        <ol className="im-steps">
          <li>In the Music app on a Mac (or iTunes on Windows), select a playlist, or <b>Songs</b> for your whole library.</li>
          <li><b>File › Library › Export Playlist…</b> and save the .txt file.</li>
          <li>Pick that file below. On iPhone only, a free converter such as TuneMyMusic can save a playlist as a CSV.</li>
        </ol>
      ) : (
        <p className="im-sub">Paste a Google Sheets link, pick a CSV file, or paste the rows (with a header row like Artist, Song).</p>
      )}

      {src === "file" && (
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <input className="search-input" style={{ flex: "1 1 260px" }} placeholder="Google Sheets link (shared as anyone with the link can view)"
          value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
        <button className="tab active" disabled={!sheetUrl.trim() || !!busy} onClick={readSheet}>{busy === "sheet" ? "reading…" : "read sheet"}</button>
      </div>
      )}
      <label className="st-btn im-file">
        {src === "apple" ? "Pick the .txt file" : "Pick a CSV file"}
        <input type="file" accept=".csv,.tsv,.txt" hidden onChange={(e) => readFile(e.target.files?.[0])} />
      </label>
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
      </section>
      )}
      {user && (owned ?? 0) > 0 && (
        <Missing collection refresh={owned ?? 0} premium={!!premium}
          intro="From your whole collection (Spotify, Exportify and file imports included): every artist you have 3+ songs of, era by era." />
      )}
    </div>
  );
}
