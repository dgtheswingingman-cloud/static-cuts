// Base colors per genre, used to compute the "Personalized" theme's accent
// color. Follow a few artists of one genre and the accent stays strongly
// that color; follow a diverse mix and simple weighted averaging naturally
// mutes it toward grey -- no extra "dilution" math needed, that's just
// what averaging different colors does.

export const GENRE_COLORS: Record<string, [number, number, number]> = {
  rap: [220, 38, 38],
  "hip hop": [220, 38, 38],
  trap: [239, 68, 68],
  rock: [234, 88, 12],
  punk: [249, 115, 22],
  "hardcore punk": [249, 115, 22],
  pop: [236, 72, 153],
  "hyperpop": [236, 72, 153],
  electronic: [34, 211, 238],
  edm: [34, 211, 238],
  house: [34, 211, 238],
  "r&b": [168, 85, 247],
  rnb: [168, 85, 247],
  soul: [168, 85, 247],
  metal: [153, 27, 27],
  jazz: [234, 179, 8],
  indie: [34, 197, 94],
  folk: [132, 204, 22],
  ambient: [99, 102, 241],
  experimental: [99, 102, 241],
};

const DEFAULT_COLOR: [number, number, number] = [140, 140, 140];

export function colorForGenre(genre: string | null | undefined): [number, number, number] {
  if (!genre) return DEFAULT_COLOR;
  const key = genre.trim().toLowerCase();
  return GENRE_COLORS[key] ?? DEFAULT_COLOR;
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}
