/**
 * A minimal ZIP writer — store only, no compression.
 *
 * WHY NOT A DEPENDENCY. The whole payload is a handful of small text files; a
 * general-purpose archiver brings DEFLATE, streams, permissions and symlink
 * handling for none of it. This is the same call `lib/markdown.ts` made: a
 * bounded, well-specified format used for one purpose is cheaper to own than
 * to depend on. The ZIP APPNOTE calls this method 0, and every unzip
 * implementation in existence reads it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: Zip64, encryption, directory entries,
 * timestamps, or unicode path extras. Paths are ASCII by construction (skill
 * directory names are `[a-z0-9-]` per the Agent Skills rules) and the archives
 * are kilobytes. If any of those stops being true, take a dependency then —
 * do not grow this.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { path: string; content: string }

export function zipSync(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
  const cat = (parts: Uint8Array[]) => {
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };

  for (const e of entries) {
    const name = enc.encode(e.path);
    const data = enc.encode(e.content);
    const crc = crc32(data);

    // Local file header. Version 2.0, no flags, method 0 (store), and a fixed
    // MS-DOS date/time — a reproducible archive is worth more than an accurate
    // timestamp, because a byte-identical export is diffable and cacheable.
    const local = cat([
      u32(0x04034b50), u16(20), u16(0), u16(0),
      u16(0), u16(0x21),                       // 00:00:00, 1 Jan 1980
      u32(crc), u32(data.length), u32(data.length),
      u16(name.length), u16(0), name,
    ]);
    chunks.push(local, data);

    central.push(cat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0),
      u16(0), u16(0x21),
      u32(crc), u32(data.length), u32(data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0),                                   // external attrs: a plain file
      u32(offset), name,
    ]));
    offset += local.length + data.length;
  }

  const dir = cat(central);
  const end = cat([
    u32(0x06054b50), u16(0), u16(0),
    u16(entries.length), u16(entries.length),
    u32(dir.length), u32(offset), u16(0),
  ]);

  return cat([...chunks, dir, end]);
}
