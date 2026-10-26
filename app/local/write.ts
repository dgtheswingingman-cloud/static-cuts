// Local Cuts: write tidied copies of music files, on the device.
//   MP3:  new ID3v2.3 tag (title, artist, album, album artist, track, year,
//         features in the artist, cover art); old tags removed.
//   FLAC: new Vorbis comments (keeping any others) and cover picture.
//   Other formats (M4A, WAV, OGG...): copied as they are, just renamed.
// Audio data is never changed. Originals are never touched: these make new
// files. Also a small "store only" zip writer for browsers that can't save
// into a folder.

export type NewTags = {
  title: string; artist: string; album?: string | null; albumArtist?: string | null;
  track?: string | null; year?: string | null; cover?: { mime: string; data: Uint8Array } | null;
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
  if (t.cover) frames.push(apicFrame(t.cover));
  const body = concat(frames);
  const padded = concat([body, new Uint8Array(1024)]); // room for later edits
  const n = padded.length;
  const size = new Uint8Array([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]);
  return concat([enc.encode("ID3"), new Uint8Array([3, 0, 0]), size, padded]);
}

async function writeMp3(file: Blob, t: NewTags) {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  let start = 0;
  if (latin1(head.subarray(0, 3)) === "ID3") {
    start = 10 + ((head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9]) + (head[5] & 0x10 ? 10 : 0);
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
  if (latin1(head.subarray(0, 4)) !== "fLaC") throw new Error("Invalid FLAC signature; skipped export.");
  const keep: { type: number; data: Uint8Array }[] = [];
  const oldComments: string[] = [];
  let p = 4;
  for (;;) {
    if (p + 4 > head.length) throw new Error("Truncated FLAC metadata header; skipped export.");
    const last = (head[p] & 0x80) !== 0, type = head[p] & 0x7f;
    const len = (head[p + 1] << 16) | (head[p + 2] << 8) | head[p + 3];
    const dataStart = p + 4;
    if (len > head.length - dataStart || len > file.size - dataStart) {
      throw new Error("Truncated FLAC metadata block; skipped export.");
    }
    if (p === 4 && (type !== 0 || len !== 34)) {
      throw new Error("Invalid FLAC STREAMINFO block; skipped export.");
    }
    const data = head.subarray(dataStart, dataStart + len);
    if (type === 4) {
      if (data.length < 8) throw new Error("Invalid FLAC Vorbis comments; skipped export.");
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const vendorLength = view.getUint32(0, true);
      if (vendorLength > data.length - 8) throw new Error("Invalid FLAC Vorbis vendor length; skipped export.");
      let q = 4 + vendorLength;
      const count = view.getUint32(q, true); q += 4;
      if (count > Math.floor((data.length - q) / 4)) {
        throw new Error("Invalid FLAC Vorbis comment count; skipped export.");
      }
      for (let i = 0; i < count; i++) {
        const length = view.getUint32(q, true); q += 4;
        if (length > data.length - q) throw new Error("Invalid FLAC Vorbis comment length; skipped export.");
        oldComments.push(new TextDecoder().decode(data.subarray(q, q + length)));
        q += length;
      }
    } else if (type === 6 && t.cover) {
      // replaced by the new picture
    } else if (type !== 1) {
      keep.push({ type, data: data.slice() });
    }
    p = dataStart + len;
    if (last) break;
  }
  if (p >= file.size) throw new Error("FLAC has no audio bytes after metadata; skipped export.");
  const ours: Record<string, string | null | undefined> = {
    TITLE: t.title, ARTIST: t.artist, ALBUM: t.album, ALBUMARTIST: t.albumArtist, TRACKNUMBER: t.track, DATE: t.year,
  };
  const comments = [
    ...oldComments.filter((c) => !(c.split("=")[0].toUpperCase() in ours)),
    ...Object.entries(ours).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`),
  ].map((c) => enc.encode(c));
  const vendor = enc.encode("Static Cuts");
  const vorbis = concat([le32(vendor.length), vendor, le32(comments.length), ...comments.flatMap((c) => [le32(c.length), c])]);
  keep.push({ type: 4, data: vorbis });
  if (t.cover) {
    const mime = enc.encode(t.cover.mime);
    keep.push({ type: 6, data: concat([be32(3), be32(mime.length), mime, be32(0), be32(0), be32(0), be32(0), be32(0), be32(t.cover.data.length), t.cover.data]) });
  }
  keep.push({ type: 1, data: new Uint8Array(1024) }); // padding for later edits
  const blocks = keep.map((b, i) => {
    if (b.data.length > 0xffffff) throw new Error("FLAC metadata block exceeds the 24-bit size limit; skipped export.");
    const h = new Uint8Array([(i === keep.length - 1 ? 0x80 : 0) | b.type, (b.data.length >> 16) & 255, (b.data.length >> 8) & 255, b.data.length & 255]);
    return concat([h, b.data]);
  });
  return new Blob([enc.encode("fLaC"), ...blocks, file.slice(p)], { type: "audio/flac" });
}

// What happens to a file of this type.
export function canTag(name: string) {
  return /\.(mp3|flac)$/i.test(name);
}

export async function tidiedCopy(file: File, t: NewTags): Promise<Blob> {
  if (/\.mp3$/i.test(file.name)) return writeMp3(file, t);
  if (/\.flac$/i.test(file.name)) return writeFlac(file, t);
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
async function crc32Blob(blob: Blob): Promise<number> {
  let c = 0xffffffff;
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const b of value) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
    }
  } finally { reader.releaseLock(); }
  return (c ^ 0xffffffff) >>> 0;
}
function le16(n: number) { return new Uint8Array([n & 255, (n >>> 8) & 255]); }

// ZIP32 without compression (audio rarely compresses). Keep the source Blob
// as a Blob part instead of copying every recording into a full-size buffer.
export async function makeZip(entries: { path: string; blob: Blob }[], onProgress?: (i: number) => void): Promise<Blob> {
  const MAX_ZIP32 = 0xffffffff;
  if (entries.length > 0xffff) throw new Error("Too many files for a ZIP archive (maximum 65,535).");
  const names = entries.map((e) => enc.encode(e.path));
  let expectedSize = 22; // end-of-central-directory record
  for (let i = 0; i < entries.length; i++) {
    const { blob } = entries[i];
    const nameLength = names[i].length;
    if (nameLength > 0xffff) throw new Error(`ZIP filename is too long: ${entries[i].path.slice(0, 80)}`);
    if (blob.size > MAX_ZIP32) throw new Error("A file exceeds the 4 GB ZIP limit. Save to a folder or split the batch.");
    expectedSize += 30 + nameLength + blob.size + 46 + nameLength;
    if (expectedSize > MAX_ZIP32) throw new Error("ZIP exceeds the 4 GB limit. Save to a folder or split the batch.");
  }
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const name = names[i];
    const crc = await crc32Blob(e.blob);
    const size = e.blob.size;
    const local = concat([le32(0x04034b50), le16(20), le16(0x0800), le16(0), le16(0), le16(0), le32(crc), le32(size), le32(size), le16(name.length), le16(0), name]);
    parts.push(local, e.blob);
    central.push(concat([le32(0x02014b50), le16(20), le16(20), le16(0x0800), le16(0), le16(0), le16(0), le32(crc), le32(size), le32(size),
      le16(name.length), le16(0), le16(0), le16(0), le16(0), le32(0), le32(offset), name]));
    offset += local.length + size;
    onProgress?.(i + 1);
  }
  const cd = concat(central);
  const endRec = concat([le32(0x06054b50), le16(0), le16(0), le16(entries.length), le16(entries.length), le32(cd.length), le32(offset), le16(0)]);
  return new Blob([...parts, cd, endRec], { type: "application/zip" });
}
