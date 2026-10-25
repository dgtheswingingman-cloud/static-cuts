"use client";

// Local Cuts: tidy your music files with the archive. Pick your download
// folder; each file's details are read on your computer (nothing uploaded),
// matched to the exact song and version (best guesses marked), then saved as
// clean copies: right title, artist, album, year and cover art, consistent
// names, sorted into folders, ready for Spotify Local Files or any player.
// Originals are never touched. Extras: play your files here, add them to
// your collection, "play my file" on song pages.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../useIsAdmin";
import { AdminModePage } from "../components/AdminModeNote";
import { readDuration, readTags } from "./tags";
import { fileKey, unusedKey } from "./fileIdentity";
import { assessVersion, type VersionCandidate } from "./versionMatch";
import { setLocalFile } from "./store";
import Tidy from "./Tidy";

type Status = "sure" | "check" | "none";
type Item = {
  key: string; name: string; size: number;
  title: string | null; artist: string | null; album: string | null; from: "tags" | "name"; duration: number | null;
  track_id: string | null; match_title: string | null; match_artist: string | null; artist_id: string | null;
  parent_id: string | null; status: Status; reason: string; owned: boolean; added_at: number;
  edit?: { title?: string; artist?: string; album?: string; year?: string };
};
type Version = { id: string; title: string; status: string | null; is_main: boolean };

const SAVE_KEY = "static_cuts_local_cuts";
const AUDIO = /\.(mp3|m4a|mp4|aac|flac|wav|ogg|oga|opus|webm|alac|aiff?)$/i;

function tidy(s: string | null) {
  return (s ?? "").toLowerCase().replace(/\s*[([]\s*(feat|ft|featuring|with|prod)\b[^)\]]*[)\]]/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
}
function firstArtist(s: string | null) {
  return (s ?? "").split(/\s*(?:,|&|\bx\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|;|\/)\s*/i)[0]?.trim() || null;
}
function mmss(sec: number | null) {
  if (!sec) return "";
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
function loadSaved(): Item[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "[]");
    if (!Array.isArray(v)) return [];
    // Earlier builds described title-only guesses as certain. Preserve manual
    // confirmations, but require review of those old automatic matches.
    return v.map((i: Item) => i.status === "sure" && i.reason?.startsWith("Title and artist match")
      ? { ...i, status: "check" as Status, reason: "Previously matched by title only. Confirm which recording you have." }
      : i);
  } catch { return []; }
}
function save(items: Item[]) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(items.slice(0, 5000))); } catch { /* full or private */ }
}

export default function LocalCutsPage() {
  const { loading } = useAuth();
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const [items, setItems] = useState<Item[]>([]);
  const files = useRef(new Map<string, File>()); // item key -> file (this visit only)
  const [, setTick] = useState(0);
  const [progress, setProgress] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"artist" | "title" | "added">("artist");
  const [playing, setPlaying] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<string[]>([]);
  const [view, setView] = useState<"tidy" | "library">("tidy");
  const audio = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => { setItems(loadSaved()); }, []);
  useEffect(() => { if (items.length) save(items); }, [items]);

  // ------------------------------------------------------------- adding

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const picked = Array.from(list).filter((f) => AUDIO.test(f.name) || f.type.startsWith("audio/"));
    if (picked.length === 0) { setMessage("None of those are music files."); return; }
    setMessage(null);
    const known = new Map<string, Item>(items.map((i: Item) => [i.key, i] as [string, Item]));
    const reserved = new Set(known.keys());
    const fresh: Item[] = [];
    for (let i = 0; i < picked.length; i++) {
      const f = picked[i];
      // Identify by folder-relative path, byte size and sampled file content.
      // Reconnect previously selected files without merging different recordings.
      const baseKey = await fileKey(f);
      const existing = known.get(baseKey);
      if (existing) {
        files.current.set(baseKey, f);
        if (existing.track_id && existing.status === "sure") setLocalFile(existing.track_id, f);
        continue;
      }
      const key = unusedKey(baseKey, reserved);
      reserved.add(key);
      files.current.set(key, f);
      setProgress(`Reading ${i + 1} of ${picked.length}…`);
      const t = await readTags(f);
      const duration = await readDuration(f);
      fresh.push({
        key, name: f.name, size: f.size, title: t.title, artist: t.artist, album: t.album, from: t.from, duration,
        track_id: null, match_title: null, match_artist: null, artist_id: null, parent_id: null,
        status: "none", reason: "", owned: false, added_at: Date.now(),
      });
    }
    setTick((x) => x + 1);
    if (fresh.length === 0) { setProgress(null); setMessage(`Reconnected ${picked.length} file${picked.length === 1 ? "" : "s"}.`); return; }
    if (!user) {
      setItems((prev) => [...prev, ...fresh.map((f) => ({ ...f, reason: "Log in to match songs to the archive." }))]);
      setProgress(null);
      return;
    }
    // Match in batches of 200.
    const matched: Item[] = [];
    for (let i = 0; i < fresh.length; i += 200) {
      setProgress(`Matching ${Math.min(i + 200, fresh.length)} of ${fresh.length}…`);
      const batch = fresh.slice(i, i + 200);
      const { data, error } = await supabase.rpc("rpc_match_my_songs", {
        p_items: batch.map((f) => ({ artist: firstArtist(f.artist) ?? "", title: f.title ?? "" })), p_artist_id: null,
      });
      if (error) { setMessage(error.message); matched.push(...batch); continue; }
      const rows = (data as { track_id: string | null; title: string | null; artist_id: string | null; owned: boolean }[]) ?? [];
      batch.forEach((f, j) => {
        const r = rows[j];
        if (!f.artist) { matched.push({ ...f, reason: "No artist in the file's details or name: fix it by hand." }); return; }
        if (!r?.artist_id) { matched.push({ ...f, reason: `"${firstArtist(f.artist)}" isn't an artist here yet.` }); return; }
        if (!r.track_id) { matched.push({ ...f, artist_id: r.artist_id, reason: "Artist found, but no song with this title." }); return; }
        matched.push({
          ...f, track_id: r.track_id, match_title: r.title, artist_id: r.artist_id, owned: !!r.owned,
          status: "check",
          reason: `Suggested catalogue match: “${r.title}”. Confirm the exact recording before using its metadata.`,
        });
      });
    }
    // Which versions are main songs, and artist names, for display.
    const ids = matched.filter((m) => m.track_id).map((m) => m.track_id!);
    const meta = new Map<string, { parent: string | null; artist: string | null }>();
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await supabase.from("tracks").select("id, parent_track_id, artists(name)").in("id", ids.slice(i, i + 300));
      ((data as { id: string; parent_track_id: string | null; artists: { name: string } | null }[] | null) ?? [])
        .forEach((r) => meta.set(r.id, { parent: r.parent_track_id, artist: r.artists?.name ?? null }));
    }
    // The spreadsheet matcher returns only its first artist/title hit.
    // Check the song's linked versions without changing that shared RPC.
    const roots = [...new Set(ids.map((id) => meta.get(id)?.parent ?? id))];
    const versions = new Map<string, VersionCandidate[]>();
    const complete = new Map<string, boolean>();
    for (let i = 0; i < roots.length; i += 40) {
      const batch = roots.slice(i, i + 40);
      const [mains, children] = await Promise.all([
        supabase.from("tracks").select("id,title,parent_track_id").in("id", batch),
        supabase.from("tracks").select("id,title,parent_track_id").in("parent_track_id", batch).limit(1000),
      ]);
      const safe = !mains.error && !children.error && (children.data?.length ?? 0) < 1000;
      for (const root of batch) { versions.set(root, []); complete.set(root, safe); }
      if (!safe) continue;
      for (const row of [...(mains.data ?? []), ...(children.data ?? [])]) {
        const item = row as VersionCandidate;
        const root = item.parent_track_id ?? item.id;
        versions.get(root)?.push(item);
      }
    }
    const done = matched.map((m) => {
      if (!m.track_id) return m;
      const root = meta.get(m.track_id)?.parent ?? m.track_id;
      const decision = assessVersion(m.name, m.title, firstArtist(m.artist), versions.get(root) ?? [], complete.get(root) === true);
      const suggested = decision.candidate;
      return {
        ...m,
        track_id: suggested?.id ?? m.track_id,
        match_title: suggested?.title ?? m.match_title,
        parent_id: suggested?.parent_track_id ?? meta.get(m.track_id)?.parent ?? null,
        match_artist: meta.get(m.track_id)?.artist ?? null,
        owned: suggested && suggested.id !== m.track_id ? false : m.owned,
        status: "check" as Status,
        reason: decision.reason,
      };
    });
    // No automatically matched song is attached to the song-page player.
    // Users must explicitly confirm the recording first.
    setItems((prev) => [...prev, ...done]);
    setProgress(null);
    const sure = done.filter((d) => d.status === "sure").length, check = done.filter((d) => d.status === "check").length;
    setMessage(`${done.length} added: ${sure} matched, ${check} to check, ${done.length - sure - check} not found.`);
  }

  // ------------------------------------------------------------ playing

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = items.filter((i) => (filter === "all" || i.status === filter) &&
      (!needle || [i.title, i.artist, i.match_title, i.name].some((v) => (v ?? "").toLowerCase().includes(needle))));
    const by = (i: Item) => sort === "title" ? (i.match_title ?? i.title ?? i.name).toLowerCase()
      : sort === "added" ? String(9e15 - i.added_at) : `${(i.match_artist ?? i.artist ?? "~").toLowerCase()} ${(i.match_title ?? i.title ?? "").toLowerCase()}`;
    return [...list].sort((a, b) => by(a).localeCompare(by(b)));
  }, [items, filter, q, sort]);
  const playable = shown.filter((i) => files.current.has(i.key));

  function play(key: string | null) {
    const el = audio.current;
    if (!el) return;
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    setPlaying(key);
    if (!key) { el.pause(); return; }
    const f = files.current.get(key);
    if (!f) { setPlaying(null); return; }
    urlRef.current = URL.createObjectURL(f);
    el.src = urlRef.current;
    el.play().catch(() => { /* needs a tap on some phones */ });
  }
  function step(dir: 1 | -1) {
    const i = playable.findIndex((p) => p.key === playing);
    const next = playable[i + dir];
    if (next) play(next.key); else play(null);
  }

  // --------------------------------------------------------- collection

  async function collect(list: Item[]) {
    const ids = [...new Set(list.filter((i) => i.status === "sure" && i.track_id && !i.owned).map((i) => i.track_id!))];
    if (ids.length === 0) return;
    const { error } = await supabase.rpc("rpc_collect_many", { p_track_ids: ids });
    if (error) { setMessage(error.message); return; }
    setItems((prev) => prev.map((i) => (i.track_id && ids.includes(i.track_id) ? { ...i, owned: true } : i)));
    setLastAdded(ids);
    setMessage(`Added ${ids.length} song${ids.length === 1 ? "" : "s"} to your collection.`);
  }
  async function undoCollect() {
    if (!user || lastAdded.length === 0) return;
    const { error } = await supabase.from("track_ownership").delete().eq("user_id", user.id).in("track_id", lastAdded);
    if (error) { setMessage(error.message); return; }
    setItems((prev) => prev.map((i) => (i.track_id && lastAdded.includes(i.track_id) ? { ...i, owned: false } : i)));
    setMessage(`Undone: ${lastAdded.length} taken back out of your collection.`);
    setLastAdded([]);
  }

  function update(key: string, patch: Partial<Item>) {
    const previous = items.find((i) => i.key === key);
    const next = previous ? { ...previous, ...patch } : null;
    const f = files.current.get(key);
    if (previous?.track_id && (previous.track_id !== next?.track_id || next?.status !== "sure")) {
      // Only clear an association if another file is not using that same song.
      const replacement = items.find((i) => i.key !== key && i.track_id === previous.track_id && i.status === "sure");
      setLocalFile(previous.track_id, replacement ? files.current.get(replacement.key) ?? null : null);
    }
    if (next?.track_id && next.status === "sure" && f) setLocalFile(next.track_id, f);
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }
  function removeAll() {
    if (!confirm("Clear Local Cuts on this device? Your files and your collection aren't touched.")) return;
    play(null);
    items.forEach((i) => i.track_id && setLocalFile(i.track_id, null));
    files.current.clear();
    setItems([]);
    try { localStorage.removeItem(SAVE_KEY); } catch { /* fine */ }
  }

  if (isAdmin) return <AdminModePage title="Local Cuts" />;

  const counts = { sure: items.filter((i) => i.status === "sure").length, check: items.filter((i) => i.status === "check").length, none: items.filter((i) => i.status === "none").length };
  const missing = items.filter((i) => !files.current.has(i.key)).length;
  const sureNotOwned = items.filter((i) => i.status === "sure" && i.track_id && !i.owned);
  const now = items.find((i) => i.key === playing);

  return (
    <div className="wrap local-cuts" style={{ maxWidth: 760 }}>
      <h1 className="detail-name page-title">Local Cuts</h1>
      <div className="detail-meta" style={{ marginBottom: 14 }}>
        Tidy your music with the archive. Add your download folder and every file gets the right title, artist,
        album, year and cover art, a clean name and a proper folder, ready to copy to your phone for Spotify Local
        Files or any music app. Unsure matches get a best guess, marked for you to check. <b>Nothing is uploaded and
        your originals are never touched</b>: you get tidied copies.
      </div>

      <div className="local-pick">
        <label className="tab active local-pick-btn local-folder-main">
          + add a folder
          <input type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
        </label>
        <label className="tab local-pick-btn">
          + add songs
          <input type="file" multiple accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg,.opus,.aac" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        </label>
        {items.length > 0 && <button className="tab" onClick={removeAll}>clear</button>}
      </div>
      {!loading && !user && (
        <div className="comment-meta" style={{ marginBottom: 10 }}>
          <Link href="/login?next=/local" className="text-link">Log in</Link> to match songs to the archive and add them to your collection. You can still play them here.
        </div>
      )}
      {progress && <div className="comments-panel" style={{ marginBottom: 10 }}>{progress}</div>}
      {message && (
        <div className="comments-panel" style={{ marginBottom: 10 }}>
          {message}
          {lastAdded.length > 0 && <> <button className="text-link inline-btn" onClick={undoCollect}>undo</button></>}
        </div>
      )}
      {missing > 0 && (
        <div className="comment-meta" style={{ marginBottom: 10 }}>
          {missing} song{missing === 1 ? "" : "s"} remembered from last time. Phones and browsers forget files when you leave, so
          pick them again to play them (matches and fixes are kept).
        </div>
      )}

      {items.length === 0 && !progress && (
        <div className="empty-state">
          Add the folder you download music into (or a few songs) to start. MP3 and FLAC get their details rewritten;
          M4A, WAV and OGG are renamed and sorted. Got them in Spotify instead? See{" "}
          <Link href="/listen" className="text-link">how to listen</Link>.
        </div>
      )}

      {items.length > 0 && (
        <div className="tabs" style={{ marginBottom: 12 }}>
          <button className={`tab ${view === "tidy" ? "active" : ""}`} onClick={() => setView("tidy")}>tidy &amp; save</button>
          <button className={`tab ${view === "library" ? "active" : ""}`} onClick={() => setView("library")}>matches &amp; player</button>
        </div>
      )}
      {items.length > 0 && view === "tidy" && (
        <Tidy items={items} files={files.current}
          onEdit={(key, edit) => setItems((prev) => prev.map((x) => (x.key === key ? { ...x, edit } : x)))} />
      )}

      {items.length > 0 && view === "library" && (
        <>
          <div className="tabs" style={{ marginBottom: 8 }}>
            <button className={`tab ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>all ({items.length})</button>
            <button className={`tab ${filter === "sure" ? "active" : ""}`} onClick={() => setFilter("sure")}>matched ({counts.sure})</button>
            <button className={`tab ${filter === "check" ? "active" : ""}`} onClick={() => setFilter("check")}>check ({counts.check})</button>
            <button className={`tab ${filter === "none" ? "active" : ""}`} onClick={() => setFilter("none")}>not found ({counts.none})</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <input className="search-input" style={{ flex: "1 1 180px" }} placeholder="Search your songs…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="sort-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
              <option value="artist">by artist</option>
              <option value="title">by title</option>
              <option value="added">newest first</option>
            </select>
            {user && sureNotOwned.length > 0 && (
              <button className="tab active" onClick={() => confirm(`Add ${sureNotOwned.length} matched song${sureNotOwned.length === 1 ? "" : "s"} to your collection?`) && collect(sureNotOwned)}>
                collect {sureNotOwned.length} matched
              </button>
            )}
          </div>

          {shown.map((i) => (
            <div key={i.key} className={`local-row ${playing === i.key ? "is-playing" : ""}`}>
              <button className="local-play" disabled={!files.current.has(i.key)} aria-label={playing === i.key ? "Pause" : "Play"}
                onClick={() => (playing === i.key ? play(null) : play(i.key))}>{playing === i.key ? "■" : "▶"}</button>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="review-row-title">
                  {i.track_id ? <Link href={`/song/${i.track_id}`}>{i.match_title}</Link> : (i.title ?? i.name)}
                  <span className={`feature-tag local-${i.status}`}>{i.status === "sure" ? "matched" : i.status === "check" ? "check" : "not found"}</span>
                  {i.parent_id && <span className="feature-tag">version</span>}
                </div>
                <div className="review-row-meta">
                  <span>{i.match_artist ?? i.artist ?? "unknown artist"}</span>
                  {i.duration && <span>{mmss(i.duration)}</span>}
                  <span title={i.name} style={{ overflowWrap: "anywhere" }}>file: {i.title ?? "?"}{i.artist ? ` · ${i.artist}` : ""}</span>
                </div>
                {i.reason && <div className="comment-meta">{i.reason}</div>}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  {user && i.status === "sure" && i.track_id && (i.owned ? <span className="rating-chip">✓ collected</span>
                    : <button className="rating-chip" onClick={() => collect([i])}>collect</button>)}
                  {user && <button className="rating-chip" onClick={() => setFixing(fixing === i.key ? null : i.key)}>{fixing === i.key ? "close" : i.status === "sure" ? "change" : "choose version"}</button>}
                  {i.status === "check" && <button className="rating-chip" onClick={() => update(i.key, { status: "sure", reason: "You confirmed this match." })}>confirm this recording</button>}
                </div>
                {fixing === i.key && (
                  <FixMatch item={i} onPick={(m) => { update(i.key, m); setFixing(null); }}
                    onClear={() => { update(i.key, { track_id: null, match_title: null, match_artist: null, parent_id: null, status: "none", reason: "You left this unmatched." }); setFixing(null); }} />
                )}
              </div>
            </div>
          ))}
        </>
      )}

      <div className={`local-player ${now ? "" : "is-hidden"}`}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="review-row-title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{now?.match_title ?? now?.title ?? now?.name}</div>
          <div className="comment-meta">{now?.match_artist ?? now?.artist}</div>
        </div>
        <button className="rating-chip" onClick={() => step(-1)} aria-label="Previous">⏮</button>
        <button className="rating-chip" onClick={() => step(1)} aria-label="Next">⏭</button>
        <audio ref={audio} controls onEnded={() => step(1)} style={{ width: "100%", maxWidth: 360 }} />
      </div>
    </div>
  );
}

// Pick the right song by hand: search the archive, then the exact version.
function FixMatch({ item, onPick, onClear }: { item: Item; onPick: (patch: Partial<Item>) => void; onClear: () => void }) {
  const [q, setQ] = useState(`${item.title ?? ""} ${firstArtist(item.artist) ?? ""}`.trim());
  const [results, setResults] = useState<{ id: string; title: string; artist: string; artist_id: string; parent_track_id: string | null; status: string | null }[]>([]);
  const [versions, setVersions] = useState<Version[] | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("rpc_search_songs", { p_q: term, p_versions: true });
      setResults(((data as { items?: typeof results } | null)?.items ?? []).slice(0, 12));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // The song and all its versions, so the exact one can be chosen.
  useEffect(() => {
    const id = item.track_id;
    if (!id) { setVersions(null); return; }
    const main = item.parent_id ?? id;
    supabase.from("tracks").select("id, title, release_status, parent_track_id").or(`id.eq.${main},parent_track_id.eq.${main}`).limit(60)
      .then(({ data }) => setVersions(((data as { id: string; title: string; release_status: string | null; parent_track_id: string | null }[] | null) ?? [])
        .map((v) => ({ id: v.id, title: v.title, status: v.release_status, is_main: !v.parent_track_id }))
        .sort((a, b) => Number(b.is_main) - Number(a.is_main) || a.title.localeCompare(b.title))));
  }, [item.track_id, item.parent_id]);

  return (
    <div className="comments-panel" style={{ marginTop: 8 }}>
      {versions && versions.length > 1 && (
        <>
          <div className="comment-meta" style={{ marginBottom: 6 }}>Which version is your file?</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {versions.map((v) => (
              <button key={v.id} className={`rating-chip ${v.id === item.track_id ? "voted" : ""}`}
                onClick={() => onPick({ track_id: v.id, match_title: v.title, parent_id: v.is_main ? null : (item.parent_id ?? item.track_id), status: "sure", reason: "You picked this version." })}>
                {v.title}{v.is_main ? " (main)" : ""}
              </button>
            ))}
          </div>
        </>
      )}
      <input className="search-input" style={{ width: "100%" }} placeholder="Search the archive…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ marginTop: 6 }}>
        {results.map((r) => (
          <button key={r.id} className="local-result" onClick={() => onPick({
            track_id: r.id, match_title: r.title, match_artist: r.artist, artist_id: r.artist_id, parent_id: r.parent_track_id,
            status: "sure", reason: "You picked this match.",
          })}>
            <span>{r.title}{r.parent_track_id ? " (version)" : ""}</span>
            <span className="comment-meta">{r.artist}{r.status && r.status !== "unconfirmed" ? ` · ${r.status}` : ""}</span>
          </button>
        ))}
      </div>
      <button className="text-link inline-btn" style={{ marginTop: 6 }} onClick={onClear}>it&apos;s not in the archive: leave it unmatched</button>
    </div>
  );
}
