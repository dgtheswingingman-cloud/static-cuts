// Artists a visitor picked on the first-visit page before having an
// account. Kept in this browser only; followed for real after signing up.

import { isVisitorPreview } from "./visitorPreview";

const REAL_KEY = "static_cuts_picks";
// While previewing as a new visitor, picks are kept apart (cleared on exit).
const key = () => (isVisitorPreview() ? "static_cuts_preview_picks" : REAL_KEY);

export function readPicks(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key()) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 50) : [];
  } catch {
    return [];
  }
}

export function savePicks(ids: string[]) {
  try {
    if (ids.length) localStorage.setItem(key(), JSON.stringify(ids.slice(0, 50)));
    else localStorage.removeItem(key());
  } catch {
    // Private browsing etc.: picks just aren't remembered.
  }
}
