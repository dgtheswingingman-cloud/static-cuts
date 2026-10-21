"use client";

// Computers only: a bar across the top with the wordmark, the main sections
// and a search box. Phones keep the wordmark-and-links layout.

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS: [string, string][] = [
  ["/new", "What's new"], ["/radar", "Radar"], ["/wanted", "Most wanted"], ["/lists", "Lists"],
  ["/collabs", "Collabs"], ["/local", "Local Cuts"], ["/help", "Help wanted"],
];

export default function DesktopNav() {
  const path = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <header className="dnav">
      <div className="dnav-inner">
        <Link href="/" className="dnav-logo">STATIC CUTS<span className="slash">//</span></Link>
        <nav className="dnav-links" aria-label="Main">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className={path === href ? "on" : undefined}>{label}</Link>
          ))}
        </nav>
        <form className="dnav-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }}>
          <input type="search" placeholder="Search songs…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search songs" />
        </form>
      </div>
    </header>
  );
}
