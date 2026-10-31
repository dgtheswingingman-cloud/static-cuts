"use client";

// Import a community spreadsheet (moderators). Paste a sheet tab's link,
// check how its columns are read, preview the songs, then import: they go to
// the imported songs review list with the usual duplicate checks.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import NoAccess from "../../components/NoAccess";

const FN_URL = "https://pcuyzaamcsegblrauxsa.functions.supabase.co/sheet-import";

type Field = "title" | "artist" | "era" | "notes" | "length" | "file_date" | "leak_date" | "release_date" |
  "type" | "availability" | "quality" | "links" | "producers" | "features";
type Mapping = {
  header_row: number;
  columns: Partial<Record<Field, number>>;
  default_status: string;
  status_column: "availability" | "type" | null;
  status_values: Record<string, string>;
  links: "official" | "all" | "none";
  skip_eras: string[];
  banner?: { column: number; contains: string; name_column: number } | null;
};
type Preview = {
  sheet_id: string; gid: string; title: string | null; tabs: { gid: string; name: string }[]; header: string[];
  rows: string[][]; row_count: number; mapping: Mapping;
  values: { availability: [string, number][]; type: [string, number][] };
  existing: { id: string; title: string; artist_id: string; credit: string | null; auto_sync: boolean; tab_name: string | null } | null;
};
type Parsed = {
  total: number; skipped: number; eras: Record<string, number>; statuses: Record<string, number>;
  artists: Record<string, number>;
  songs: { title: string; artists: string[]; status: string; album: string | null; featuring: string | null; producers: string | null; notes: string | null; listen_url: string | null; row: number }[];
};
type Source = {
  id: string; title: string; tab_name: string | null; credit: string | null; url: string; artist_id: string; artist: string;
  songs: number; last_synced_at: string | null; auto_sync: boolean; next_check_at: string | null; waiting?: number;
};
type Request = { sheet_id: string; url: string; artist_name: string | null; notes: string | null; people: number; first_at: string };

const FIELDS: [Field, string, string][] = [
  ["title", "Song name", "Required. \"Artist - Title (feat. X) (prod. Y)\" is split up automatically."],
  ["artist", "Artist", "Only if the sheet has its own artist column."],
  ["era", "Era / album", "Era banner rows are picked up automatically too."],
  ["notes", "Notes", ""],
  ["availability", "Available length", "e.g. Full, OG File, Snippet: used for the status."],
  ["type", "Type", "e.g. Demo, Throwaway: kept in the notes."],
  ["leak_date", "Leak date", "Kept in the notes."],
  ["release_date", "Release date", "Used for released songs."],
  ["file_date", "File date", "Kept in the notes."],
  ["quality", "Quality", "Kept in the notes."],
  ["length", "Track length", "Kept in the notes."],
  ["links", "Links", ""],
  ["producers", "Producers", "Also read from \"(prod. X)\" in names."],
  ["features", "Features", "Also read from \"(feat. X)\" in names."],
];
const STATUSES = ["leaked", "snippet", "released", "rumored", "teased", "announced", "unconfirmed"];

const sheetIdOf = (u: string) => u.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)?.[1] ?? u;
const gidOf = (u: string) => u.match(/[#?&]gid=(\d+)/)?.[1] ?? "0";

async function callFn(body: unknown) {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const r = await res.json().catch(() => ({ error: `Failed (${res.status}).` }));
  if (!res.ok || r.error) throw new Error(r.error || `Failed (${res.status}).`);
  return r;
}

// What the tracker did to songs already on the site.
function trackerSummary(r: { statuses?: number; details?: number; disagree?: number }) {
  const parts = [
    `${r.statuses ?? 0} status${r.statuses === 1 ? "" : "es"} filled in`,
    `${r.details ?? 0} song${r.details === 1 ? "" : "s"} given missing details`,
  ];
  if (r.disagree) parts.push(`${r.disagree} disagreement${r.disagree === 1 ? "" : "s"} sent to "Tracker disagrees"`);
  return `Songs already here: ${parts.join(", ")}.`;
}

export default function SheetsPage() {
  const { user, loading: authLoading } = useAuth();
  const canModerate = useIsModerator();
  const router = useRouter();

  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [credit, setCredit] = useState("");
  const [artist, setArtist] = useState<{ id: string; name: string } | null>(null);
  const [artistQuery, setArtistQuery] = useState("");
  const [artistResults, setArtistResults] = useState<{ id: string; name: string }[]>([]);
  const [autoSync, setAutoSync] = useState(true);
  const [permission, setPermission] = useState(false);

  const [sources, setSources] = useState<Source[]>([]);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [allLog, setAllLog] = useState<string[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);

  async function loadLists() {
    const [{ data: s }, { data: r }] = await Promise.all([
      supabase.rpc("rpc_sheet_sources"),
      supabase.rpc("admin_sheet_requests"),
    ]);
    setSources((s as Source[]) ?? []);
    setRequests((r as Request[]) ?? []);
  }
  useEffect(() => {
    if (canModerate) loadLists();
  }, [canModerate]);

  useEffect(() => {
    const q = artistQuery.trim();
    if (q.length < 2) { setArtistResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("artists").select("id, name").ilike("name", `%${q}%`).limit(8);
      setArtistResults(data ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [artistQuery]);

  async function loadPreview(link = url) {
    setBusy("preview");
    setMessage(null);
    setParsed(null);
    try {
      const p = (await callFn({ action: "preview", url: link })) as Preview;
      setPreview(p);
      setMapping(p.mapping);
      const tab = p.tabs.find((t) => t.gid === p.gid)?.name;
      setTitle(p.existing?.title ?? (p.title ? `${p.title}${tab ? ` (${tab})` : ""}` : ""));
      setCredit(p.existing?.credit ?? "");
      setAutoSync(p.existing?.auto_sync ?? true);
      setAiNote(null);
      // Another tab of this spreadsheet already imported: same artist and credit.
      const sibling = !p.existing ? sources.find((s) => sheetIdOf(s.url) === p.sheet_id) : undefined;
      if (sibling) {
        setArtist({ id: sibling.artist_id, name: sibling.artist });
        setCredit(sibling.credit ?? "");
        setPermission(true);
        if (p.title) setTitle(`${p.title}${tab ? ` (${tab})` : ""}`);
      }
      if (p.existing) {
        const { data } = await supabase.from("artists").select("id, name").eq("id", p.existing.artist_id).maybeSingle();
        if (data) setArtist(data);
        setMessage("This tab has been imported before. Importing again only adds songs that aren't on the site yet.");
      }
    } catch (e: any) {
      setMessage(e.message);
    }
    setBusy(null);
  }

  // "Work it out": the AI reads a sample of this tab and fills in every
  // setting below, then the songs are previewed straight away.
  async function workItOut() {
    setBusy("ai");
    setMessage(null);
    try {
      const r = await callFn({ action: "ai_mapping", url });
      setMapping(r.mapping as Mapping);
      setAiNote(r.explanation || "Done. Check the settings and the songs below.");
      setParsed((await callFn({ action: "parse", url, mapping: r.mapping })) as Parsed);
    } catch (e: any) {
      setMessage(e.message);
    }
    setBusy(null);
  }

  // Every tab at once: the AI works out each tab, then it's imported with the
  // same artist and credit. Tabs already imported and info tabs (credits,
  // stats, key...) are left out; a tab with hardly any songs is skipped.
  // Tabs that aren't song lists, are just favourites of songs on other tabs,
  // or would bring in fake songs (AI tracks, fakes, fan edits). "Recent" tabs
  // repeat songs from the main tabs, so they're left out too.
  const INFO_TAB = /info|credit|stat|faq|key|legend|about|changelog|guide|read ?me|rules|template|links?$|fake|\bai\b|fan edit|stem|tracklist|best of|worst of|grail|wanted|special|merch|\bart\b|tours?\b|interview|video|social|buys?\b|compilation|album cop|misc|performance|remix|\beras?\b|account|production|producer|museum|exhibit|media|radio|front ?page|lives?\b|instagram|skeptical|photo|pics|samples?\b|edits?\b|comps?\b|instrumentals?|drill ?dance|^projects?$|recent/i;
  async function importAllTabs() {
    if (!preview || !artist) return;
    const todo = preview.tabs.filter((t) => !INFO_TAB.test(t.name)
      && !sources.some((x) => sheetIdOf(x.url) === preview.sheet_id && gidOf(x.url) === t.gid));
    setBusy("all");
    setMessage(null);
    const log: string[] = [];
    const say = (line: string) => { log.push(line); setAllLog([...log]); };
    for (const t of todo) {
      const tabUrl = `https://docs.google.com/spreadsheets/d/${preview.sheet_id}/edit#gid=${t.gid}`;
      try {
        say(`${t.name}: working it out…`);
        const ai = await callFn({ action: "ai_mapping", url: tabUrl });
        const p = (await callFn({ action: "parse", url: tabUrl, mapping: ai.mapping })) as Parsed;
        if (p.total < 3) { log[log.length - 1] = `${t.name}: skipped (not a list of songs).`; setAllLog([...log]); continue; }
        const r = await callFn({
          action: "import", url: tabUrl, mapping: ai.mapping, title: `${preview.title ?? "Tracker"} (${t.name})`,
          credit, artist_id: artist.id, tab_name: t.name, auto_sync: autoSync, permission_confirmed: permission,
        });
        log[log.length - 1] = `${t.name}: ${p.total} songs read, ${r.suggested} new sent to review.`;
        setAllLog([...log]);
      } catch (e: any) {
        log[log.length - 1] = `${t.name}: stopped (${e.message})`;
        setAllLog([...log]);
      }
    }
    if (todo.length === 0) say("Every tab is already imported.");
    setBusy(null);
    loadLists();
  }

  async function runParse() {
    if (!mapping) return;
    setBusy("parse");
    setMessage(null);
    try {
      setParsed((await callFn({ action: "parse", url, mapping })) as Parsed);
    } catch (e: any) {
      setMessage(e.message);
    }
    setBusy(null);
  }

  async function runImport() {
    if (!mapping || !artist) return;
    setBusy("import");
    setMessage(null);
    try {
      const tab = preview?.tabs.find((t) => t.gid === preview.gid)?.name ?? null;
      const r = await callFn({
        action: "import", url, mapping, title, credit, artist_id: artist.id, tab_name: tab,
        auto_sync: autoSync, permission_confirmed: permission,
      });
      setMessage(`Done: ${r.suggested} new song${r.suggested === 1 ? "" : "s"} sent to the review list. ${trackerSummary(r)}`);
      setParsed(null);
      loadLists();
    } catch (e: any) {
      setMessage(e.message);
    }
    setBusy(null);
  }

  async function syncNow(s: Source) {
    setBusy(s.id);
    setMessage(null);
    try {
      const r = await callFn({ action: "sync", source_id: s.id });
      setMessage(`${s.title}: ${r.suggested} new song${r.suggested === 1 ? "" : "s"} sent to the review list. ${trackerSummary(r)}`);
      loadLists();
    } catch (e: any) {
      setMessage(e.message);
    }
    setBusy(null);
  }

  async function updateSource(s: Source, autoSync: boolean, remove = false) {
    if (remove && !confirm(`Remove "${s.title}" as a source? Its songs stay on the site.`)) return;
    await supabase.rpc("admin_update_sheet_source", { p_id: s.id, p_auto_sync: autoSync, p_delete: remove });
    loadLists();
  }

  async function decline(r: Request) {
    await supabase.rpc("admin_decline_sheet_request", { p_sheet_id: r.sheet_id });
    loadLists();
  }

  function setCol(f: Field, v: string) {
    if (!mapping) return;
    const columns = { ...mapping.columns };
    if (v === "") delete columns[f]; else columns[f] = Number(v);
    setMapping({ ...mapping, columns });
    setParsed(null);
  }

  if (!canModerate) return <NoAccess loading={authLoading} who="moderators" />;
  const artistPicker = artist ? (
    <span className="feature-tag" style={{ cursor: "pointer" }} onClick={() => setArtist(null)}>{artist.name} ✕</span>
  ) : (
    <>
      <input className="search-input" placeholder="Search artists…" value={artistQuery} onChange={(e) => setArtistQuery(e.target.value)} />
      {artistResults.map((a) => (
        <button key={a.id} className="rating-chip" onClick={() => { setArtist(a); setArtistQuery(""); }}>{a.name}</button>
      ))}
    </>
  );
  const tabsLeft = preview ? preview.tabs.filter((t) => !INFO_TAB.test(t.name)
    && !sources.some((x) => sheetIdOf(x.url) === preview.sheet_id && gidOf(x.url) === t.gid)) : [];
  const statusValues = mapping?.status_column ? preview?.values[mapping.status_column] ?? [] : [];

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/control")}>← control room</button>
      <h1 className="detail-name page-title">Import a spreadsheet</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        Paste a link to a community tracker (shared as &ldquo;anyone with the link can view&rdquo;).
        Songs go to the <Link href="/review/imports" className="text-link">imported songs</Link> list for review,
        credited to the sheet and its makers. Leak file links are left out; only official listening links are kept.
      </div>

      {message && <div className="comments-panel" style={{ marginBottom: 14 }}>{message}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input className="search-input" style={{ flex: 1 }} placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=…"
          value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="tab active" disabled={!url.trim() || busy !== null} onClick={() => loadPreview()}>
          {busy === "preview" ? "reading…" : "read sheet"}
        </button>
      </div>

      {preview && mapping && (
        <>
          {preview.tabs.length > 1 && (
            <div className="filter-group" style={{ marginBottom: 14 }}>
              <span className="comment-meta">tabs (✓ already imported)</span>
              {preview.tabs.map((t) => (
                <button key={t.gid} className={`tab ${t.gid === preview.gid ? "active" : ""}`} disabled={busy !== null}
                  onClick={() => {
                    const next = `https://docs.google.com/spreadsheets/d/${preview.sheet_id}/edit#gid=${t.gid}`;
                    setUrl(next);
                    loadPreview(next);
                  }}>
                  {sources.some((s) => sheetIdOf(s.url) === preview.sheet_id && gidOf(s.url) === t.gid) ? "✓ " : ""}{t.name}
                </button>
              ))}
            </div>
          )}

          {tabsLeft.length > 1 && (
            <div className="ai-box" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <div>
                <strong>Do every tab at once</strong>
                <div className="comment-meta">
                  The AI works out each tab ({tabsLeft.map((t) => t.name).join(", ")}) and imports it. Songs still go to the review list.
                  Info tabs and tabs already imported are left out.
                </div>
              </div>
              <div className="sheet-map">
                <label className="sheet-map-row"><span>Artist</span><span>{artistPicker}</span></label>
                <label className="sheet-map-row"><span>Made by</span>
                  <input className="search-input" value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="e.g. the Carti tracker team" /></label>
              </div>
              <label className="comment-body" style={{ display: "flex", gap: 10 }}>
                <input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} />
                I made this sheet, or its makers are happy for it to be imported here
              </label>
              <div>
                <button className="tab active" disabled={busy !== null || !artist || !permission} onClick={importAllTabs}>
                  {busy === "all" ? "working…" : `work out and import ${tabsLeft.length} tabs`}
                </button>
              </div>
              {allLog.length > 0 && <div className="comment-meta" style={{ whiteSpace: "pre-line" }}>{allLog.join("\n")}</div>}
            </div>
          )}

          <div className="ai-box">
            <div>
              <strong>{tabsLeft.length > 1 ? "Or just this tab" : "Let the AI work it out"}</strong>
              <div className="comment-meta">Reads a sample of this tab and fills in every setting below (columns, statuses, era rows), then shows the songs. About a quarter of a penny. You can still change anything.</div>
            </div>
            <button className="tab active" disabled={busy !== null} onClick={workItOut}>{busy === "ai" ? "working it out…" : "work it out"}</button>
          </div>
          {aiNote && <div className="comments-panel" style={{ marginBottom: 14 }}>{aiNote}</div>}
          {mapping.banner && (
            <div className="comment-meta" style={{ marginBottom: 10 }}>
              Era rows: a row where column {String.fromCharCode(65 + (mapping.banner.column % 26))} contains &ldquo;{mapping.banner.contains}&rdquo; starts a new era (name from column {String.fromCharCode(65 + (mapping.banner.name_column % 26))}).{" "}
              <button className="text-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
                onClick={() => { setMapping({ ...mapping, banner: null }); setParsed(null); }}>turn off</button>
            </div>
          )}

          <div className="section-label" style={{ marginTop: 0 }}>1. Which column is which</div>
          <div className="comment-meta" style={{ marginBottom: 10 }}>
            Guessed from the headers in row {mapping.header_row + 1}. Change anything that&apos;s wrong.{" "}
            Header row:{" "}
            <select className="sort-select" value={mapping.header_row} onChange={(e) => { setMapping({ ...mapping, header_row: Number(e.target.value) }); setParsed(null); }}>
              {preview.rows.slice(0, 15).map((r, i) => <option key={i} value={i}>row {i + 1}: {r.filter(Boolean).slice(0, 3).join(" · ").slice(0, 50)}</option>)}
            </select>
          </div>
          <div className="sheet-map">
            {FIELDS.map(([f, label, hint]) => (
              <label key={f} className="sheet-map-row">
                <span>
                  {label}
                  {hint && <span className="comment-meta" style={{ display: "block" }}>{hint}</span>}
                </span>
                <select className="sort-select" value={mapping.columns[f] ?? ""} onChange={(e) => setCol(f, e.target.value)}>
                  <option value="">not in this sheet</option>
                  {(preview.rows[mapping.header_row] ?? []).map((h, i) => (
                    <option key={i} value={i}>{String.fromCharCode(65 + (i % 26))}: {(h.split("\n")[0] || "(blank)").slice(0, 30)}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="section-label">2. Status</div>
          <div className="comment-body" style={{ marginBottom: 10 }}>
            Songs in this tab are{" "}
            <select className="sort-select" value={mapping.default_status}
              onChange={(e) => { setMapping({ ...mapping, default_status: e.target.value }); setParsed(null); }}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>{" "}
            unless the{" "}
            <select className="sort-select" value={mapping.status_column ?? ""}
              onChange={(e) => { setMapping({ ...mapping, status_column: (e.target.value || null) as Mapping["status_column"] }); setParsed(null); }}>
              <option value="">(no column)</option>
              <option value="availability">available length</option>
              <option value="type">type</option>
            </select>{" "}
            column says otherwise:
          </div>
          {statusValues.length > 0 && (
            <div className="sheet-map">
              {statusValues.map(([v, n]) => (
                <label key={v} className="sheet-map-row">
                  <span>&ldquo;{v}&rdquo; <span className="comment-meta">({n})</span></span>
                  <select className="sort-select" value={mapping.status_values[v] ?? ""}
                    onChange={(e) => {
                      const sv = { ...mapping.status_values };
                      if (e.target.value) sv[v] = e.target.value; else delete sv[v];
                      setMapping({ ...mapping, status_values: sv });
                      setParsed(null);
                    }}>
                    <option value="">automatic</option>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          <div className="comment-body" style={{ marginTop: 10 }}>
            Links:{" "}
            <select className="sort-select" value={mapping.links} onChange={(e) => { setMapping({ ...mapping, links: e.target.value as Mapping["links"] }); setParsed(null); }}>
              <option value="official">official listening links only (recommended)</option>
              <option value="none">no links</option>
              <option value="all">every link (includes leak file hosts)</option>
            </select>
          </div>

          <div style={{ marginTop: 18 }}>
            <button className="tab active" disabled={busy !== null || mapping.columns.title === undefined} onClick={runParse}>
              {busy === "parse" ? "reading songs…" : "preview songs"}
            </button>
          </div>
        </>
      )}

      {parsed && mapping && (
        <>
          <div className="section-label">3. Check the songs</div>
          <div className="health-tiles">
            <div className="health-tile"><div className="health-tile-value">{parsed.total}</div><div className="health-tile-label">songs read</div></div>
            {Object.entries(parsed.statuses).map(([s, n]) => (
              <div key={s} className="health-tile"><div className="health-tile-value">{n}</div><div className="health-tile-label">{s}</div></div>
            ))}
            <div className="health-tile"><div className="health-tile-value">{parsed.skipped}</div><div className="health-tile-label">rows skipped</div></div>
          </div>
          {Object.keys(parsed.eras).length > 0 && (
            <div className="filter-group" style={{ marginTop: 12 }}>
              <span className="comment-meta">eras (tap to leave one out)</span>
              {Object.entries(parsed.eras).map(([e, n]) => {
                const skipped = mapping.skip_eras.includes(e);
                return (
                  <button key={e} className={`tab ${skipped ? "" : "active"}`}
                    onClick={() => setMapping({ ...mapping, skip_eras: skipped ? mapping.skip_eras.filter((x) => x !== e) : [...mapping.skip_eras, e] })}>
                    {skipped ? "✗ " : ""}{e} ({n})
                  </button>
                );
              })}
            </div>
          )}
          {Object.keys(parsed.artists).length > 1 && (
            <div className="comment-meta" style={{ marginTop: 10 }}>
              Names before the dash: {Object.entries(parsed.artists).map(([a, n]) => `${a} (${n})`).join(", ")}. A song goes on that
              artist&apos;s page if they&apos;re on the site, otherwise on the sheet&apos;s artist with a &ldquo;credited to&rdquo; note.
            </div>
          )}
          <div className="sheet-preview">
            {parsed.songs.slice(0, 60).map((s) => (
              <div key={s.row} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
                <div style={{ minWidth: 0 }}>
                  <div className="review-row-title">{s.title}</div>
                  <div className="review-row-meta">
                    {s.artists.length > 0 && <span>{s.artists.join(" & ")}</span>}
                    <span className="feature-tag">{s.status}</span>
                    {s.album && <span>{s.album}</span>}
                    {s.featuring && <span>feat. {s.featuring}</span>}
                    {s.producers && <span>prod. {s.producers}</span>}
                    {s.listen_url && <span>has link</span>}
                    <span className="comment-meta">row {s.row}</span>
                  </div>
                </div>
              </div>
            ))}
            {parsed.total > 60 && <div className="comment-meta">…and {parsed.total - 60} more.</div>}
          </div>
          {mapping.skip_eras.length > 0 && (
            <button className="tab" style={{ marginTop: 10 }} onClick={runParse}>refresh preview</button>
          )}

          <div className="section-label">4. Credit and import</div>
          <div className="sheet-map">
            <label className="sheet-map-row">
              <span>Artist this sheet is for</span>
              <span>{artistPicker}</span>
            </label>
            <label className="sheet-map-row">
              <span>Sheet name</span>
              <input className="search-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="City Morgue Tracker (Unreleased)" />
            </label>
            <label className="sheet-map-row">
              <span>
                Made by
                <span className="comment-meta" style={{ display: "block" }}>From the sheet&apos;s credits tab. Shown on every song.</span>
              </span>
              <input className="search-input" value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="e.g. the City Morgue Discord tracker team" />
            </label>
          </div>
          <label className="comment-body" style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} />
            Check this sheet for new songs now and then (weekly, less often if it goes quiet) and send them to the review list
          </label>
          <label className="comment-body" style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} />
            I made this sheet, or its makers are happy for it to be imported here
          </label>
          <div style={{ marginTop: 14 }}>
            <button className="tab active" disabled={busy !== null || !artist || !permission || !title.trim()} onClick={runImport}>
              {busy === "import" ? "importing…" : `import ${parsed.total} songs for review`}
            </button>
          </div>
        </>
      )}

      {requests.length > 0 && (
        <>
          <div className="section-label">Sheets people have sent in</div>
          {requests.map((r) => (
            <div key={r.sheet_id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="help-link">{r.artist_name ?? r.url}</a>
                </div>
                <div className="review-row-meta">
                  <span>{r.people} {r.people === 1 ? "person" : "people"}</span>
                  {r.notes && <span>{r.notes}</span>}
                </div>
              </div>
              <span style={{ display: "flex", gap: 6 }}>
                <button className="rating-chip" onClick={() => { setUrl(r.url); loadPreview(r.url); window.scrollTo({ top: 0, behavior: "smooth" }); }}>open</button>
                <button className="rating-chip danger" onClick={() => decline(r)}>decline</button>
              </span>
            </div>
          ))}
        </>
      )}

      <div className="section-label">Imported sheets</div>
      {sources.length === 0 && <div className="comment-meta">None yet.</div>}
      {/* One entry per spreadsheet, its tabs underneath. */}
      {Object.values(sources.reduce<Record<string, Source[]>>((acc, x) => {
        (acc[sheetIdOf(x.url)] = acc[sheetIdOf(x.url)] || []).push(x);
        return acc;
      }, {})).map((tabs) => {
        const first = tabs[0];
        const name = first.title.replace(/\s*\([^)]*\)\s*$/, "") || first.title;
        const busyHere = tabs.some((t) => busy === t.id);
        return (
          <div key={sheetIdOf(first.url)} className="sheet-group">
            <div className="sheet-group-head">
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title">
                  <a href={first.url} target="_blank" rel="noopener noreferrer">{name}</a>
                </div>
                <div className="review-row-meta">
                  <Link href={`/artist/${first.artist_id}`}>{first.artist}</Link>
                  <span>{tabs.reduce((n, t) => n + t.songs, 0)} songs added</span>
                  <span>{tabs.length} tab{tabs.length === 1 ? "" : "s"}</span>
                  {first.credit && <span>by {first.credit}</span>}
                </div>
              </div>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="rating-chip" disabled={busy !== null} onClick={async () => { for (const t of tabs) await syncNow(t); }}>
                  {busyHere ? "checking…" : tabs.length > 1 ? "check all tabs" : "check now"}
                </button>
                <button className="rating-chip" disabled={busy !== null}
                  onClick={() => { setUrl(first.url); loadPreview(first.url); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                  add a tab
                </button>
              </span>
            </div>
            {tabs.map((s) => (
              <div key={s.id} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                <div style={{ minWidth: 0 }}>
                  <div className="review-row-title" style={{ fontSize: "0.82rem" }}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer">{s.tab_name ?? s.title}</a>
                  </div>
                  <div className="review-row-meta">
                    <span>{s.songs} song{s.songs === 1 ? "" : "s"}</span>
                    {(s.waiting ?? 0) > 0 && (
                      <Link href="/review/imports" className="text-link">{s.waiting} waiting for review</Link>
                    )}
                    {s.last_synced_at && <span>checked {new Date(s.last_synced_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                    {s.auto_sync && s.next_check_at && <span>next check {new Date(s.next_check_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                  </div>
                </div>
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {tabs.length > 1 && (
                    <button className="rating-chip" disabled={busy !== null} onClick={() => syncNow(s)}>{busy === s.id ? "checking…" : "check"}</button>
                  )}
                  <button className={`rating-chip ${s.auto_sync ? "rated" : ""}`} onClick={() => updateSource(s, !s.auto_sync)}>
                    auto-check {s.auto_sync ? "on" : "off"}
                  </button>
                  <button className="rating-chip danger" onClick={() => updateSource(s, s.auto_sync, true)}>remove</button>
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
