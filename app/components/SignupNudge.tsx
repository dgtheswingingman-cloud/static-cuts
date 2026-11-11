"use client";

// A gentle nudge for signed-out visitors: everything stays readable, but
// after a few song or artist pages a small bar offers what an account adds
// (following, alerts, collecting). Dismissing it hides it for a week.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../AuthProvider";

const VIEWS = "static_cuts_nudge_views";
const HIDDEN = "static_cuts_nudge_hidden_until";
const AFTER = 4;

export default function SignupNudge() {
  const { user, loading } = useAuth();
  const path = usePathname();
  const [show, setShow] = useState(false);
  const [artist, setArtist] = useState<string | null>(null);

  useEffect(() => {
    if (loading || user) { setShow(false); return; }
    const onPage = /^\/(artist|song)\//.test(path ?? "");
    if (!onPage) { setShow(false); return; }
    try {
      const views = Number(localStorage.getItem(VIEWS) ?? "0") + 1;
      localStorage.setItem(VIEWS, String(views));
      const hiddenUntil = Number(localStorage.getItem(HIDDEN) ?? "0");
      setShow(views >= AFTER && Date.now() > hiddenUntil);
    } catch {
      setShow(false);
    }
    // The artist's name from the page title ("Ken Carson — every song…").
    const t = setTimeout(() => {
      const name = path?.startsWith("/artist/") ? document.title.split(" — ")[0]?.trim() : null;
      setArtist(name && name.length < 60 && !name.includes("Static-Cuts") ? name : null);
    }, 300);
    return () => clearTimeout(t);
  }, [path, user, loading]);

  if (!show) return null;

  function hide() {
    try { localStorage.setItem(HIDDEN, String(Date.now() + 7 * 24 * 3600 * 1000)); } catch { /* fine */ }
    setShow(false);
  }

  return (
    <div className="signup-nudge" role="complementary">
      <div className="signup-nudge-text">
        {artist
          ? <>Into <b>{artist}</b>? Make a free account to follow them and get told the moment something new or a leak lands.</>
          : <>Make a free account to follow artists, get told when something new or a leak lands, and keep track of what you&apos;ve got.</>}
      </div>
      <div className="signup-nudge-actions">
        <Link href="/login" className="tab active">Make an account</Link>
        <button className="rating-clear" onClick={hide}>not now</button>
      </div>
    </div>
  );
}
