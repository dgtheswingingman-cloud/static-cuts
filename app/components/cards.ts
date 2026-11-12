// Share pictures (1080 x 1920 story size) in the Static-Cuts style: black
// static, the logo, Anton titles with //, mono text and status colours.
//   songCard     a song: cover, title, artist, status, album, versions
//   profileCard  a profile: picture, tagline, numbers, favourite artists
//   year cards   Your year: intro, top artists, rarest finds, biggest find,
//                numbers and an outro
//   collection   how much of one artist you have, era by era, or your whole
//                collection's top artists
// Drawn in the browser; pictures from other sites need to allow it
// (crossOrigin), and any that don't are just left out.

const W = 1080, H = 1920;
const BONE = "#ededed", SMOKE = "#8a8a8a", VOID = "#0b0b0c";
export const STATUS_COLOURS: Record<string, string> = {
  released: "#22C55E", leaked: "#FF3355", snippet: "#8B7CF6", teased: "#22D3EE", announced: "#22D3EE",
  rumored: "#F5B841", unconfirmed: "#8a8a8a", removed: "#8a8a8a",
};

function fontVar(name: string, fallback: string) {
  try {
    const v = (getComputedStyle(document.body).getPropertyValue(name) || getComputedStyle(document.documentElement).getPropertyValue(name)).trim();
    return v ? `${v}, ${fallback}` : fallback;
  } catch { return fallback; }
}

type Ctx = CanvasRenderingContext2D;
type Fonts = { display: string; mono: string };

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  if (!imageCache.has(url)) {
    imageCache.set(url, new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
      setTimeout(() => resolve(null), 7000);
    }));
  }
  return imageCache.get(url)!;
}

async function setup(tint?: string | null): Promise<{ c: HTMLCanvasElement; ctx: Ctx; f: Fonts; logo: HTMLImageElement | null }> {
  const f = { display: fontVar("--font-anton", "Anton, Impact, 'Arial Narrow', sans-serif"), mono: fontVar("--font-mono", "ui-monospace, Menlo, monospace") };
  try { await Promise.all([document.fonts.load(`80px ${f.display}`), document.fonts.load(`40px ${f.mono}`), document.fonts.load(`700 40px ${f.mono}`)]); } catch { /* use what's there */ }
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = VOID;
  ctx.fillRect(0, 0, W, H);
  // A coloured glow creeping in from the corners (the song or profile colour).
  if (tint) {
    for (const [x, y] of [[0, H], [W, 0]] as [number, number][]) {
      const g = ctx.createRadialGradient(x, y, 20, x, y, 900);
      g.addColorStop(0, hexA(tint, 0.38));
      g.addColorStop(1, hexA(tint, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }
  // Static: grain and scan lines.
  const grain = ctx.createImageData(W, H);
  for (let i = 0; i < grain.data.length; i += 4) {
    const v = Math.random() * 255;
    grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = v;
    grain.data[i + 3] = 16;
  }
  const gc = document.createElement("canvas");
  gc.width = W; gc.height = H;
  gc.getContext("2d")?.putImageData(grain, 0, 0);
  ctx.drawImage(gc, 0, 0);
  ctx.fillStyle = "rgba(255,255,255,0.022)";
  for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 2);
  const logo = await loadImage("/logo.webp");
  return { c, ctx, f, logo };
}

function hexA(hex: string, a: number) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return `rgba(139,124,246,${a})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

function header(ctx: Ctx, logo: HTMLImageElement | null, f: Fonts, accent: string) {
  if (logo) {
    const w = 460, h = (logo.height / logo.width) * w;
    ctx.drawImage(logo, 70, 80, w, h);
  } else {
    ctx.fillStyle = BONE; ctx.font = `86px ${f.display}`; ctx.fillText("STATIC-CUTS//", 70, 160);
  }
  void accent;
}

function footer(ctx: Ctx, logo: HTMLImageElement | null, f: Fonts, url: string) {
  ctx.textAlign = "left";
  if (logo) {
    const w = 210, h = (logo.height / logo.width) * w;
    ctx.drawImage(logo, 70, H - 150, w, h);
  }
  ctx.fillStyle = SMOKE;
  ctx.font = `30px ${f.mono}`;
  let u = url.replace(/^https?:\/\//, "");
  if (ctx.measureText(u).width > W - 140) { while (u.length > 1 && ctx.measureText(u + "…").width > W - 140) u = u.slice(0, -1); u += "…"; }
  ctx.fillText(u, 70, H - 72);
}

// A big title with // in the accent colour.
function heading(ctx: Ctx, f: Fonts, text: string, x: number, y: number, size: number, accent: string) {
  ctx.textAlign = "left";
  const t = text.toUpperCase();
  ctx.font = `italic ${size}px ${f.display}`;
  while (ctx.measureText(t + "//").width + 6 > W - 140 && size > 40) { size -= 4; ctx.font = `italic ${size}px ${f.display}`; }
  ctx.fillStyle = BONE;
  ctx.fillText(t, x, y);
  const w = ctx.measureText(t).width;
  ctx.fillStyle = accent;
  ctx.fillText("//", x + w + 6, y);
}

function fitText(ctx: Ctx, text: string, font: (s: number) => string, max: number, start: number, min: number) {
  let s = start;
  ctx.font = font(s);
  while (ctx.measureText(text).width > max && s > min) { s -= 4; ctx.font = font(s); }
  return s;
}

function wrap(ctx: Ctx, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = test;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(" ") !== lines.join(" ")) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(last + "…").width > maxWidth && last.length > 1) last = last.slice(0, -1);
    lines[maxLines - 1] = last + "…";
  }
  return lines;
}

function cover(ctx: Ctx, img: HTMLImageElement | null, x: number, y: number, w: number, h: number, round = false, border = "rgba(237,237,237,0.85)", lw = 3) {
  ctx.save();
  if (round) { ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2); ctx.clip(); }
  if (img) {
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    try { ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); } catch { /* blocked */ }
  } else {
    ctx.fillStyle = "#1a1a1c"; ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
  ctx.strokeStyle = border; ctx.lineWidth = lw;
  if (round) { ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2); ctx.stroke(); }
  else ctx.strokeRect(x, y, w, h);
}

// A status tag like LEAKED// in its colour.
function tag(ctx: Ctx, f: Fonts, status: string, x: number, y: number, size = 40, filled = true) {
  const colour = STATUS_COLOURS[status] ?? SMOKE;
  const text = `${status.toUpperCase()}//`;
  ctx.font = `700 ${size}px ${f.mono}`;
  const w = ctx.measureText(text).width + size * 0.8, h = size * 1.5;
  ctx.fillStyle = filled ? colour : "transparent";
  if (filled) ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = colour; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = filled ? "#070707" : colour;
  ctx.textAlign = "left";
  ctx.fillText(text, x + size * 0.4, y + h * 0.72);
  return w;
}

function line(ctx: Ctx, y: number, x = 70, w = W - 140) {
  ctx.fillStyle = "rgba(237,237,237,0.25)";
  ctx.fillRect(x, y, w, 2);
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob | null>((resolve) => c.toBlob((b) => resolve(b), "image/png"));

// ---------------------------------------------------------------- song

export type SongCardData = {
  title: string; artist: string; status: string; album?: string | null; year?: string | number | null;
  versions?: number; cover?: string | null; tint?: string | null; url: string;
};

export async function songCard(d: SongCardData): Promise<Blob | null> {
  const accent = d.tint ?? STATUS_COLOURS[d.status] ?? "#8B7CF6";
  const { c, ctx, f, logo } = await setup(accent);
  header(ctx, logo, f, accent);
  const img = await loadImage(d.cover);
  const cs = 860, cx = (W - cs) / 2;
  cover(ctx, img, cx, 230, cs, cs, false, "rgba(237,237,237,0.85)", 4);
  let y = 230 + cs + 130;
  ctx.textAlign = "left";
  const title = d.title.toUpperCase();
  let size = 110;
  ctx.font = `${size}px ${f.display}`;
  let lines = wrap(ctx, title, W - 140, 2);
  while ((lines.length > 1 || ctx.measureText(lines[0] ?? "").width > W - 140) && size > 72) {
    size -= 6; ctx.font = `${size}px ${f.display}`; lines = wrap(ctx, title, W - 140, 2);
    if (lines.length === 1 && ctx.measureText(lines[0]).width <= W - 140) break;
  }
  ctx.fillStyle = BONE;
  lines.forEach((l, i) => { ctx.fillText(l, 70, y); if (i < lines.length - 1) y += size * 0.98; });
  y += 70;
  ctx.font = `46px ${f.mono}`;
  ctx.fillText(wrap(ctx, d.artist, W - 140, 1)[0] ?? "", 70, y);
  y += 36;
  tag(ctx, f, d.status, 70, y, 36);
  y += 54 + 80;
  const meta = [d.album, d.year ? String(d.year) : null, d.versions && d.versions > 1 ? `${d.versions} versions` : null].filter(Boolean) as string[];
  if (meta.length && y < H - 200) {
    ctx.font = `36px ${f.mono}`; ctx.fillStyle = SMOKE;
    ctx.fillText(wrap(ctx, meta.join("  ·  "), W - 140, 1)[0] ?? "", 70, y);
  }
  footer(ctx, logo, f, d.url);
  return toBlob(c);
}

// ---------------------------------------------------------------- profile

export type ProfileCardData = {
  name: string; tagline?: string | null; avatar?: string | null; accent?: string | null;
  stats: [string, string][]; // [big number, label]
  favourites: { name: string; image: string | null }[];
  url: string;
};

export async function profileCard(d: ProfileCardData): Promise<Blob | null> {
  const accent = d.accent ?? "#8B7CF6";
  const { c, ctx, f, logo } = await setup(accent);
  header(ctx, logo, f, accent);
  const av = await loadImage(d.avatar);
  cover(ctx, av, 70, 260, 300, 300, true, accent, 8);
  ctx.textAlign = "left";
  ctx.fillStyle = BONE;
  const nameSize = fitText(ctx, d.name, (s) => `${s}px ${f.display}`, W - 470, 96, 50);
  ctx.font = `${nameSize}px ${f.display}`;
  ctx.fillText(d.name, 410, 400);
  if (d.tagline) {
    ctx.font = `36px ${f.mono}`;
    let ty = 470;
    for (const l of wrap(ctx, d.tagline, W - 480, 3)) { ctx.fillText(l, 410, ty); ty += 48; }
  }
  // Numbers.
  let y = 690;
  const cols = Math.min(3, d.stats.length) || 1;
  const cw = (W - 140) / cols;
  d.stats.slice(0, 3).forEach(([big, label], i) => {
    const x = 70 + i * cw;
    if (i > 0) { ctx.fillStyle = "rgba(237,237,237,0.3)"; ctx.fillRect(x - 10, y - 70, 2, 130); }
    ctx.fillStyle = BONE;
    ctx.font = `86px ${f.display}`;
    ctx.fillText(big, x + 10, y);
    ctx.font = `32px ${f.mono}`;
    ctx.fillText(label, x + 10, y + 50);
  });
  y += 130; line(ctx, y); y += 120;
  if (d.favourites.length) {
    heading(ctx, f, "Favourite artists", 70, y, 64, accent);
    y += 70;
    const imgs = await Promise.all(d.favourites.slice(0, 6).map((a) => loadImage(a.image)));
    const size = 250, gap = (W - 140 - size * 3) / 2;
    d.favourites.slice(0, 6).forEach((a, i) => {
      const x = 70 + (i % 3) * (size + gap), yy = y + Math.floor(i / 3) * (size + 110);
      cover(ctx, imgs[i], x, yy, size, size, true, accent, 6);
      ctx.fillStyle = BONE; ctx.textAlign = "center";
      ctx.font = `34px ${f.mono}`;
      ctx.fillText(wrap(ctx, a.name, size + 20, 1)[0] ?? "", x + size / 2, yy + size + 56);
      ctx.textAlign = "left";
    });
  }
  footer(ctx, logo, f, d.url);
  return toBlob(c);
}

// ---------------------------------------------------------------- your year

export type YearData = {
  year: number; name: string; avatar?: string | null; accent?: string | null; url: string;
  topArtists: { name: string; image: string | null; n: number }[];
  finds: { title: string; artist: string; status: string | null; cover: string | null; year: string | null; holders: number }[];
  numbers: [string, string, string][]; // [label, value, note]
};

export async function yearIntro(d: YearData): Promise<Blob | null> {
  const accent = d.accent ?? "#8B7CF6";
  const { c, ctx, f, logo } = await setup(accent);
  header(ctx, logo, f, accent);
  heading(ctx, f, `Your ${d.year}`, 70, 380, 150, accent);
  const av = await loadImage(d.avatar);
  cover(ctx, av, 70, 460, 300, 300, true, accent, 8);
  ctx.fillStyle = BONE; ctx.textAlign = "left";
  ctx.font = `${fitText(ctx, d.name, (sz) => `${sz}px ${f.display}`, W - 140, 64, 40)}px ${f.display}`;
  ctx.fillText(d.name, 70, 860);
  ctx.font = `38px ${f.mono}`;
  ctx.fillText("This year, you kept the archive alive.", 70, 920);
  line(ctx, 990);
  if (d.topArtists.length) {
    heading(ctx, f, "Top 5 artists", 70, 1090, 64, accent);
    const imgs = await Promise.all(d.topArtists.slice(0, 5).map((a) => loadImage(a.image)));
    d.topArtists.slice(0, 5).forEach((a, i) => {
      const y = 1140 + i * 112;
      ctx.fillStyle = BONE; ctx.font = `64px ${f.display}`; ctx.textAlign = "left";
      ctx.fillText(String(i + 1), 80, y + 72);
      cover(ctx, imgs[i], 170, y, 96, 96, true, BONE, 3);
      ctx.font = `42px ${f.mono}`;
      ctx.fillText(wrap(ctx, a.name, 470, 1)[0] ?? "", 300, y + 62);
      ctx.fillStyle = SMOKE; ctx.font = `32px ${f.mono}`; ctx.textAlign = "right";
      ctx.fillText(`${a.n} songs`, W - 70, y + 62);
      ctx.textAlign = "left";
    });
  }
  footer(ctx, logo, f, d.url);
  return toBlob(c);
}

export async function yearFinds(d: YearData): Promise<Blob | null> {
  const accent = d.accent ?? "#8B7CF6";
  const { c, ctx, f, logo } = await setup(accent);
  header(ctx, logo, f, accent);
  heading(ctx, f, "Rarest finds", 70, 380, 130, accent);
  const list = d.finds.slice(0, 5);
  const imgs = await Promise.all(list.map((x) => loadImage(x.cover)));
  list.forEach((s, i) => {
    const y = 440 + i * 250;
    ctx.fillStyle = BONE; ctx.font = `70px ${f.display}`; ctx.textAlign = "left";
    ctx.fillText(String(i + 1), 76, y + 84);
    cover(ctx, imgs[i], 150, y, 210, 210, false, BONE, 3);
    const tx = 400, tw = W - 70 - tx;
    ctx.font = `700 42px ${f.mono}`;
    ctx.fillText(wrap(ctx, s.title, tw, 1)[0] ?? "", tx, y + 46);
    ctx.font = `34px ${f.mono}`;
    ctx.fillText(wrap(ctx, s.artist, tw, 1)[0] ?? "", tx, y + 92);
    if (s.status) tag(ctx, f, s.status, tx, y + 112, 26, false);
    ctx.fillStyle = SMOKE; ctx.font = `28px ${f.mono}`;
    ctx.fillText(wrap(ctx, [s.year, s.holders === 1 ? "only you have it" : `${s.holders} collectors`].filter(Boolean).join(" · "), tw, 1)[0] ?? "", tx, y + 196);
  });
  footer(ctx, logo, f, d.url);
  return toBlob(c);
}

export async function yearBiggest(d: YearData): Promise<Blob | null> {
  const s = d.finds[0];
  const accent = (s?.status && STATUS_COLOURS[s.status]) || d.accent || "#8B7CF6";
  const { c, ctx, f, logo } = await setup(accent);
  header(ctx, logo, f, accent);
  heading(ctx, f, "Your biggest find", 70, 380, 120, accent);
  if (s) {
    const img = await loadImage(s.cover);
    const cs = 820;
    cover(ctx, img, (W - cs) / 2, 440, cs, cs, false, BONE, 4);
    let y = 440 + cs + 100;
    ctx.fillStyle = BONE; ctx.textAlign = "left";
    ctx.font = `700 56px ${f.mono}`;
    ctx.fillText(wrap(ctx, s.title, W - 140, 1)[0] ?? "", 70, y);
    y += 62;
    ctx.font = `42px ${f.mono}`;
    ctx.fillText(wrap(ctx, s.artist, W - 140, 1)[0] ?? "", 70, y);
    y += 36;
    const label = s.holders === 1 ? "ONLY YOU HAVE IT" : `ONLY ${s.holders} COLLECTORS`;
    ctx.font = `700 38px ${f.mono}`;
    const w = ctx.measureText(label).width + 30;
    ctx.fillStyle = accent; ctx.fillRect(70, y, w, 58);
    ctx.fillStyle = "#070707"; ctx.fillText(label, 85, y + 42);
    y += 118;
    ctx.fillStyle = SMOKE; ctx.font = `34px ${f.mono}`;
    for (const l of wrap(ctx, s.holders === 1 ? "Nobody else on Static-Cuts has collected this one." : "One of the rarest songs in anyone's collection.", W - 140, 2)) { if (y > H - 190) break; ctx.fillText(l, 70, y); y += 46; }
  }
  footer(ctx, logo, f, d.url);
  return toBlob(c);
}

export async function yearNumbers(d: YearData): Promise<Blob | null> {
  const accent = d.accent ?? "#8B7CF6";
  const { c, ctx, f, logo } = await setup(accent);
  header(ctx, logo, f, accent);
  heading(ctx, f, "Your numbers", 70, 380, 130, accent);
  d.numbers.slice(0, 4).forEach(([label, value, note], i) => {
    const y = 450 + i * 300, bh = 260;
    ctx.strokeStyle = "rgba(237,237,237,0.6)"; ctx.lineWidth = 3;
    ctx.strokeRect(70, y, W - 140, bh);
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(170, y + bh / 2, 50, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#070707"; ctx.font = `60px ${f.display}`; ctx.textAlign = "center";
    ctx.fillText(String(i + 1), 170, y + bh / 2 + 22);
    ctx.textAlign = "left"; ctx.fillStyle = BONE;
    const tw = W - 70 - 30 - 270;
    ctx.font = `32px ${f.mono}`; ctx.fillText(wrap(ctx, label.toUpperCase(), tw, 1)[0] ?? "", 270, y + 70);
    ctx.font = `${fitText(ctx, value, (sz) => `${sz}px ${f.display}`, tw, 104, 50)}px ${f.display}`; ctx.fillText(value, 270, y + 175);
    ctx.fillStyle = SMOKE; ctx.font = `28px ${f.mono}`; ctx.fillText(wrap(ctx, note, tw, 1)[0] ?? "", 270, y + 225);
  });
  footer(ctx, logo, f, d.url);
  return toBlob(c);
}

export async function yearOutro(d: YearData): Promise<Blob | null> {
  const accent = d.accent ?? "#8B7CF6";
  const { c, ctx, f, logo } = await setup(accent);
  header(ctx, logo, f, accent);
  // A loose collage of the year's artists.
  const imgs = (await Promise.all(d.topArtists.slice(0, 8).map((a) => loadImage(a.image)))).filter(Boolean) as HTMLImageElement[];
  const spots: [number, number, number, number][] = [[90, 300, 300, -4], [420, 260, 260, 3], [720, 330, 280, -2], [60, 650, 260, 5], [780, 680, 240, -6], [110, 1000, 240, -3], [770, 980, 250, 4], [430, 1080, 220, 2]];
  imgs.forEach((img, i) => {
    const [x, y, s, rot] = spots[i];
    ctx.save(); ctx.translate(x + s / 2, y + s / 2); ctx.rotate((rot * Math.PI) / 180);
    ctx.globalAlpha = 0.75; ctx.filter = "grayscale(1) contrast(1.15)";
    cover(ctx, img, -s / 2, -s / 2, s, s, false, "rgba(237,237,237,0.4)", 2);
    ctx.restore();
  });
  ctx.filter = "none"; ctx.globalAlpha = 1;
  ctx.save(); ctx.translate(W / 2, 860); ctx.rotate((-12 * Math.PI) / 180);
  ctx.fillStyle = BONE; ctx.textAlign = "center"; ctx.font = `italic 100px ${f.display}`;
  ctx.fillText("ANOTHER YEAR", 0, -60); ctx.fillText("IN THE ARCHIVE", 0, 50);
  ctx.fillStyle = accent; ctx.fillText("//", 360, 150);
  ctx.restore();
  ctx.textAlign = "center"; ctx.fillStyle = BONE; ctx.font = `38px ${f.mono}`;
  ctx.fillText("Thanks for being part", W / 2, 1420);
  ctx.fillText(`of Static-Cuts in ${d.year}.`, W / 2, 1470);
  if (logo) { const w = 640, h = (logo.height / logo.width) * w; ctx.drawImage(logo, (W - w) / 2, 1530, w, h); }
  ctx.font = `38px ${f.mono}`;
  ctx.fillText("Make yours at static-cuts.com", W / 2, 1760);
  return toBlob(c);
}

// ---------------------------------------------------------------- collection

const GOLD = "#F5B841";

// A thick progress bar with the numbers on it.
function progress(ctx: Ctx, f: Fonts, x: number, y: number, w: number, h: number, have: number, total: number, accent: string) {
  const p = total ? Math.min(1, have / total) : 0;
  ctx.fillStyle = "rgba(237,237,237,0.12)"; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = p >= 1 ? GOLD : accent; ctx.fillRect(x, y, Math.max(p > 0 ? 4 : 0, w * p), h);
  ctx.strokeStyle = "rgba(237,237,237,0.5)"; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
  void f;
}

export type CollectionCardData = {
  artist: string; photo?: string | null; have: number; total: number;
  eras: { era: string; have: number; total: number }[];
  who?: string | null; accent?: string | null; url: string;
};

export async function collectionCard(d: CollectionCardData): Promise<Blob | null> {
  const accent = d.accent ?? "#8B7CF6";
  const { c, ctx, f, logo } = await setup(accent);
  header(ctx, logo, f, accent);
  heading(ctx, f, `My ${d.artist}`, 70, 360, 130, accent);
  if (d.who) { ctx.fillStyle = SMOKE; ctx.font = `34px ${f.mono}`; ctx.textAlign = "left"; ctx.fillText(wrap(ctx, `${d.who}'s collection`, W - 140, 1)[0] ?? "", 70, 420); }
  // Photo and the big number.
  const img = await loadImage(d.photo);
  cover(ctx, img, 70, 480, 300, 300, true, accent, 8);
  ctx.textAlign = "left"; ctx.fillStyle = BONE;
  const big = d.have.toLocaleString("en-GB");
  ctx.font = `${fitText(ctx, big, (sz) => `${sz}px ${f.display}`, W - 480, 230, 110)}px ${f.display}`;
  ctx.fillText(big, 410, 680);
  ctx.font = `700 40px ${f.mono}`; ctx.fillStyle = SMOKE;
  ctx.fillText(`/ ${d.total.toLocaleString("en-GB")} SONGS`, 414, 750);
  const pc = d.total ? Math.floor((d.have / d.total) * 100) : 0;
  progress(ctx, f, 70, 840, W - 140, 56, d.have, d.total, accent);
  ctx.fillStyle = BONE; ctx.font = `700 40px ${f.mono}`; ctx.textAlign = "right";
  ctx.fillText(d.have >= d.total ? "COMPLETE//" : `${pc}%`, W - 70, 950);
  ctx.textAlign = "left"; ctx.fillStyle = SMOKE; ctx.font = `32px ${f.mono}`;
  const doneN = d.eras.filter((e) => e.have >= e.total).length;
  ctx.fillText(`${doneN} of ${d.eras.length} eras complete`, 70, 950);
  line(ctx, 1000);
  // The biggest eras, each with its own bar.
  // Real eras first (biggest first), the "loose songs" group only if there's room.
  const loose = (e: { era: string }) => /^singles & loose songs$/i.test(e.era);
  const eras = [...d.eras.filter((e) => !loose(e)).sort((a, b) => b.total - a.total), ...d.eras.filter(loose)].slice(0, 7);
  heading(ctx, f, "Eras", 70, 1090, 64, accent);
  eras.forEach((e, i) => {
    const y = 1140 + i * 88;
    ctx.fillStyle = BONE; ctx.font = `34px ${f.mono}`; ctx.textAlign = "left";
    ctx.fillText(wrap(ctx, e.era, 470, 1)[0] ?? "", 70, y + 36);
    progress(ctx, f, 570, y + 10, 270, 30, e.have, e.total, accent);
    ctx.textAlign = "right"; ctx.font = `700 30px ${f.mono}`;
    ctx.fillStyle = e.have >= e.total ? GOLD : BONE;
    ctx.fillText(e.have >= e.total ? "DONE" : `${e.have}/${e.total}`, W - 70, y + 36);
  });
  ctx.textAlign = "left";
  footer(ctx, logo, f, d.url);
  return toBlob(c);
}

export type CollectionOverviewData = {
  who: string; avatar?: string | null; accent?: string | null; url: string;
  artists: { artist: string; photo: string | null; have: number; total: number }[];
};

export async function collectionOverviewCard(d: CollectionOverviewData): Promise<Blob | null> {
  const accent = d.accent ?? "#8B7CF6";
  const { c, ctx, f, logo } = await setup(accent);
  header(ctx, logo, f, accent);
  heading(ctx, f, "My collection", 70, 360, 130, accent);
  const av = await loadImage(d.avatar);
  cover(ctx, av, 70, 420, 200, 200, true, accent, 6);
  ctx.textAlign = "left"; ctx.fillStyle = BONE;
  ctx.font = `${fitText(ctx, d.who, (sz) => `${sz}px ${f.display}`, W - 380, 72, 40)}px ${f.display}`;
  ctx.fillText(d.who, 300, 510);
  const songs = d.artists.reduce((a, x) => a + x.have, 0);
  ctx.font = `34px ${f.mono}`; ctx.fillStyle = SMOKE;
  ctx.fillText(`${songs.toLocaleString("en-GB")} songs · ${d.artists.length} artists`, 300, 570);
  line(ctx, 680);
  const top = [...d.artists].sort((a, b) => b.have - a.have).slice(0, 7);
  const imgs = await Promise.all(top.map((a) => loadImage(a.photo)));
  top.forEach((a, i) => {
    const y = 730 + i * 145;
    cover(ctx, imgs[i], 70, y, 110, 110, true, BONE, 3);
    ctx.textAlign = "left"; ctx.fillStyle = BONE; ctx.font = `700 38px ${f.mono}`;
    ctx.fillText(wrap(ctx, a.artist, 560, 1)[0] ?? "", 210, y + 44);
    progress(ctx, f, 210, y + 66, 560, 28, a.have, a.total, accent);
    ctx.textAlign = "right"; ctx.font = `700 34px ${f.mono}`;
    ctx.fillStyle = a.have >= a.total ? GOLD : BONE;
    ctx.fillText(`${a.have}/${a.total}`, W - 70, y + 44);
    ctx.fillStyle = SMOKE; ctx.font = `30px ${f.mono}`;
    ctx.fillText(a.have >= a.total ? "complete" : `${a.total ? Math.floor((a.have / a.total) * 100) : 0}%`, W - 70, y + 92);
  });
  ctx.textAlign = "left";
  footer(ctx, logo, f, d.url);
  return toBlob(c);
}

// Share a picture (phones) or save it (computers).
export async function shareBlob(blob: Blob | null, fileName: string, title: string) {
  if (!blob) return false;
  const file = new File([blob], `${fileName}.png`, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title }); return true; } catch { return false; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${fileName}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}
