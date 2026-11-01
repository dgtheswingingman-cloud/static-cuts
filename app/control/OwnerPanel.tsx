"use client";

// Owner tab: the list of sites that host leaked files. Links to them are kept
// privately (only the owner sees them, on the song page) and never shown as
// a listen link or offered for votes.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import PremiumPanel from "./PremiumPanel";

type Host = { host: string; links: number; added_at: string };

export default function OwnerPanel() {
  const [hosts, setHosts] = useState<Host[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.rpc("owner_leak_hosts");
    if (error) { setMessage(error.message); return; }
    setHosts((data as Host[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function set(host: string, on: boolean) {
    if (!on && !confirm(`Stop treating ${host} as a leak site? Links already made private stay private.`)) return;
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.rpc("owner_set_leak_host", { p_host: host, p_on: on });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    if (on) {
      setDraft("");
      setMessage(typeof data === "number" && data > 0 ? `Done: ${data} existing link${data === 1 ? "" : "s"} made private.` : "Added.");
    }
    load();
  }

  // Genius: add clear-cut songs without review.
  const [genius, setGenius] = useState<{ on: boolean; added_7d: number; waiting: number } | null>(null);
  useEffect(() => { supabase.rpc("owner_genius_auto").then(({ data }) => setGenius((data as typeof genius) ?? null)); }, []);
  async function toggleGenius() {
    if (!genius) return;
    const { error } = await supabase.rpc("owner_set_genius_auto", { p_on: !genius.on });
    if (error) { setMessage(error.message); return; }
    setGenius({ ...genius, on: !genius.on });
  }

  // New artists' catalogues: new pages are still made, but while this is off
  // their songs aren't filled in automatically (calls go on existing artists).
  const [newArtists, setNewArtists] = useState<{ on: boolean; held: number } | null>(null);
  useEffect(() => { supabase.rpc("owner_new_artists").then(({ data }) => setNewArtists((data as typeof newArtists) ?? null)); }, []);
  async function toggleNewArtists() {
    if (!newArtists) return;
    const { error } = await supabase.rpc("owner_set_new_artists", { p_on: !newArtists.on });
    if (error) { setMessage(error.message); return; }
    setNewArtists({ on: !newArtists.on, held: newArtists.on ? newArtists.held : 0 });
  }

  // Deezer reading releases: normal pace or extreme. Only one of Deezer
  // extreme and Genius extreme (max) can run at a time.
  type Deezer = { turbo: boolean; mode: "normal" | "extreme"; until: string | null; artists: number; searched: number; linked: number; releases_read: number; releases_left: number; songs_linked: number; calls_last_hour: number };
  const [deezer, setDeezer] = useState<Deezer | null>(null);
  useEffect(() => { supabase.rpc("owner_deezer").then(({ data }) => setDeezer((data as Deezer) ?? null)); }, []);
  async function setDeezerMode(mode: Deezer["mode"]) {
    if (!deezer || mode === deezer.mode) return;
    if (mode === "extreme" && !window.confirm("Extreme pauses the site for everyone but you (a \"back soon\" screen) and reads Deezer with five workers. It turns itself off when everything's read, or after 3 hours. Go?")) return;
    const { error } = await supabase.rpc("owner_set_deezer_mode", { p_mode: mode });
    if (error) { setMessage(error.message); return; }
    const { data } = await supabase.rpc("owner_deezer");
    setDeezer((data as Deezer) ?? { ...deezer, mode });
  }

  // Genius credits (producers, features, dates, artwork): pace.
  type Genius = { pace: "normal" | "max"; until: string | null; note: string | null; paused_until: string | null; unchecked: number; checked_last_hour: number; calls_last_hour: number };
  const [geniusPace, setGeniusPace] = useState<Genius | null>(null);
  useEffect(() => { supabase.rpc("owner_genius").then(({ data }) => setGeniusPace((data as Genius) ?? null)); }, []);
  async function setGeniusMode(pace: Genius["pace"]) {
    if (!geniusPace || pace === geniusPace.pace) return;
    if (pace === "max" && !window.confirm("Extreme pauses the site for everyone but you (a \"back soon\" screen) and checks Genius with three workers. It turns itself off when every song's been checked, or after 3 hours. Go?")) return;
    const { error } = await supabase.rpc("owner_set_genius_pace", { p_pace: pace });
    if (error) { setMessage(error.message); return; }
    const { data } = await supabase.rpc("owner_genius");
    setGeniusPace((data as Genius) ?? { ...geniusPace, pace });
  }

  return (
    <>
      <PremiumPanel />

      {geniusPace && (
        <>
          <div className="section-label">Genius credits</div>
          <div className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
            <div style={{ minWidth: 0 }}>
              <div className="review-row-title">How fast to fill in producers, features, dates and artwork</div>
              <div className="review-row-meta">
                <span>Normal: 15 songs every 10 minutes. Extreme: three workers at once (about 90 songs a minute) with the site paused for everyone else; it turns itself off when every song&apos;s been checked or after 3 hours. Only one of Genius and Deezer can be on extreme at a time. Genius doesn&apos;t publish a limit; if it ever says &ldquo;too many requests&rdquo;, this pauses for at least 10 minutes and drops back to normal by itself.</span>
              </div>
              <div className="review-row-meta">
                <span>
                  {geniusPace.unchecked.toLocaleString("en-GB")} songs not checked yet · {geniusPace.checked_last_hour.toLocaleString("en-GB")} checked in the last hour ·{" "}
                  {geniusPace.calls_last_hour.toLocaleString("en-GB")} calls in the last hour
                </span>
              </div>
              {geniusPace.pace === "max" && geniusPace.until && (
                <div className="review-row-meta"><span>Extreme until {new Date(geniusPace.until).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} at the latest; the site is paused for everyone else.</span></div>
              )}
              {geniusPace.note && <div className="review-row-meta"><span>{geniusPace.note}</span></div>}
              {geniusPace.paused_until && Date.parse(geniusPace.paused_until) > Date.now() && (
                <div className="review-row-meta"><span>Paused by Genius until {new Date(geniusPace.paused_until).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.</span></div>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["normal", "max"] as const).map((m) => (
                <button key={m} className={`tab ${geniusPace.pace === m ? "active" : ""} ${m === "max" ? "danger-tab" : ""}`} onClick={() => setGeniusMode(m)}>
                  {m === "max" ? "extreme" : m}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {deezer && (
        <>
          <div className="section-label">Deezer</div>
          <div className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
            <div style={{ minWidth: 0 }}>
              <div className="review-row-title">How fast to read releases</div>
              <div className="review-row-meta">
                <span>Normal: about 30 Deezer calls a minute. Extreme: five workers at once (about 450 a minute) with the site paused for everyone else; it turns itself off when everything&apos;s read or after 3 hours. Only one of Deezer and Genius can be on extreme at a time. Deezer allows around 600 a minute. Once everyone&apos;s been read it only checks for new releases monthly, so normal is fine after that.</span>
              </div>
              {deezer.mode === "extreme" && deezer.until && (
                <div className="review-row-meta"><span>Extreme until {new Date(deezer.until).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} at the latest; the site is paused for everyone else.</span></div>
              )}
              <div className="review-row-meta">
                <span>
                  {deezer.searched.toLocaleString("en-GB")} of {deezer.artists.toLocaleString("en-GB")} artists looked up ·{" "}
                  {deezer.releases_read.toLocaleString("en-GB")} releases read ({deezer.releases_left.toLocaleString("en-GB")} waiting) ·{" "}
                  {deezer.songs_linked.toLocaleString("en-GB")} songs with a Deezer link · {deezer.calls_last_hour.toLocaleString("en-GB")} calls in the last hour
                </span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["normal", "extreme"] as const).map((m) => (
                <button key={m} className={`tab ${deezer.mode === m ? "active" : ""} ${m === "extreme" ? "danger-tab" : ""}`} onClick={() => setDeezerMode(m)}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {newArtists && (
        <>
          <div className="section-label">New artists</div>
          <div className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
            <div style={{ minWidth: 0 }}>
              <div className="review-row-title">Fill in new artists&apos; songs automatically</div>
              <div className="review-row-meta">
                <span>New artist pages (guests on songs, trackers) are still made. When this is held, their songs aren&apos;t filled in from Spotify, Genius or Last.fm, so every call goes on the artists you already have. Import buttons on their pages still work. Turning it on fills them in as usual.</span>
              </div>
              {newArtists.held > 0 && (
                <div className="review-row-meta"><span>{newArtists.held.toLocaleString("en-GB")} new artist{newArtists.held === 1 ? "" : "s"} waiting</span></div>
              )}
            </div>
            <button className={`tab ${newArtists.on ? "active" : ""}`} onClick={toggleNewArtists}>{newArtists.on ? "on" : "held"}</button>
          </div>
        </>
      )}

      {genius && (
        <>
          <div className="section-label">Genius imports</div>
          <div className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
            <div style={{ minWidth: 0 }}>
              <div className="review-row-title">Add clear-cut songs without review</div>
              <div className="review-row-meta">
                <span>The artist&apos;s own songs with no version words (demo, remix, v2, snippet…) and nothing similar on the page already. Added as &ldquo;unconfirmed&rdquo;, every batch in the undo history.</span>
              </div>
              <div className="review-row-meta">
                <span>{genius.added_7d.toLocaleString("en-GB")} added this week</span>
                <span>{genius.waiting.toLocaleString("en-GB")} waiting for review</span>
              </div>
            </div>
            <button className={`tab ${genius.on ? "active" : ""}`} onClick={toggleGenius}>{genius.on ? "on" : "off"}</button>
          </div>
        </>
      )}

      <div className="section-label">Leak file links</div>
      <div className="comment-meta" style={{ marginBottom: 10 }}>
        Links to these sites never show as a listen link. They&apos;re kept on the song privately: only you see them, on
        the song page. Everyone else sees &ldquo;a file of this song is known to exist&rdquo;. New ones from trackers,
        ChatGPT or suggestions are caught automatically.
      </div>
      {message && <div className="comments-panel" style={{ marginBottom: 10 }}>{message}</div>}
      {!hosts && <div className="empty-state">loading…</div>}
      {hosts?.map((h) => (
        <div key={h.host} className="review-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">{h.host}</div>
            <div className="review-row-meta"><span>{h.links.toLocaleString("en-GB")} private link{h.links === 1 ? "" : "s"}</span></div>
          </div>
          <button className="mod-btn danger" disabled={busy} onClick={() => set(h.host, false)}>remove</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 10, maxWidth: 480 }}>
        <input className="search-input" style={{ flex: 1 }} placeholder="Add a site, e.g. example.com" value={draft}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) set(draft, true); }} />
        <button className="mod-btn approve" disabled={busy || !draft.trim()} onClick={() => set(draft, true)}>add</button>
      </div>
    </>
  );
}
