"use client";

// Community spreadsheets the archive has imported, credited to their makers,
// and a form to send in another one.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import InfoShell, { InfoSection } from "../components/info/InfoShell";
import { useAuth } from "../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../useIsAdmin";

type Source = {
  id: string; title: string; tab_name: string | null; credit: string | null; url: string; artist_id: string; artist: string;
  songs: number; created_at: string; last_synced_at: string | null; auto_sync: boolean;
};

export default function SourcesPage() {
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [url, setUrl] = useState("");
  const [artistName, setArtistName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("rpc_sheet_sources").then(({ data }) => setSources((data as Source[]) ?? []));
    // Coming from an artist page's "know a fan tracker?" link.
    const a = new URLSearchParams(window.location.search).get("artist");
    if (a) setArtistName(a);
  }, []);

  async function send() {
    if (!user) { if (!isAdmin) router.push("/login"); return; }
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.rpc("rpc_request_sheet", { p_url: url.trim(), p_artist_name: artistName, p_note: note });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    const r = data as { result: string; title?: string; same_tab?: boolean };
    if (r.result === "already_imported") {
      setMessage(r.same_tab
        ? `Already imported as “${r.title}”. New songs added to it are picked up when it's re-checked.`
        : `Another tab of this sheet is already imported (“${r.title}”). A moderator can add this tab too.`);
    } else if (r.result === "already_requested") {
      setMessage("Someone has already sent this sheet in. Your vote's been added, and a moderator will look at it.");
    } else {
      setMessage("Thanks! A moderator will look at it. Imported songs are credited to the sheet and its makers.");
      setUrl(""); setArtistName(""); setNote("");
    }
  }

  const ext = <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>;
  const OFFICIAL: [string, string, string, React.ReactNode][] = [
    ["Spotify", "Official releases, track details and release dates.", "https://open.spotify.com",
      <svg key="s" viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#1DB954" /><path d="M6.5 9.3c3.6-1.1 7.8-.8 11 1M7.2 12.3c3-.9 6.4-.6 9 .9M7.8 15.1c2.4-.6 5-.4 7 .8" stroke="#070707" strokeWidth="1.6" strokeLinecap="round" fill="none" /></svg>],
    ["Genius", "Track info, credits (producers, features) and artwork.", "https://genius.com",
      <svg key="g" viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#FFFF64" /><path d="M7 8.5c1.5 2 3.2 3 5 3s3.5-1 5-3M8 15.5c2.5 1.6 5.5 1.6 8 0" stroke="#070707" strokeWidth="1.8" strokeLinecap="round" fill="none" /></svg>],
    ["Last.fm", "Artist info, genres and listening data.", "https://www.last.fm",
      <span key="l" className="st-lastfm" style={{ width: 34, textAlign: "center" }}>as</span>],
    ["Deezer", "Release information and catalogue coverage.", "https://www.deezer.com",
      <svg key="d" viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#A238FF" /><path d="M5 16h2.5M8.5 16h2.5M12 16h2.5M15.5 16H18M12 13h2.5M15.5 13H18M15.5 10H18M15.5 7H18" stroke="#fff" strokeWidth="2" /></svg>],
  ];

  return (
    <InfoShell title="SOURCES" here="/sources" intro="Where the information comes from, and what each source is used for."
      sections={[["official", "Official sources"], ["community", "Community trackers"], ["send", "Send us a sheet"]]}>
      <InfoSection id="official" title="Official sources">
        <div className="if-cards">
          {OFFICIAL.map(([name, text, href, icon]) => (
            <a key={name} href={href} target="_blank" rel="noopener noreferrer" className="if-card if-link-card">
              {icon}
              <span><strong>{name}</strong><small>{text}</small></span>
              {ext}
            </a>
          ))}
        </div>
        <p className="if-p if-dim">Each song shows where its details came from.</p>
      </InfoSection>

      <InfoSection id="community" title="Community trackers">
        <p className="if-p">A lot of what&apos;s here was first put together by fan communities in their own trackers. These are the sheets we&apos;ve imported, with thanks to the people who made them. Every song from a sheet links back to it.</p>
        {!sources && <div className="comment-meta">loading…</div>}
        {sources && sources.length === 0 && <div className="comment-meta">None yet.</div>}
        {sources?.map((x) => (
          <div key={x.id} className="if-sheet">
            <span className="if-sheet-text">
              <a href={x.url} target="_blank" rel="noopener noreferrer" className="if-sheet-title">{x.title} ↗</a>
              <small>
                <Link href={`/artist/${x.artist_id}`}>{x.artist}</Link>
                {x.credit && <> · by {x.credit}</>}
                {" · "}{x.songs} song{x.songs === 1 ? "" : "s"}
                {x.auto_sync && " · kept up to date"}
              </small>
            </span>
          </div>
        ))}
      </InfoSection>

      <InfoSection id="send" title="Send us a sheet">
        <p className="if-p">Know a good community tracker? Send the link (shared as &ldquo;anyone with the link can view&rdquo;). If it&apos;s already been imported we&apos;ll tell you.</p>
        {isAdmin ? (
          <div className="comment-meta">Admin mode: import sheets yourself from <Link href="/admin/sheets" className="text-link">import a spreadsheet</Link>.</div>
        ) : (
          <div className="if-form">
            <input className="sb-text" placeholder="https://docs.google.com/spreadsheets/d/…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <input className="sb-text" placeholder="Which artist? (optional)" value={artistName} onChange={(e) => setArtistName(e.target.value)} />
            <input className="sb-text" placeholder="Anything we should know, like who made it? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="sb-submit" disabled={busy || !url.trim()} onClick={send}>{busy ? "Sending…" : user ? "Send//" : "Sign in to send//"}</button>
            {message && <div className="wl-message">{message}</div>}
          </div>
        )}
      </InfoSection>
    </InfoShell>
  );
}
