// Grouping an artist's songs into eras (album or project; songs with no
// album go under their year). Used by the eras page and the era strip on
// artist pages.

export type Song = {
  id: string; title: string; album: string | null; status: string; release_date: string | null; leak_date: string | null;
  track_number: number | null; cover_url: string | null; spotify_url: string | null; versions: number;
};
export type Era = { key: string; name: string; kind: "album" | "year" | "undated"; from: string | null; to: string | null; cover: string | null; songs: Song[] };
export type Filter = "all" | "released" | "unreleased";

export const UNRELEASED = ["leaked", "snippet", "teased", "rumored", "announced", "unconfirmed"];
export const STATUS_ORDER = ["released", "leaked", "snippet", "teased", "announced", "rumored", "unconfirmed", "removed"];

export function dateOf(s: Song) {
  return s.release_date ?? s.leak_date;
}

export function buildEras(songs: Song[]): Era[] {
  const map = new Map<string, Era>();
  for (const s of songs) {
    const d = dateOf(s);
    const key = s.album ? `album:${s.album.toLowerCase()}` : d ? `year:${d.slice(0, 4)}` : "undated";
    let e = map.get(key);
    if (!e) {
      e = {
        key,
        name: s.album ?? (d ? d.slice(0, 4) : "Undated"),
        kind: s.album ? "album" : d ? "year" : "undated",
        from: null, to: null, cover: null, songs: [],
      };
      map.set(key, e);
    }
    e.songs.push(s);
    if (d) {
      if (!e.from || d < e.from) e.from = d;
      if (!e.to || d > e.to) e.to = d;
    }
    if (!e.cover && s.cover_url) e.cover = s.cover_url;
  }
  for (const e of map.values()) {
    e.songs.sort((a, b) =>
      (a.track_number ?? 999) - (b.track_number ?? 999) || (dateOf(a) ?? "9").localeCompare(dateOf(b) ?? "9") || a.title.localeCompare(b.title));
  }
  // Dated eras in time order; albums with no dates after them; undated last.
  return [...map.values()].sort((a, b) => {
    if (a.kind === "undated") return 1;
    if (b.kind === "undated") return -1;
    if (a.from && b.from) return a.from.localeCompare(b.from);
    if (a.from) return -1;
    if (b.from) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function span(e: Era) {
  if (!e.from) return null;
  const a = e.from.slice(0, 4), b = e.to?.slice(0, 4);
  return b && b !== a ? `${a}–${b}` : a;
}

