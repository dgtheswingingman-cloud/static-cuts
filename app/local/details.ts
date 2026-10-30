// Local Cuts, the other way round: read the fuller details out of someone's
// own music files (album, full release date, track number, featured artists,
// producers, cover art), on their device, so they can fill gaps in the
// archive. Only text and a shrunk cover ever leave the device, and only when
// they choose to send them. The audio is never read beyond its tags.
//   MP3:  ID3v2 (TALB, TRCK, TDRC/TDRL or TYER+TDAT, TIPL/IPLS, TXXX
//         PRODUCER, COMM, APIC)
//   FLAC: Vorbis comments and the PICTURE block
//   M4A:  the ilst atoms (©alb, ©day, trkn, ©cmt, covr)
//   OGG/Opus: Vorbis comments (no cover)

export type FileDetails = {
  album: string | null;
  date: string | null;      // full YYYY-MM-DD only (a year alone isn't a release date)
  track: string | null;     // "3"
  featuring: string | null; // from the artist field and the title
  producers: string | null; // from producer credits, or "(prod. X)" in the title or comment
  hasCover: boolean;
};
export type Cover = { mime: string; data: Uint8Array };

const MAX_TAG = 25 * 1024 * 1024; // never read more than this
const utf8 = new TextDecoder("utf-8");

async function bytes(file: Blob, start: number, end: number) {
  return new Uint8Array(await file.slice(Math.max(0, start), Math.min(end, file.size)).arrayBuffer());
}
function latin1(b: Uint8Array) { let s = ""; for (const c of b) s += String.fromCharCode(c); return s; }
function clean(s: string | null | undefined) {
  const v = (s ?? "").replace(/\0/g, " ").replace(/\s+/g, " ").trim();
  return v === "" ? null : v;
}
function be32(b: Uint8Array, p: number) { return ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]; }
function le32(b: Uint8Array, p: number) { return b[p] + (b[p + 1] << 8) + (b[p + 2] << 16) + ((b[p + 3] << 24) >>> 0); }
function syncsafe(b: Uint8Array, p: number) { return (b[p] << 21) | (b[p + 1] << 14) | (b[p + 2] << 7) | b[p + 3]; }

type Raw = {
  album?: string | null; date?: string | null; year?: string | null; ddmm?: string | null; track?: string | null;
  artist?: string | null; title?: string | null; producer?: string | null; comment?: string | null; cover?: Cover | null;
};

// ---------------------------------------------------------------- ID3v2

function decodeText(enc: number, body: Uint8Array): string {
  try {
    if (enc === 0) return latin1(body);
    if (enc === 3) return utf8.decode(body);
    if (enc === 1) {
      const le = body[0] === 0xff && body[1] === 0xfe, bom = (body[0] === 0xff && body[1] === 0xfe) || (body[0] === 0xfe && body[1] === 0xff);
      return new TextDecoder(le || !bom ? "utf-16le" : "utf-16be").decode(bom ? body.subarray(2) : body);
    }
    if (enc === 2) return new TextDecoder("utf-16be").decode(body);
  } catch { /* odd encoding */ }
  return "";
}
// Where a null-terminated string ends, for the given text encoding.
function termEnd(enc: number, b: Uint8Array, p: number) {
  if (enc === 1 || enc === 2) {
    for (let i = p; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return b.length;
  }
  const i = b.indexOf(0, p);
  return i < 0 ? b.length : i;
}

function parseId3(b: Uint8Array, wantCover: boolean): Raw {
  const out: Raw = {};
  const ver = b[3];
  const end = Math.min(10 + syncsafe(b, 6), b.length);
  let p = 10;
  if (b[5] & 0x40) p += ver === 4 ? syncsafe(b, 10) : be32(b, 10) + 4;
  while (p + 10 <= end) {
    const id = latin1(b.subarray(p, p + 4));
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = ver === 4 ? syncsafe(b, p + 4) : be32(b, p + 4);
    if (size <= 0 || p + 10 + size > end) break;
    const d = b.subarray(p + 10, p + 10 + size);
    const text = () => clean(decodeText(d[0], d.subarray(1)));
    if (id === "TALB") out.album = text();
    else if (id === "TRCK") out.track = text();
    else if (id === "TDRC" || id === "TDRL") out.date = out.date ?? text();
    else if (id === "TYER") out.year = text();
    else if (id === "TDAT") out.ddmm = text();
    else if (id === "TPE1") out.artist = text();
    else if (id === "TIT2") out.title = text();
    else if (id === "TIPL" || id === "IPLS") {
      // role, name, role, name...
      const parts = decodeText(d[0], d.subarray(1)).split("\0").map((s) => s.trim());
      for (let i = 0; i + 1 < parts.length; i += 2) {
        if (/produc/i.test(parts[i]) && parts[i + 1]) out.producer = out.producer ? `${out.producer}, ${parts[i + 1]}` : parts[i + 1];
      }
    } else if (id === "TXXX") {
      const e = termEnd(d[0], d, 1);
      const desc = clean(decodeText(d[0], d.subarray(1, e)));
      const val = clean(decodeText(d[0], d.subarray(e + (d[0] === 1 || d[0] === 2 ? 2 : 1))));
      if (desc && /^produc/i.test(desc) && val) out.producer = out.producer ?? val;
    } else if (id === "COMM" && !out.comment) {
      // encoding, language (3), description, text
      const e = termEnd(d[0], d, 4);
      out.comment = clean(decodeText(d[0], d.subarray(e + (d[0] === 1 || d[0] === 2 ? 2 : 1))));
    } else if (id === "APIC" && (!out.cover || d[d.indexOf(0, 1) + 1] === 3)) {
      // encoding, mime\0, picture type, description\0, data. Front cover (3) wins.
      const m = d.indexOf(0, 1);
      if (m > 0) {
        const mime = latin1(d.subarray(1, m)).toLowerCase();
        const e = termEnd(d[0], d, m + 2);
        const data = d.subarray(e + (d[0] === 1 || d[0] === 2 ? 2 : 1));
        if (data.length > 200) out.cover = wantCover ? { mime: mime.includes("png") ? "image/png" : "image/jpeg", data: data.slice() } : { mime, data: new Uint8Array(0) };
      }
    }
    p += 10 + size;
  }
  return out;
}

// ------------------------------------------------- FLAC / Vorbis / OGG

function parseVorbis(b: Uint8Array, p: number, out: Raw) {
  if (p + 4 > b.length) return;
  p += 4 + le32(b, p);
  if (p + 4 > b.length) return;
  const count = le32(b, p); p += 4;
  for (let i = 0; i < count && p + 4 <= b.length; i++) {
    const len = le32(b, p); p += 4;
    const s = utf8.decode(b.subarray(p, p + len)); p += len;
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    const k = s.slice(0, eq).toUpperCase(), v = clean(s.slice(eq + 1));
    if (!v) continue;
    if (k === "ALBUM") out.album = out.album ?? v;
    else if (k === "DATE" || k === "RELEASEDATE" || k === "ORIGINALDATE") out.date = out.date ?? v;
    else if (k === "TRACKNUMBER") out.track = out.track ?? v;
    else if (k === "ARTIST") out.artist = out.artist ?? v;
    else if (k === "TITLE") out.title = out.title ?? v;
    else if (k === "PRODUCER") out.producer = out.producer ? `${out.producer}, ${v}` : v;
    else if (k === "COMMENT" || k === "DESCRIPTION") out.comment = out.comment ?? v;
  }
}

function parseFlacPicture(d: Uint8Array, wantCover: boolean): Cover | null {
  let p = 4;
  const mlen = be32(d, p); p += 4;
  const mime = latin1(d.subarray(p, p + mlen)).toLowerCase(); p += mlen;
  const dlen = be32(d, p); p += 4 + dlen + 16;
  const len = be32(d, p); p += 4;
  if (len < 200 || p + len > d.length) return null;
  return wantCover ? { mime: mime.includes("png") ? "image/png" : "image/jpeg", data: d.slice(p, p + len) } : { mime, data: new Uint8Array(0) };
}

// ---------------------------------------------------------------- MP4

function parseIlst(b: Uint8Array, start: number, end: number, out: Raw, wantCover: boolean) {
  let p = start;
  while (p + 8 <= end) {
    const size = be32(b, p);
    if (size < 8 || p + size > end) break;
    const type = latin1(b.subarray(p + 4, p + 8));
    const d = p + 8;
    if (d + 16 <= p + size && latin1(b.subarray(d + 4, d + 8)) === "data") {
      const dsize = be32(b, d), kind = be32(b, d + 8) & 0xffffff;
      const val = b.subarray(d + 16, Math.min(d + dsize, p + size));
      if (type === "trkn") out.track = val.length >= 4 ? String((val[2] << 8) | val[3]) : null;
      else if (type === "covr") {
        if (val.length > 200) out.cover = wantCover ? { mime: kind === 14 ? "image/png" : "image/jpeg", data: val.slice() } : { mime: "", data: new Uint8Array(0) };
      } else {
        const v = clean(utf8.decode(val));
        if (type === "\xa9alb") out.album = v;
        else if (type === "\xa9day") out.date = v;
        else if (type === "\xa9ART") out.artist = v;
        else if (type === "\xa9nam") out.title = v;
        else if (type === "\xa9cmt") out.comment = v;
      }
    }
    p += size;
  }
}
// moov > udta > meta > ilst (meta has 4 extra bytes before its children)
function findIlst(b: Uint8Array, start: number, end: number, out: Raw, wantCover: boolean) {
  let p = start;
  while (p + 8 <= end) {
    const size = be32(b, p);
    if (size < 8 || p + size > end) break;
    const type = latin1(b.subarray(p + 4, p + 8));
    if (type === "udta" || type === "moov") findIlst(b, p + 8, p + size, out, wantCover);
    else if (type === "meta") findIlst(b, p + 12, p + size, out, wantCover);
    else if (type === "ilst") parseIlst(b, p + 8, p + size, out, wantCover);
    p += size;
  }
}

// ------------------------------------------------------------- reading

async function readRaw(file: File, wantCover: boolean): Promise<Raw> {
  const head = await bytes(file, 0, 65536);
  const magic = latin1(head.subarray(0, 4));
  if (magic.startsWith("ID3")) {
    const total = Math.min(10 + syncsafe(head, 6), MAX_TAG);
    return parseId3(total <= head.length ? head : await bytes(file, 0, total), wantCover);
  }
  if (magic === "fLaC") {
    // Walk the metadata blocks (a picture can make them big).
    let p = 4, end = 4;
    for (let n = 0; n < 64; n++) {
      const h = await bytes(file, p, p + 4);
      if (h.length < 4) break;
      const len = (h[1] << 16) | (h[2] << 8) | h[3];
      end = p + 4 + len;
      if (h[0] & 0x80 || end > MAX_TAG) break;
      p = end;
    }
    const b = await bytes(file, 0, Math.min(end, MAX_TAG));
    const out: Raw = {};
    p = 4;
    while (p + 4 <= b.length) {
      const last = (b[p] & 0x80) !== 0, type = b[p] & 0x7f, len = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
      if (type === 4) parseVorbis(b, p + 4, out);
      // Pictures: the front cover (type 3) wins, else the first one.
      if (type === 6 && p + 8 <= b.length && (!out.cover || be32(b, p + 4) === 3)) {
        const c = parseFlacPicture(b.subarray(p + 4, p + 4 + len), wantCover);
        if (c) out.cover = c;
      }
      p += 4 + len;
      if (last) break;
    }
    return out;
  }
  if (magic === "OggS") {
    const out: Raw = {};
    const s = latin1(head);
    let i = s.indexOf("\x03vorbis");
    if (i >= 0) parseVorbis(head, i + 7, out);
    else if ((i = s.indexOf("OpusTags")) >= 0) parseVorbis(head, i + 8, out);
    return out;
  }
  if (latin1(head.subarray(4, 8)) === "ftyp") {
    // Find the moov atom (often at the end) and read just that.
    let p = 0;
    for (let n = 0; n < 64 && p + 8 <= file.size; n++) {
      const h = await bytes(file, p, p + 16);
      let size = be32(h, 0);
      const type = latin1(h.subarray(4, 8));
      if (size === 1) size = be32(h, 8) * 4294967296 + be32(h, 12);
      else if (size === 0) size = file.size - p;
      if (size < 8) break;
      if (type === "moov") {
        if (size > MAX_TAG) break;
        const b = await bytes(file, p, p + size);
        const out: Raw = {};
        findIlst(b, 8, b.length, out, wantCover);
        return out;
      }
      p += size;
    }
  }
  return {};
}

// ------------------------------------------------------------ tidying

function fullDate(raw: Raw): string | null {
  const m = (raw.date ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // ID3v2.3: year in TYER, DDMM in TDAT
  if (/^\d{4}$/.test(raw.year ?? "") && /^\d{4}$/.test(raw.ddmm ?? "")) {
    return `${raw.year}-${raw.ddmm!.slice(2, 4)}-${raw.ddmm!.slice(0, 2)}`;
  }
  return null;
}
function validDate(d: string | null) {
  if (!d) return null;
  const t = Date.parse(`${d}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  const y = Number(d.slice(0, 4));
  return y >= 1900 && y <= new Date().getFullYear() + 1 && new Date(t).toISOString().slice(0, 10) === d ? d : null;
}
const JUNK_ALBUM = /^(unknown|untitled|none|n\/a|youtube|soundcloud|single|singles|misc|various)\b|https?:|www\./i;

const SPLIT = /\s*(?:,|;|\/|&|\+|\bx\b|\band\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/i;
function names(s: string) {
  return s.split(SPLIT).map((x) => x.trim()).filter((x) => x.length > 0 && x.length < 60);
}
const key = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");

// Featured artists: everyone in the artist field other than the main artist,
// plus "(feat. X)" / "(with X)" / "ft. X" in the title.
function features(raw: Raw, mainArtist: string | null): string | null {
  const found: string[] = [];
  let artist = raw.artist ?? "";
  if (mainArtist) {
    const i = artist.toLowerCase().indexOf(mainArtist.toLowerCase());
    if (i >= 0) artist = artist.slice(0, i) + " , " + artist.slice(i + mainArtist.length);
  }
  if (mainArtist && artist !== raw.artist) found.push(...names(artist));
  const t = raw.title ?? "";
  const m = t.match(/[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)\]]+)[)\]]/i) ?? t.match(/\s(?:feat\.?|ft\.?|featuring)\s+(.+?)(?:\s*[([]|$)/i);
  if (m) found.push(...names(m[1]));
  const main = key(mainArtist ?? "");
  const seen = new Set<string>();
  const out = found.filter((n) => {
    const k = key(n);
    if (!k || k === main || seen.has(k) || /^(prod|producedby)/.test(k)) return false;
    seen.add(k);
    return true;
  });
  return out.length ? out.join(", ") : null;
}

function producers(raw: Raw): string | null {
  if (raw.producer) return clean(raw.producer);
  const m = (raw.title ?? "").match(/[([]\s*prod(?:uced)?\.?\s*(?:by\s+)?([^)\]]+)[)\]]/i)
    ?? (raw.comment ?? "").match(/^\s*prod(?:uced)?\.?\s*(?:by\s+)?(.{2,80})$/i);
  return m ? clean(m[1]) : null;
}

// The details worth offering to the archive. mainArtist is the song's artist
// on the site, so it isn't counted as a feature.
export async function readDetails(file: File, mainArtist: string | null): Promise<FileDetails> {
  let raw: Raw = {};
  try { raw = await readRaw(file, false); } catch { /* unreadable */ }
  const album = clean(raw.album);
  const track = (raw.track ?? "").match(/^\s*0*(\d{1,3})/)?.[1] ?? null;
  return {
    album: album && !JUNK_ALBUM.test(album) && album.length <= 200 ? album : null,
    date: validDate(fullDate(raw)),
    track: track && Number(track) >= 1 && Number(track) <= 300 ? track : null,
    featuring: features(raw, mainArtist),
    producers: producers(raw),
    hasCover: !!raw.cover,
  };
}

// The cover picture, shrunk to at most 600×600 JPEG on the device.
export async function readCover(file: File): Promise<Blob | null> {
  let raw: Raw = {};
  try { raw = await readRaw(file, true); } catch { return null; }
  if (!raw.cover || raw.cover.data.length < 200) return null;
  try {
    const img = await createImageBitmap(new Blob([raw.cover.data as BlobPart], { type: raw.cover.mime }));
    if (img.width < 100 || img.height < 100) return null;
    const scale = Math.min(1, 600 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85));
  } catch {
    return null;
  }
}
