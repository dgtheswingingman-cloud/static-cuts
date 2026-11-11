// Local Cuts: read a music file's details (title, artist, album, track
// number, year) on the device. Nothing is uploaded. Handles MP3 (ID3v2 and
// ID3v1), FLAC and OGG/Opus (Vorbis comments), M4A/MP4 and WAV (ID3 chunk,
// LIST/INFO). Also the Static-Cuts code Local Cuts writes. Anything else, or
// a file without tags, falls back to the file name ("Artist - Title (V2).mp3").

export type Tags = { title: string | null; artist: string | null; album: string | null; track: string | null; year: string | null; from: "tags" | "name";
  code?: string | null }; // the Static-Cuts code Local Cuts wrote into the file (STATICCUTS)
const CODE = /^SC-[A-Z0-9]{4}-\d{6,}$/;

const HEAD = 1024 * 1024; // first 1 MB holds almost every tag block

async function bytes(file: Blob, start: number, end: number) {
  return new Uint8Array(await file.slice(start, Math.min(end, file.size)).arrayBuffer());
}

function latin1(b: Uint8Array) { let s = ""; for (const c of b) s += String.fromCharCode(c); return s; }
const utf8 = new TextDecoder("utf-8");
function clean(s: string | null | undefined) {
  const v = (s ?? "").replace(/\0/g, "").trim();
  return v === "" ? null : v;
}

// ---------------------------------------------------------------- ID3v2

function id3Text(b: Uint8Array): string | null {
  if (b.length === 0) return null;
  const enc = b[0];
  const body = b.subarray(1);
  try {
    if (enc === 0) return clean(latin1(body));
    if (enc === 3) return clean(utf8.decode(body));
    if (enc === 1) {
      const le = body[0] === 0xff && body[1] === 0xfe;
      return clean(new TextDecoder(le ? "utf-16le" : "utf-16be").decode(body.subarray(2)));
    }
    if (enc === 2) return clean(new TextDecoder("utf-16be").decode(body));
  } catch { /* odd encoding */ }
  return null;
}

function readId3v2(b: Uint8Array): Partial<Tags> | null {
  if (b.length < 10 || latin1(b.subarray(0, 3)) !== "ID3") return null;
  const ver = b[3];
  const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9];
  const end = Math.min(10 + size, b.length);
  let p = 10;
  if (b[5] & 0x40) { // extended header
    const ext = ver === 4 ? (b[10] << 21) | (b[11] << 14) | (b[12] << 7) | b[13] : ((b[10] << 24) | (b[11] << 16) | (b[12] << 8) | b[13]) + 4;
    p += ext;
  }
  const out: Partial<Tags> = {};
  while (p + 10 <= end) {
    const id = latin1(b.subarray(p, p + 4));
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const fsize = ver === 4
      ? (b[p + 4] << 21) | (b[p + 5] << 14) | (b[p + 6] << 7) | b[p + 7]
      : (b[p + 4] << 24) | (b[p + 5] << 16) | (b[p + 6] << 8) | b[p + 7];
    const data = b.subarray(p + 10, p + 10 + fsize);
    if (id === "TIT2") out.title = id3Text(data);
    else if (id === "TPE1") out.artist = id3Text(data);
    else if (id === "TALB") out.album = id3Text(data);
    else if (id === "TRCK") out.track = id3Text(data);
    else if (id === "TYER" || id === "TDRC") out.year = id3Text(data)?.slice(0, 4) ?? null;
    else if (id === "TXXX") {
      // description \0 value; ours is plain text: STATICCUTS \0 SC-XXXX-000000
      const txt = (data[0] === 0 || data[0] === 3) ? latin1(data.subarray(1)) : (id3Text(data) ?? "");
      const [desc, ...rest] = txt.split(/\u0000+/);
      const v = rest.join("").replace(/[\u0000\ufeff\ufffe]/g, "").trim();
      if (desc.replace(/[\ufeff\ufffe]/g, "").trim().toUpperCase() === "STATICCUTS" && CODE.test(v)) out.code = v;
    }
    p += 10 + fsize;
    if (fsize <= 0) break;
  }
  return out;
}

function readId3v1(b: Uint8Array): Partial<Tags> | null {
  if (b.length !== 128 || latin1(b.subarray(0, 3)) !== "TAG") return null;
  return {
    title: clean(latin1(b.subarray(3, 33))), artist: clean(latin1(b.subarray(33, 63))),
    album: clean(latin1(b.subarray(63, 93))), year: clean(latin1(b.subarray(93, 97))),
    track: b[125] === 0 && b[126] ? String(b[126]) : null,
  };
}

// ---------------------------------------------------- Vorbis comments

function readVorbis(b: Uint8Array, p: number): Partial<Tags> {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Partial<Tags> = {};
  if (p + 4 > b.length) return out;
  const vendor = dv.getUint32(p, true); p += 4 + vendor;
  if (p + 4 > b.length) return out;
  const count = dv.getUint32(p, true); p += 4;
  for (let i = 0; i < count && p + 4 <= b.length; i++) {
    const len = dv.getUint32(p, true); p += 4;
    const s = utf8.decode(b.subarray(p, p + len)); p += len;
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    const k = s.slice(0, eq).toUpperCase(), v = clean(s.slice(eq + 1));
    if (k === "TITLE") out.title = out.title ?? v;
    else if (k === "ARTIST") out.artist = out.artist ?? v;
    else if (k === "ALBUM") out.album = out.album ?? v;
    else if (k === "TRACKNUMBER") out.track = out.track ?? v;
    else if (k === "DATE" || k === "YEAR") out.year = out.year ?? v?.slice(0, 4) ?? null;
    else if (k === "STATICCUTS" && v && CODE.test(v)) out.code = v;
  }
  return out;
}

function readFlac(b: Uint8Array): Partial<Tags> | null {
  if (latin1(b.subarray(0, 4)) !== "fLaC") return null;
  let p = 4;
  while (p + 4 <= b.length) {
    const last = (b[p] & 0x80) !== 0, type = b[p] & 0x7f;
    const len = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
    if (type === 4) return readVorbis(b, p + 4);
    p += 4 + len;
    if (last) break;
  }
  return {};
}

function readOgg(b: Uint8Array): Partial<Tags> | null {
  if (latin1(b.subarray(0, 4)) !== "OggS") return null;
  // Put the second packet (the comments) back together from its pages: a
  // big cover can spread it over many.
  try {
    const parts: Uint8Array[] = [];
    let p = 0, packet = 0;
    while (p + 27 <= b.length && latin1(b.subarray(p, p + 4)) === "OggS") {
      const n = b[p + 26];
      let d = p + 27 + n;
      for (let i = 0; i < n; i++) {
        const s = b[p + 27 + i];
        if (packet === 1) parts.push(b.subarray(d, d + s));
        d += s;
        if (s < 255) { packet++; if (packet === 2) break; }
      }
      if (packet >= 2) break;
      p = d;
    }
    if (packet >= 2) {
      const len = parts.reduce((x, y) => x + y.length, 0);
      const c = new Uint8Array(len);
      let o = 0;
      for (const x of parts) { c.set(x, o); o += x.length; }
      if (latin1(c.subarray(0, 7)) === "\x03vorbis") return readVorbis(c, 7);
      if (latin1(c.subarray(0, 8)) === "OpusTags") return readVorbis(c, 8);
    }
  } catch { /* fall back to looking for the marker */ }
  // The comment header follows the first page; find its marker.
  const s = latin1(b.subarray(0, Math.min(b.length, 65536)));
  let i = s.indexOf("\x03vorbis");
  if (i >= 0) return readVorbis(b, i + 7);
  i = s.indexOf("OpusTags");
  if (i >= 0) return readVorbis(b, i + 8);
  return {};
}

// ---------------------------------------------------------------- WAV

// RIFF chunks: an "id3 " chunk (read as MP3) and LIST/INFO (INAM, IART...).
async function readWav(file: Blob): Promise<Partial<Tags> | null> {
  const head = await bytes(file, 0, 12);
  if (latin1(head.subarray(0, 4)) !== "RIFF" || latin1(head.subarray(8, 12)) !== "WAVE") return null;
  const out: Partial<Tags> = {};
  let id3: Partial<Tags> | null = null;
  let p = 12;
  for (let n = 0; p + 8 <= file.size && n < 64; n++) {
    const h = await bytes(file, p, p + 8);
    const id = latin1(h.subarray(0, 4));
    const len = h[4] | (h[5] << 8) | (h[6] << 16) | (h[7] * 16777216);
    if ((id === "id3 " || id === "ID3 ") && len < 30 * 1024 * 1024) id3 = readId3v2(await bytes(file, p + 8, p + 8 + len));
    else if (id === "LIST" && len < 1024 * 1024) {
      const d = await bytes(file, p + 8, p + 8 + len);
      if (latin1(d.subarray(0, 4)) === "INFO") {
        let q = 4;
        while (q + 8 <= d.length) {
          const sid = latin1(d.subarray(q, q + 4)), sl = d[q + 4] | (d[q + 5] << 8) | (d[q + 6] << 16) | (d[q + 7] << 24);
          const v = clean(utf8.decode(d.subarray(q + 8, q + 8 + sl)));
          if (sid === "INAM") out.title = v; else if (sid === "IART") out.artist = v; else if (sid === "IPRD") out.album = v;
          else if (sid === "ICRD") out.year = v?.slice(0, 4) ?? null; else if (sid === "ITRK") out.track = v;
          q += 8 + sl + (sl % 2);
        }
      }
    }
    p += 8 + len + (len % 2);
  }
  // The ID3 chunk wins where both have something.
  return { ...out, ...Object.fromEntries(Object.entries(id3 ?? {}).filter(([, v]) => v)) };
}

// ---------------------------------------------------------------- MP4

function readMp4(b: Uint8Array): Partial<Tags> | null {
  if (latin1(b.subarray(4, 8)) !== "ftyp") return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Partial<Tags> = {};
  const walk = (start: number, end: number, depth: number) => {
    let p = start;
    while (p + 8 <= end) {
      let size = dv.getUint32(p);
      const type = latin1(b.subarray(p + 4, p + 8));
      if (size === 1 || size < 8 || p + size > end) size = Math.min(size < 8 ? end - p : size, end - p);
      if (["moov", "udta", "ilst"].includes(type)) walk(p + 8, p + size, depth + 1);
      else if (type === "meta") walk(p + 12, p + size, depth + 1);
      else if (depth >= 3 && type === "----") {
        // freeform item: mean, name, data. Ours is name STATICCUTS.
        let q = p + 8, name = "", value = "";
        while (q + 8 <= p + size) {
          const cs = dv.getUint32(q), ct = latin1(b.subarray(q + 4, q + 8));
          if (cs < 8) break;
          if (ct === "name") name = latin1(b.subarray(q + 12, q + cs));
          else if (ct === "data") value = utf8.decode(b.subarray(q + 16, q + cs));
          q += cs;
        }
        if (name === "STATICCUTS" && CODE.test(value.trim())) out.code = value.trim();
      }
      else if (depth >= 3 && ["\xa9nam", "\xa9ART", "\xa9alb", "trkn", "\xa9day"].includes(type)) {
        // child "data" atom: 8 header + 8 (type, locale), then the value
        const d = p + 8;
        if (latin1(b.subarray(d + 4, d + 8)) === "data") {
          const dsize = dv.getUint32(d);
          const val = b.subarray(d + 16, d + dsize);
          if (type === "trkn") out.track = val.length >= 4 ? String((val[2] << 8) | val[3]) : null;
          else {
            const v = clean(utf8.decode(val));
            if (type === "\xa9nam") out.title = v;
            else if (type === "\xa9ART") out.artist = v;
            else if (type === "\xa9alb") out.album = v;
            else out.year = v?.slice(0, 4) ?? null;
          }
        }
      }
      if (size <= 0) break;
      p += size;
    }
  };
  walk(0, b.length, 0);
  return out;
}

// --------------------------------------------------------- file names

// "01 Artist - Title (V2) [CDQ].mp3" -> artist, title.
export function fromName(name: string): { artist: string | null; title: string | null } {
  let base = name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/_/g, " ").trim();
  base = base.replace(/^\s*(\d{1,3})\s*[-.)]?\s+/, "");
  const m = base.match(/^(.{1,80}?)\s+[-–—]\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: null, title: base || null };
}

export async function readTags(file: File): Promise<Tags> {
  let found: Partial<Tags> | null = null;
  try {
    const head = await bytes(file, 0, HEAD);
    found = readId3v2(head) ?? readFlac(head) ?? readOgg(head) ?? readMp4(head) ?? await readWav(file);
    // M4A files sometimes keep their tags at the end.
    if (found && latin1(head.subarray(4, 8)) === "ftyp" && !found.title && file.size > HEAD) {
      const all = await bytes(file, 0, Math.min(file.size, 40 * 1024 * 1024));
      found = readMp4(all);
    }
    if ((!found || !found.title) && file.size > 128) {
      const v1 = readId3v1(await bytes(file, file.size - 128, file.size));
      if (v1) found = { ...v1, ...Object.fromEntries(Object.entries(found ?? {}).filter(([, v]) => v)) };
    }
  } catch { /* unreadable: use the name */ }
  const n = fromName(file.name);
  const hasTags = !!(found && (found.title || found.artist));
  return {
    title: clean(found?.title) ?? n.title,
    artist: clean(found?.artist) ?? n.artist,
    album: clean(found?.album),
    track: clean(found?.track),
    year: clean(found?.year),
    code: found?.code ?? null,
    from: hasTags ? "tags" : "name",
  };
}

// Length in seconds, from the browser's own player.
export function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (v: number | null) => { URL.revokeObjectURL(url); resolve(v); };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? Math.round(a.duration) : null);
    a.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    a.src = url;
  });
}
