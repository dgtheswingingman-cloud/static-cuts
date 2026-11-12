// Local Cuts: write tidied copies of music files, on the device.
//   MP3:  new ID3v2.3 tag (title, artist, album, album artist, track, year,
//         features in the artist, cover art, and the Static-Cuts code in a
//         TXXX:STATICCUTS frame players ignore); old tags removed.
//   FLAC: new Vorbis comments (keeping any others, plus STATICCUTS=code) and
//         cover picture.
//   M4A:  iTunes-style tags in moov/udta/meta/ilst (title, artist, album,
//         album artist, track, year, cover) plus a ----:com.apple.iTunes:
//         STATICCUTS item; chunk offsets moved if the tags sit before the audio.
//   WAV:  an "id3 " chunk (as MP3) and a LIST/INFO chunk (title, artist...).
//   OGG/Opus: the comment header rewritten (as FLAC, cover as
//         METADATA_BLOCK_PICTURE), pages renumbered and re-checksummed.
//   Anything else (WebM, AIFF...): copied as it is, just renamed.
// Audio data is never changed. Originals are never touched: these make new
// files. Also a small "store only" zip writer for browsers that can't save
// into a folder.

export type NewTags = {
  title: string; artist: string; album?: string | null; albumArtist?: string | null;
  track?: string | null; year?: string | null; cover?: { mime: string; data: Uint8Array } | null;
  code?: string | null; // the song's Static-Cuts code, so the next run matches the file exactly
};

const enc = new TextEncoder();
function concat(parts: Uint8Array[]) {
  const len = parts.reduce((t, p) => t + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function be32(n: number) { return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }
function le32(n: number) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }
function latin1(b: Uint8Array) { let s = ""; for (const c of b) s += String.fromCharCode(c); return s; }

// ------------------------------------------------------------------- MP3

function utf16Frame(id: string, text: string) {
  // encoding 1 = UTF-16 with BOM (what every player reads in ID3v2.3)
  const body = [0x01, 0xff, 0xfe];
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); body.push(c & 255, c >> 8); }
  body.push(0, 0);
  const data = new Uint8Array(body);
  return concat([enc.encode(id), be32(data.length), new Uint8Array([0, 0]), data]);
}
function txxxFrame(desc: string, value: string) {
  // encoding 0 (Latin-1): description, a zero byte, then the value (all plain ASCII here)
  const data = concat([new Uint8Array([0x00]), enc.encode(desc), new Uint8Array([0]), enc.encode(value)]);
  return concat([enc.encode("TXXX"), be32(data.length), new Uint8Array([0, 0]), data]);
}
function apicFrame(cover: { mime: string; data: Uint8Array }) {
  const data = concat([new Uint8Array([0x00]), enc.encode(cover.mime), new Uint8Array([0, 0x03, 0]), cover.data]);
  return concat([enc.encode("APIC"), be32(data.length), new Uint8Array([0, 0]), data]);
}
function id3v23(t: NewTags) {
  const frames: Uint8Array[] = [utf16Frame("TIT2", t.title), utf16Frame("TPE1", t.artist)];
  if (t.album) frames.push(utf16Frame("TALB", t.album));
  if (t.albumArtist) frames.push(utf16Frame("TPE2", t.albumArtist));
  if (t.track) frames.push(utf16Frame("TRCK", t.track));
  if (t.year) frames.push(utf16Frame("TYER", t.year));
  if (t.code) frames.push(txxxFrame("STATICCUTS", t.code));
  if (t.cover) frames.push(apicFrame(t.cover));
  const body = concat(frames);
  const padded = concat([body, new Uint8Array(1024)]); // room for later edits
  const n = padded.length;
  const size = new Uint8Array([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]);
  return concat([enc.encode("ID3"), new Uint8Array([3, 0, 0]), size, padded]);
}

// The picture already in an MP3's tag (ID3v2.3 / 2.4), so a tidied copy
// with no new cover keeps the file's own art instead of losing it.
async function oldMp3Cover(file: Blob, head: Uint8Array, start: number): Promise<{ mime: string; data: Uint8Array } | null> {
  const v = head[3];
  if (v !== 3 && v !== 4) return null;
  const tag = new Uint8Array(await file.slice(10, start).arrayBuffer());
  const syncsafe = (b: Uint8Array, i: number) => (b[i] << 21) | (b[i + 1] << 14) | (b[i + 2] << 7) | b[i + 3];
  let i = head[5] & 0x40 ? 4 + (v === 4 ? syncsafe(tag, 0) - 4 : (tag[0] << 24 | tag[1] << 16 | tag[2] << 8 | tag[3])) : 0;
  while (i + 10 <= tag.length) {
    const id = latin1(tag.subarray(i, i + 4));
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = v === 4 ? syncsafe(tag, i + 4) : ((tag[i + 4] << 24) | (tag[i + 5] << 16) | (tag[i + 6] << 8) | tag[i + 7]) >>> 0;
    if (size <= 0 || i + 10 + size > tag.length) break;
    if (id === "APIC") {
      const b = tag.subarray(i + 10, i + 10 + size);
      const enc0 = b[0];
      let j = 1;
      while (j < b.length && b[j] !== 0) j++;
      const mime = latin1(b.subarray(1, j)) || "image/jpeg";
      j += 2; // end of mime, picture type
      if (enc0 === 1 || enc0 === 2) { while (j + 1 < b.length && !(b[j] === 0 && b[j + 1] === 0)) j += 2; j += 2; }
      else { while (j < b.length && b[j] !== 0) j++; j += 1; }
      if (j < b.length) return { mime: mime.includes("/") ? mime : `image/${mime.toLowerCase() === "png" ? "png" : "jpeg"}`, data: b.slice(j) };
    }
    i += 10 + size;
  }
  return null;
}

async function writeMp3(file: Blob, t: NewTags) {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  let start = 0;
  if (latin1(head.subarray(0, 3)) === "ID3") {
    start = 10 + ((head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9]) + (head[5] & 0x10 ? 10 : 0);
    if (!t.cover) {
      try { const c = await oldMp3Cover(file, head, start); if (c) t = { ...t, cover: c }; } catch { /* no picture then */ }
    }
  }
  let end = file.size;
  if (file.size > 128) {
    const tail = new Uint8Array(await file.slice(file.size - 128).arrayBuffer());
    if (latin1(tail.subarray(0, 3)) === "TAG") end -= 128;
  }
  return new Blob([id3v23(t), file.slice(start, end)], { type: "audio/mpeg" });
}

// ------------------------------------------------------------------ FLAC

async function writeFlac(file: Blob, t: NewTags) {
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 16 * 1024 * 1024)).arrayBuffer());
  if (latin1(head.subarray(0, 4)) !== "fLaC") return file;
  const dv = new DataView(head.buffer);
  const keep: { type: number; data: Uint8Array }[] = [];
  const oldComments: string[] = [];
  let p = 4;
  for (;;) {
    if (p + 4 > head.length) return file; // metadata bigger than we read: leave it alone
    const last = (head[p] & 0x80) !== 0, type = head[p] & 0x7f;
    const len = (head[p + 1] << 16) | (head[p + 2] << 8) | head[p + 3];
    const data = head.subarray(p + 4, p + 4 + len);
    if (type === 4) {
      let q = 4 + dv.getUint32(p + 4, true);
      const count = dv.getUint32(p + 4 + q, true); q += 4;
      for (let i = 0; i < count; i++) {
        const l = dv.getUint32(p + 4 + q, true); q += 4;
        oldComments.push(new TextDecoder().decode(head.subarray(p + 4 + q, p + 4 + q + l))); q += l;
      }
    } else if (type === 6 && t.cover) {
      // replaced by the new picture
    } else if (type !== 1) {
      keep.push({ type, data: data.slice() });
    }
    p += 4 + len;
    if (last) break;
  }
  const ours: Record<string, string | null | undefined> = {
    TITLE: t.title, ARTIST: t.artist, ALBUM: t.album, ALBUMARTIST: t.albumArtist, TRACKNUMBER: t.track, DATE: t.year, STATICCUTS: t.code,
  };
  const comments = [
    ...oldComments.filter((c) => !ours[c.split("=")[0].toUpperCase()]),
    ...Object.entries(ours).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`),
  ].map((c) => enc.encode(c));
  const vendor = enc.encode("Static-Cuts");
  const vorbis = concat([le32(vendor.length), vendor, le32(comments.length), ...comments.flatMap((c) => [le32(c.length), c])]);
  keep.push({ type: 4, data: vorbis });
  if (t.cover) {
    const mime = enc.encode(t.cover.mime);
    keep.push({ type: 6, data: concat([be32(3), be32(mime.length), mime, be32(0), be32(0), be32(0), be32(0), be32(0), be32(t.cover.data.length), t.cover.data]) });
  }
  keep.push({ type: 1, data: new Uint8Array(1024) }); // padding for later edits
  const blocks = keep.map((b, i) => {
    const h = new Uint8Array([(i === keep.length - 1 ? 0x80 : 0) | b.type, (b.data.length >> 16) & 255, (b.data.length >> 8) & 255, b.data.length & 255]);
    return concat([h, b.data]);
  });
  return new Blob([enc.encode("fLaC"), ...blocks, file.slice(p)], { type: "audio/flac" });
}

// ------------------------------------------------- code only (kept files)

// Files kept as they are still get the song's code, with nothing else
// changed: MP3s get the one TXXX frame added to their existing tag (or a new
// tag with only that, if they had none); FLACs get one more comment.
async function addCodeMp3(file: Blob, code: string): Promise<Blob> {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  const frame = txxxFrame("STATICCUTS", code);
  if (latin1(head.subarray(0, 3)) !== "ID3") {
    const n = frame.length + 1024;
    const size = new Uint8Array([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]);
    return new Blob([enc.encode("ID3"), new Uint8Array([3, 0, 0]), size, frame, new Uint8Array(1024), file], { type: "audio/mpeg" });
  }
  const ver = head[3], flags = head[5];
  // Unsynchronised, extended-header or old (v2.2) tags: leave the file alone.
  if ((ver !== 3 && ver !== 4) || (flags & 0xc0)) return file;
  const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
  const tag = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
  const frames: Uint8Array[] = [];
  let p = 0;
  while (p + 10 <= tag.length) {
    const id = latin1(tag.subarray(p, p + 4));
    if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding
    const fsize = ver === 4
      ? (tag[p + 4] << 21) | (tag[p + 5] << 14) | (tag[p + 6] << 7) | tag[p + 7]
      : (tag[p + 4] << 24) | (tag[p + 5] << 16) | (tag[p + 6] << 8) | tag[p + 7];
    if (fsize <= 0 || p + 10 + fsize > tag.length) break;
    const whole = tag.subarray(p, p + 10 + fsize);
    const isOurs = id === "TXXX" && latin1(tag.subarray(p + 11, p + 21)).toUpperCase() === "STATICCUTS";
    if (!isOurs) frames.push(whole);
    p += 10 + fsize;
  }
  // v2.4 frame sizes are "syncsafe"; v2.3 plain.
  const ours = ver === 4
    ? concat([frame.subarray(0, 4), new Uint8Array([(frame.length - 10 >> 21) & 127, (frame.length - 10 >> 14) & 127, (frame.length - 10 >> 7) & 127, (frame.length - 10) & 127]), frame.subarray(8)])
    : frame;
  const body = concat([...frames, ours, new Uint8Array(1024)]);
  const n = body.length;
  const sz = new Uint8Array([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]);
  const footer = flags & 0x10 ? 10 : 0;
  return new Blob([enc.encode("ID3"), new Uint8Array([ver, 0, 0]), sz, body, file.slice(10 + size + footer)], { type: "audio/mpeg" });
}

export async function withCode(file: File, code: string): Promise<Blob> {
  const t: NewTags = { title: "", artist: "", code };
  try {
    if (/\.mp3$/i.test(file.name)) return await addCodeMp3(file, code);
    if (/\.flac$/i.test(file.name)) return await writeFlac(file, t);
    if (/\.(m4a|mp4|aac|alac)$/i.test(file.name)) return await writeMp4(file, t, true);
    if (/\.wav$/i.test(file.name)) return await writeWav(file, t, true);
    if (/\.(ogg|oga|opus)$/i.test(file.name)) return await writeOgg(file, t, true);
  } catch { /* odd file: keep it exactly as it was */ }
  return file;
}

// ------------------------------------------------------------------- M4A

const u8 = (...n: number[]) => new Uint8Array(n);
function atom(type: string, ...parts: Uint8Array[]) {
  const body = concat(parts);
  return concat([be32(body.length + 8), enc.encode(type), body]);
}
// Atoms one after another: type, where the body starts and where the atom ends.
function atoms(b: Uint8Array, start: number, end: number) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: { type: string; start: number; body: number; end: number }[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p), head = 8;
    if (size === 1) { size = Number(dv.getBigUint64(p + 8)); head = 16; } else if (size === 0) size = end - p;
    if (size < head || p + size > end) throw new Error("bad atom");
    out.push({ type: latin1(b.subarray(p + 4, p + 8)), start: p, body: p + head, end: p + size });
    p += size;
  }
  return out;
}
const MP4_OURS: Record<string, string> = { title: "\xa9nam", artist: "\xa9ART", album: "\xa9alb", albumArtist: "aART", year: "\xa9day" };
const ltype = (t: string) => new Uint8Array([...t].map((c) => c.charCodeAt(0)));
function ilstItems(t: NewTags, codeOnly: boolean) {
  const data = (kind: number, v: Uint8Array) => atom("data", be32(kind), be32(0), v);
  const items: Uint8Array[] = [];
  if (!codeOnly) {
    for (const [k, id] of Object.entries(MP4_OURS)) {
      const v = t[k as keyof NewTags] as string | null | undefined;
      if (v) items.push(atomL(id, data(1, enc.encode(v))));
    }
    const n = Number(t.track);
    if (t.track && n > 0) items.push(atomL("trkn", data(0, u8(0, 0, (n >> 8) & 255, n & 255, 0, 0, 0, 0))));
    if (t.cover) items.push(atomL("covr", data(t.cover.mime === "image/png" ? 14 : 13, t.cover.data)));
  }
  if (t.code) items.push(atomL("----", atom("mean", be32(0), enc.encode("com.apple.iTunes")), atom("name", be32(0), enc.encode("STATICCUTS")), data(1, enc.encode(t.code))));
  return items;
}
// atom() for types with © (one byte each, not UTF-8).
function atomL(type: string, ...parts: Uint8Array[]) {
  const body = concat(parts);
  return concat([be32(body.length + 8), ltype(type), body]);
}
function isOurFreeform(b: Uint8Array, a: { body: number; end: number }) {
  try { return atoms(b, a.body, a.end).some((c) => c.type === "name" && latin1(b.subarray(c.body + 4, c.end)) === "STATICCUTS"); } catch { return false; }
}
async function writeMp4(file: Blob, t: NewTags, codeOnly: boolean): Promise<Blob> {
  if (file.size > 400 * 1024 * 1024) return file;
  const b = new Uint8Array(await file.arrayBuffer());
  const top = atoms(b, 0, b.length);
  const moov = top.find((a) => a.type === "moov");
  if (!moov || top[0]?.type !== "ftyp") return file;
  const replace = new Set(codeOnly ? [] : [...Object.values(MP4_OURS), "trkn", ...(t.cover ? ["covr"] : [])]);
  // ilst: keep everything that isn't being replaced
  const buildIlst = (old?: { body: number; end: number }) => {
    const kept = old ? atoms(b, old.body, old.end).filter((a) => !replace.has(a.type) && !(a.type === "----" && isOurFreeform(b, a))).map((a) => b.subarray(a.start, a.end)) : [];
    return atom("ilst", ...kept, ...ilstItems(t, codeOnly));
  };
  const hdlr = atom("hdlr", be32(0), be32(0), enc.encode("mdirappl"), be32(0), be32(0), u8(0));
  const buildMeta = (old?: { body: number; end: number }) => {
    if (!old) return atom("meta", be32(0), hdlr, buildIlst());
    const kids = atoms(b, old.body + 4, old.end);
    const il = kids.find((k) => k.type === "ilst");
    const rest = kids.filter((k) => k.type !== "ilst" && k.type !== "free").map((k) => b.subarray(k.start, k.end));
    return atom("meta", b.subarray(old.body, old.body + 4), ...(kids.some((k) => k.type === "hdlr") ? [] : [hdlr]), ...rest, buildIlst(il));
  };
  const buildUdta = (old?: { body: number; end: number }) => {
    if (!old) return atom("udta", buildMeta());
    const kids = atoms(b, old.body, old.end);
    const me = kids.find((k) => k.type === "meta");
    return atom("udta", ...kids.filter((k) => k.type !== "meta").map((k) => b.subarray(k.start, k.end)), buildMeta(me));
  };
  const mk = atoms(b, moov.body, moov.end);
  const ud = mk.find((k) => k.type === "udta");
  const newMoov = atom("moov", ...mk.filter((k) => k.type !== "udta").map((k) => b.subarray(k.start, k.end)), buildUdta(ud));
  const delta = newMoov.length - (moov.end - moov.start);
  // The audio's position is written in stco/co64 tables: if the tags grow
  // before the audio, move every offset after the old moov by the same amount.
  if (delta !== 0) {
    const dv = new DataView(newMoov.buffer, newMoov.byteOffset, newMoov.byteLength);
    const fix = (start: number, end: number) => {
      for (const a of atoms(newMoov, start, end)) {
        if (["trak", "mdia", "minf", "stbl"].includes(a.type)) fix(a.body, a.end);
        else if (a.type === "stco") {
          const n = dv.getUint32(a.body + 4);
          for (let i = 0; i < n; i++) { const q = a.body + 8 + i * 4; const v = dv.getUint32(q); if (v > moov.start) dv.setUint32(q, v + delta); }
        } else if (a.type === "co64") {
          const n = dv.getUint32(a.body + 4);
          for (let i = 0; i < n; i++) { const q = a.body + 8 + i * 8; const v = dv.getBigUint64(q); if (v > BigInt(moov.start)) dv.setBigUint64(q, v + BigInt(delta)); }
        }
      }
    };
    fix(8, newMoov.length);
  }
  return new Blob([b.subarray(0, moov.start), newMoov, b.subarray(moov.end)], { type: "audio/mp4" });
}

// ------------------------------------------------------------------- WAV

function infoChunk(t: NewTags) {
  const sub = (id: string, v: string | null | undefined) => {
    if (!v) return new Uint8Array(0);
    const d = concat([enc.encode(v), u8(0)]);
    return concat([enc.encode(id), le32(d.length), d, d.length % 2 ? u8(0) : new Uint8Array(0)]);
  };
  const body = concat([enc.encode("INFO"), sub("INAM", t.title), sub("IART", t.artist), sub("IPRD", t.album), sub("ICRD", t.year), sub("ITRK", t.track)]);
  return concat([enc.encode("LIST"), le32(body.length), body]);
}
async function writeWav(file: Blob, t: NewTags, codeOnly: boolean): Promise<Blob> {
  if (file.size > 2 * 1024 * 1024 * 1024) return file;
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (latin1(head.subarray(0, 4)) !== "RIFF" || latin1(head.subarray(8, 12)) !== "WAVE") return file;
  // Walk the chunks without reading the audio.
  const keep: Blob[] = [];
  let oldId3: Blob | null = null;
  let p = 12;
  while (p + 8 <= file.size) {
    const h = new Uint8Array(await file.slice(p, p + 8).arrayBuffer());
    const id = latin1(h.subarray(0, 4));
    const len = h[4] | (h[5] << 8) | (h[6] << 16) | (h[7] * 16777216);
    const end = Math.min(file.size, p + 8 + len + (len % 2));
    const isInfo = id === "LIST" && latin1(new Uint8Array(await file.slice(p + 8, p + 12).arrayBuffer())) === "INFO";
    if (id === "id3 " || id === "ID3 ") oldId3 = file.slice(p + 8, p + 8 + len);
    else if (!(isInfo && !codeOnly)) keep.push(file.slice(p, end));
    p = end;
  }
  let tag: Uint8Array;
  if (codeOnly) {
    if (!t.code) return file;
    tag = new Uint8Array(await (oldId3 ? await addCodeMp3(oldId3, t.code) : await addCodeMp3(new Blob([]), t.code)).arrayBuffer());
  } else {
    tag = id3v23(t);
  }
  const id3 = concat([enc.encode("id3 "), le32(tag.length), tag, tag.length % 2 ? u8(0) : new Uint8Array(0)]);
  const parts: (Blob | Uint8Array<ArrayBuffer>)[] = [...keep, ...(codeOnly ? [] : [infoChunk(t)]), id3];
  let size = 4;
  for (const x of parts) size += x instanceof Blob ? x.size : x.length;
  return new Blob([enc.encode("RIFF"), le32(size), enc.encode("WAVE"), ...parts], { type: "audio/wav" });
}

// ------------------------------------------------------------- OGG/Opus

const OGG_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0; }
  return t;
})();
function oggCrc(b: Uint8Array) {
  let c = 0;
  for (const x of b) c = ((c << 8) ^ OGG_CRC[((c >>> 24) ^ x) & 255]) >>> 0;
  return c;
}
type OggPage = { type: number; granule: Uint8Array; serial: number; seq: number; segs: number[]; data: Uint8Array; start: number; end: number };
function oggPages(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const pages: OggPage[] = [];
  let p = 0;
  while (p + 27 <= b.length) {
    if (latin1(b.subarray(p, p + 4)) !== "OggS") throw new Error("bad page");
    const n = b[p + 26];
    const segs = [...b.subarray(p + 27, p + 27 + n)];
    const len = segs.reduce((x, y) => x + y, 0);
    const d = p + 27 + n;
    pages.push({ type: b[p + 5], granule: b.slice(p + 6, p + 14), serial: dv.getUint32(p + 14, true), seq: dv.getUint32(p + 18, true), segs, data: b.subarray(d, d + len), start: p, end: d + len });
    p = d + len;
  }
  return pages;
}
function oggPage(type: number, granule: Uint8Array, serial: number, seq: number, segs: number[], data: Uint8Array) {
  const page = concat([enc.encode("OggS"), u8(0, type), granule, le32(serial), le32(seq), le32(0), u8(segs.length), new Uint8Array(segs), data]);
  new DataView(page.buffer).setUint32(22, oggCrc(page), true);
  return page;
}
async function writeOgg(file: Blob, t: NewTags, codeOnly: boolean): Promise<Blob> {
  if (file.size > 400 * 1024 * 1024) return file;
  const b = new Uint8Array(await file.arrayBuffer());
  const pages = oggPages(b);
  if (!pages.length) return file;
  const serial = pages[0].serial;
  // Gather the header packets: Vorbis has 3 (id, comments, setup), Opus 2.
  const packets: Uint8Array[] = [];
  let cur: Uint8Array[] = [], used = 0, want = 0;
  for (; used < pages.length; used++) {
    const pg = pages[used];
    if (pg.serial !== serial) return file; // several streams: leave alone
    let q = 0;
    for (const s of pg.segs) {
      cur.push(pg.data.subarray(q, q + s)); q += s;
      if (s < 255) { packets.push(concat(cur)); cur = []; }
    }
    if (!want && packets.length) want = latin1(packets[0].subarray(0, 8)) === "OpusHead" ? 2 : latin1(packets[0].subarray(1, 7)) === "vorbis" ? 3 : -1;
    if (want < 0) return file;
    if (want && packets.length >= want) { used++; break; }
  }
  if (!want || packets.length !== want || cur.length) return file; // headers share a page with audio: too unusual
  const opus = want === 2;
  const magic = opus ? enc.encode("OpusTags") : concat([u8(3), enc.encode("vorbis")]);
  // Old comments.
  const c = packets[1];
  if (latin1(c.subarray(0, magic.length)) !== latin1(magic)) return file;
  const cdv = new DataView(c.buffer, c.byteOffset, c.byteLength);
  let q = magic.length;
  const vlen = cdv.getUint32(q, true); const vendor = c.subarray(q + 4, q + 4 + vlen); q += 4 + vlen;
  const count = cdv.getUint32(q, true); q += 4;
  const old: string[] = [];
  for (let i = 0; i < count; i++) { const l = cdv.getUint32(q, true); old.push(new TextDecoder().decode(c.subarray(q + 4, q + 4 + l))); q += 4 + l; }
  const ours: Record<string, string | null | undefined> = codeOnly ? { STATICCUTS: t.code } : {
    TITLE: t.title, ARTIST: t.artist, ALBUM: t.album, ALBUMARTIST: t.albumArtist, TRACKNUMBER: t.track, DATE: t.year, STATICCUTS: t.code,
  };
  const newOnes = Object.entries(ours).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
  if (!codeOnly && t.cover) {
    const mime = enc.encode(t.cover.mime);
    const pic = concat([be32(3), be32(mime.length), mime, be32(0), be32(0), be32(0), be32(0), be32(0), be32(t.cover.data.length), t.cover.data]);
    let bin = ""; for (let i = 0; i < pic.length; i += 0x8000) bin += String.fromCharCode(...pic.subarray(i, i + 0x8000));
    newOnes.push(`METADATA_BLOCK_PICTURE=${btoa(bin)}`);
  }
  const drop = (k: string) => !!ours[k] || (!codeOnly && !!t.cover && (k === "METADATA_BLOCK_PICTURE" || k === "COVERART"));
  // Pictures last, so the short tags (and the code) are near the start.
  const isPic = (x: string) => /^(METADATA_BLOCK_PICTURE|COVERART)=/i.test(x);
  const merged = [...old.filter((x) => !drop(x.split("=")[0].toUpperCase())), ...newOnes];
  const all = [...merged.filter((x) => !isPic(x)), ...merged.filter(isPic)].map((x) => enc.encode(x));
  const comment = concat([magic, le32(vendor.length), vendor, le32(all.length), ...all.flatMap((x) => [le32(x.length), x]), opus ? new Uint8Array(0) : u8(1)]);
  // New header pages: the id packet alone, then comments (+ setup) laced over as many pages as needed.
  const zero = new Uint8Array(8);
  const out: Uint8Array<ArrayBuffer>[] = [b.subarray(pages[0].start, pages[0].end)];
  let seq = 1;
  const rest = [comment, ...packets.slice(2)];
  let segs: number[] = [], data: Uint8Array[] = [], cont = false;
  const flush = (more: boolean) => {
    out.push(oggPage(cont ? 1 : 0, zero, serial, seq++, segs, concat(data)));
    segs = []; data = []; cont = more;
  };
  for (const pk of rest) {
    let left = pk.length, off = 0;
    for (;;) {
      if (segs.length === 255) flush(true);
      const s = Math.min(255, left);
      segs.push(s); data.push(pk.subarray(off, off + s)); off += s; left -= s;
      if (s < 255) break;
    }
    cont = false;
  }
  if (segs.length) flush(false);
  // The audio pages, renumbered after the new header pages.
  const shift = seq - pages[used].seq;
  if (shift === 0) out.push(b.subarray(pages[used].start));
  else for (const pg of pages.slice(used)) out.push(oggPage(pg.type, pg.granule, pg.serial, pg.serial === serial ? pg.seq + shift : pg.seq, pg.segs, pg.data));
  return new Blob(out, { type: opus ? "audio/ogg; codecs=opus" : "audio/ogg" });
}

// What happens to a file of this type.
export function canTag(name: string) {
  return /\.(mp3|flac|m4a|mp4|aac|alac|wav|ogg|oga|opus)$/i.test(name);
}

export async function tidiedCopy(file: File, t: NewTags): Promise<Blob> {
  try {
    if (/\.mp3$/i.test(file.name)) return await writeMp3(file, t);
    if (/\.flac$/i.test(file.name)) return await writeFlac(file, t);
    if (/\.(m4a|mp4|aac|alac)$/i.test(file.name)) return await writeMp4(file, t, false);
    if (/\.wav$/i.test(file.name)) return await writeWav(file, t, false);
    if (/\.(ogg|oga|opus)$/i.test(file.name)) return await writeOgg(file, t, false);
  } catch { /* odd file: copy it as it is */ }
  return file; // renamed only
}

// ------------------------------------------------------------- naming

export function safeName(s: string) {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim().slice(0, 120) || "Untitled";
}

// --------------------------------------------------------------- zip

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function le16(n: number) { return new Uint8Array([n & 255, (n >>> 8) & 255]); }

// A zip with no compression (music doesn't compress anyway). Fine for a few
// hundred songs; under 4 GB in total.
export async function makeZip(entries: { path: string; blob: Blob }[], onProgress?: (i: number) => void): Promise<Blob> {
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const data = new Uint8Array(await e.blob.arrayBuffer());
    const name = enc.encode(e.path);
    const crc = crc32(data);
    const local = concat([le32(0x04034b50), le16(20), le16(0x0800), le16(0), le16(0), le16(0), le32(crc), le32(data.length), le32(data.length), le16(name.length), le16(0), name]);
    parts.push(local, data);
    central.push(concat([le32(0x02014b50), le16(20), le16(20), le16(0x0800), le16(0), le16(0), le16(0), le32(crc), le32(data.length), le32(data.length),
      le16(name.length), le16(0), le16(0), le16(0), le16(0), le32(0), le32(offset), name]));
    offset += local.length + data.length;
    onProgress?.(i + 1);
  }
  const cd = concat(central);
  const endRec = concat([le32(0x06054b50), le16(0), le16(0), le16(entries.length), le16(entries.length), le32(cd.length), le32(offset), le16(0)]);
  return new Blob([...parts, cd, endRec], { type: "application/zip" });
}
