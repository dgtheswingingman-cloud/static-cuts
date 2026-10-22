"use client";

// The front page for someone who's never been here: what Static Cuts is,
// what you can do with it, and where to start. Shown above the artist grid
// to signed-out visitors who haven't picked artists yet; "hide" remembers.

import { useEffect, useState } from "react";
import Link from "next/link";

const HIDE_KEY = "static_cuts_landing_hidden";

export default function Landing({ artists, songs }: { artists: number; songs: number | null }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try { setHidden(localStorage.getItem(HIDE_KEY) === "1"); } catch { setHidden(false); }
  }, []);
  if (hidden) return null;

  const n = (x: number) => x.toLocaleString("en-GB");

  return (
    <section className="landing">
      <div className="landing-kicker">Cut through the noise.</div>
      <h1 className="landing-title">Every song by the artists you love.</h1>
      <p className="landing-lead">
        Released, leaked, snippeted, unreleased, demos and every version, in one place, kept up to date by fans.
        {songs ? ` ${n(songs)} songs from ${n(artists)} artists so far.` : ""}
      </p>
      <div className="landing-ctas">
        <Link href="/start" className="tab active landing-cta">Pick your artists</Link>
        {/* Email sign-up: Spotify sign-in only works for a few invited testers. */}
        <Link href="/login?mode=signup" className="tab landing-cta">Sign up</Link>
      </div>
      <div className="landing-grid">
        <div className="landing-card">
          <div className="landing-card-title">Know every song</div>
          <div className="comment-meta">Each artist&apos;s full catalogue by era: official releases, features, leaks, snippets and alternate versions, with where each status came from.</div>
        </div>
        <div className="landing-card">
          <div className="landing-card-title">Hear about it first</div>
          <div className="comment-meta">Follow artists and get told when a song leaks, drops or changes, on the site or as a phone alert.</div>
        </div>
        <div className="landing-card">
          <div className="landing-card-title">Track what you&apos;ve got</div>
          <div className="comment-meta">Tick off songs you have, import your Spotify or your old spreadsheet, and match your own music files with <Link href="/local" className="text-link">Local Cuts</Link>.</div>
        </div>
        <div className="landing-card">
          <div className="landing-card-title">Built by fans</div>
          <div className="comment-meta">Anyone can suggest songs, links and fixes. Community trackers are credited. No ads, no ranking songs by streams.</div>
        </div>
      </div>
      <div className="comment-meta landing-foot">
        <Link href="/listen" className="text-link">How to listen</Link>{" · "}
        <Link href="/faq" className="text-link">FAQ</Link>{" · "}
        <button className="text-link inline-btn" onClick={() => { setHidden(true); try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* fine */ } }}>
          hide this, just show me the artists
        </button>
      </div>
    </section>
  );
}
