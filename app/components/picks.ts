// Artists a visitor picked on the first-visit page before having an
// account. Kept in this browser only; followed for real after signing up.

const KEY = "static_cuts_picks";

export function readPicks(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 50) : [];
  } catch {
    return [];
  }
}

export function savePicks(ids: string[]) {
  try {
    if (ids.length) localStorage.setItem(KEY, JSON.stringify(ids.slice(0, 50)));
    else localStorage.removeItem(KEY);
  } catch {
    // Private browsing etc.: picks just aren't remembered.
  }
}
