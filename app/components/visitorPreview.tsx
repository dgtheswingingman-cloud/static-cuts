"use client";

// "View as new visitor": the admin sees the site exactly as someone who's
// never been here does (signed out, no picks, the welcome page showing),
// without signing out. Remembered in this browser until "exit".

import { useEffect, useState } from "react";

const KEY = "static_cuts_visitor_preview";

export function isVisitorPreview(): boolean {
  try { return typeof window !== "undefined" && localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function startVisitorPreview() {
  try { localStorage.setItem(KEY, "1"); } catch { /* fine */ }
  window.location.assign("/");
}

export function exitVisitorPreview() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem("static_cuts_preview_picks");
  } catch { /* fine */ }
  window.location.reload();
}

// The bar shown while previewing (the admin bar is hidden then, as for any visitor).
export function VisitorPreviewBar() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(isVisitorPreview()), []);
  if (!on) return null;
  return (
    <div className="mode-bar is-user" role="status">
      <span className="mode-bar-label">Preview</span>
      <span className="mode-bar-hint">what a first-time visitor sees</span>
      <button className="mode-bar-switch" onClick={exitVisitorPreview}>exit preview</button>
    </div>
  );
}
