"use client";

// Share this page: the phone's share sheet where there is one, otherwise
// copy the link.

import { useState } from "react";

export default function ShareButton({ title, path, label = "share" }: { title: string; path?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function share() {
    const url = window.location.origin + (path ?? window.location.pathname);
    if (navigator.share) {
      navigator.share({ title, url }).catch(() => {});
      return;
    }
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); });
  }
  return <button className="tab" onClick={share}>{copied ? "link copied" : label}</button>;
}
