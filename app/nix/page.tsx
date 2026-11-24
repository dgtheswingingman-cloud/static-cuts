"use client";

// NIX now lives in the Control room (/control?tab=nix). Old links, the
// desktop app's tray and bookmarks land here and are sent on, keeping the
// view they asked for (/nix#jobs -> &view=jobs).

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function NixMoved() {
  const router = useRouter();
  useEffect(() => {
    const view = window.location.hash.slice(1);
    router.replace(view ? `/control?tab=nix&view=${encodeURIComponent(view)}` : "/control?tab=nix");
  }, [router]);
  return <div className="wrap"><div className="empty-state">opening NIX in the Control room…</div></div>;
}
