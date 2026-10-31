// Local Cuts: write a zip straight to disk as it goes, so a whole music
// library (tens of GB) never has to fit in memory. Store-only (music doesn't
// compress) and ZIP64 when it gets past 4 GB or 65,535 files, which Windows,
// macOS and every unzip app open. Each file's CRC is worked out while it's
// written, then filled into its header.

const enc = new TextEncoder();
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crcUpdate(c: number, b: Uint8Array) {
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return c;
}
const le16 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255]);
const le32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const le64 = (n: number) => { const lo = n % 4294967296, hi = Math.floor(n / 4294967296); return concat([le32(lo), le32(hi)]); };
function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const MAX32 = 0xffffffff; // "see the ZIP64 record" marker
const LIMIT = 0xffffffff; // past this, ZIP64 is needed
// DOS date/time for "now" (shown as the files' dates when unzipped).
function dosStamp() {
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export type Writable = {
  write: (d: Uint8Array | Blob | { type: "write"; position: number; data: Uint8Array } | { type: "seek"; position: number }) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
};

export class ZipToDisk {
  private pos = 0;
  private central: Uint8Array[] = [];
  private count = 0;
  private stamp = dosStamp();
  private out: Writable;
  constructor(out: Writable) { this.out = out; }

  // Add one file. Files must be under 4 GB each (songs always are).
  async add(path: string, blob: Blob) {
    const name = enc.encode(path);
    const size = blob.size;
    const at = this.pos;
    const header = concat([
      le32(0x04034b50), le16(20), le16(0x0800), le16(0), le16(this.stamp.time), le16(this.stamp.date),
      le32(0), le32(size), le32(size), le16(name.length), le16(0), name,
    ]);
    await this.out.write(header);
    this.pos += header.length;
    let crc = 0xffffffff;
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      crc = crcUpdate(crc, value);
      await this.out.write(value);
      this.pos += value.length;
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    // Fill in the CRC, then carry on from the end.
    await this.out.write({ type: "write", position: at + 14, data: le32(crc) });
    await this.out.write({ type: "seek", position: this.pos });

    const big = at >= LIMIT;
    this.central.push(concat([
      le32(0x02014b50), le16(20), le16(big ? 45 : 20), le16(0x0800), le16(0), le16(this.stamp.time), le16(this.stamp.date),
      le32(crc), le32(size), le32(size), le16(name.length), le16(big ? 12 : 0), le16(0), le16(0), le16(0), le32(0),
      le32(big ? MAX32 : at), name,
      ...(big ? [le16(0x0001), le16(8), le64(at)] : []),
    ]));
    this.count++;
  }

  async finish() {
    const cdStart = this.pos;
    for (const c of this.central) { await this.out.write(c); this.pos += c.length; }
    const cdSize = this.pos - cdStart;
    const zip64 = cdStart >= LIMIT || cdSize >= LIMIT || this.count >= 0xffff;
    if (zip64) {
      const recAt = this.pos;
      const rec = concat([
        le32(0x06064b50), le64(44), le16(45), le16(45), le32(0), le32(0),
        le64(this.count), le64(this.count), le64(cdSize), le64(cdStart),
      ]);
      const loc = concat([le32(0x07064b50), le32(0), le64(recAt), le32(1)]);
      await this.out.write(concat([rec, loc]));
      this.pos += rec.length + loc.length;
    }
    const n16 = zip64 ? 0xffff : this.count;
    await this.out.write(concat([
      le32(0x06054b50), le16(0), le16(0), le16(n16), le16(n16),
      le32(zip64 ? MAX32 : cdSize), le32(zip64 ? MAX32 : cdStart), le16(0),
    ]));
    await this.out.close();
  }
}

// Ask where to save the zip. null if the browser can't save straight to
// disk (Firefox, Safari, phones) or the person cancelled.
export async function pickZipFile(suggested: string): Promise<Writable | "unsupported" | null> {
  const picker = (window as unknown as { showSaveFilePicker?: (o: object) => Promise<{ createWritable: () => Promise<unknown> }> }).showSaveFilePicker;
  if (!picker) return "unsupported";
  try {
    const handle = await picker({ suggestedName: suggested, types: [{ description: "Zip file", accept: { "application/zip": [".zip"] } }] });
    return (await handle.createWritable()) as Writable;
  } catch {
    return null;
  }
}
