"use client";

// The wordmark at the top of every page except the homepage: one tap back home.

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function SiteHome() {
  const path = usePathname();
  if (path === "/") return null;
  return (
    <div className="site-top">
      <Link href="/" className="site-home" aria-label="Static Cuts// home">
        STATIC CUTS<span className="slash">//</span>
      </Link>
    </div>
  );
}
