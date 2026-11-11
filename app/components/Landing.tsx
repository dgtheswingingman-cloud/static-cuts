"use client";
import "../styles/landing.css";

// The front page for someone who's never been here: what Static-Cuts is, the
// numbers, what you can do, the launch artists, and how to start. Shown at the
// top of the home page to signed-out visitors who haven't picked artists;
// "skip" remembers.

import type React from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { isVisitorPreview } from "./visitorPreview";
import { thumb } from "@/lib/thumb";

const HIDE_KEY = "static_cuts_landing_hidden";
type Data = {
  stats: { artists: number; songs: number; versions: number; unreleased: number; albums: number } | null;
  artists: { id: string; name: string; image: string | null; songs: number }[];
};
const n = (x: number) => x.toLocaleString("en-GB");

export default function Landing() {
  const [hidden, setHidden] = useState(true);
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => {
    try { setHidden(!isVisitorPreview() && localStorage.getItem(HIDE_KEY) === "1"); } catch { setHidden(false); }
    supabase.rpc("rpc_visitor_home").then(({ data }) => setD((data as Data | null) ?? null));
  }, []);
  if (hidden) return null;

  async function spotify() {
    await supabase.auth.signInWithOAuth({
      provider: "spotify",
      options: { redirectTo: window.location.origin + "/start", scopes: "user-follow-read" },
    });
  }
  const s = d?.stats;

  return (
    <section className="lp">
      <div className="lp-hero">
        <div className="lp-kicker">Static-Cuts<span>//</span> the fan archive</div>
        <h2 className="lp-title">Every song.<br />Every version.<br /><em>Released or not.</em></h2>
        <p className="lp-lead">
          The complete catalogue for the artists you love: official releases, features, leaks, snippets,
          demos and every alternate version, with dates and where each one came from. Kept up to date by fans.
        </p>
        <div className="lp-ctas">
          <Link href="/start" className="lp-cta main">Pick your artists →</Link>
          <button className="lp-cta" onClick={spotify}>Continue with Spotify</button>
          <Link href="/login" className="lp-cta ghost">Log in</Link>
        </div>
      </div>

      {s && (
        <div className="lp-stats">
          <div><b>{n(s.songs)}</b><span>songs</span></div>
          <div><b>{n(s.versions)}</b><span>alternate versions</span></div>
          <div><b>{n(s.unreleased)}</b><span>leaks, snippets &amp; unreleased</span></div>
          <div><b>{n(s.albums)}</b><span>albums &amp; EPs</span></div>
          <div><b>{n(s.artists)}</b><span>artists</span></div>
        </div>
      )}

      {d && d.artists.length > 0 && (
        <div className="lp-block">
          <div className="lp-h">Start with<span>//</span></div>
          <div className="lp-artists">
            {d.artists.map((a) => (
              <Link key={a.id} href={`/artist/${a.id}`} className="lp-artist">
                {a.image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={thumb(a.image)} alt="" loading="lazy" />
                  : <span className="lp-artist-blank">SC//</span>}
                <b>{a.name}</b>
                <span>{n(a.songs)} songs</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="lp-block">
        <div className="lp-h">What you get<span>//</span></div>
        <div className="lp-cards">
          <div className="lp-card" style={{ "--c": "#FF3355" } as React.CSSProperties}>
            <b>Know every song</b>
            <p>Each artist&apos;s full catalogue by era and album, with every leak, snippet and version linked to its song and dated.</p>
            <Link href="/artist/playboi-carti">See an artist →</Link>
          </div>
          <div className="lp-card" style={{ "--c": "#22D3EE" } as React.CSSProperties}>
            <b>Hear about it first</b>
            <p>Follow artists and get told when a song leaks, drops or changes status, on the site, on your phone or in Discord.</p>
            <Link href="/radar">Open the Radar →</Link>
          </div>
          <div className="lp-card" style={{ "--c": "#22C55E" } as React.CSSProperties}>
            <b>Track your collection</b>
            <p>Tick off what you&apos;ve got, import your Spotify likes or an old spreadsheet, rate songs and build lists.</p>
            <Link href="/collection/import">Ways to import →</Link>
          </div>
          <div className="lp-card" style={{ "--c": "#8B7CF6" } as React.CSSProperties}>
            <b>Tidy your files</b>
            <p>Drop your music folder into Local Cuts and get it back with proper titles, tags and covers for Spotify Local Files.</p>
            <Link href="/local">Local Cuts →</Link>
          </div>
        </div>
      </div>

      <div className="lp-fans">
        <div>
          <b>Built by fans, credited to fans.</b>
          <span> Anyone can add songs, versions and fixes. Every contribution is credited on the song and on the <Link href="/contributors" className="text-link">contributors board</Link>. No audio is hosted here.</span>
        </div>
        <Link href="/start" className="lp-cta main">Get started →</Link>
      </div>

      <div className="lp-foot">
        <Link href="/faq" className="text-link">FAQ</Link>
        <Link href="/listen" className="text-link">How to listen</Link>
        <a href="https://x.com/StaticCuts" target="_blank" rel="noopener noreferrer" className="text-link">@StaticCuts on X</a>
        <button className="text-link lp-skip" onClick={() => { setHidden(true); try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* fine */ } }}>
          skip this, just show me the archive
        </button>
      </div>
    </section>
  );
}
