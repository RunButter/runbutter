/**
 * A minimal ZIP reader, to match the writer in `zip.ts`.
 *
 * WHY NOT A DEPENDENCY, again. The writer makes the same argument and the same
 * one holds here: this reads a handful of small text files out of an archive
 * somebody exported from a skills repo. A general-purpose library brings
 * encryption, Zip64, symlinks and streaming for none of it.
 *
 * WHAT IS DIFFERENT FROM THE WRITER. We control what we emit (store only), but
 * we do NOT control what we read: anything produced by `git archive`, GitHub's
 * "Download ZIP", macOS Finder or 7-Zip is DEFLATE-compressed. So this handles
 * method 8 as well as method 0 — via the platform's own `DecompressionStream`,
 * which every current browser has and which costs nothing to ship.
 *
 * IT READS THE CENTRAL DIRECTORY, not the stream of local headers. Local
 * headers are allowed to carry zeroes for the sizes and defer them to a data
 * descriptor after the payload, which is exactly what a streaming writer emits;
 * parsing forwards from the front therefore works on our own archives and fails
 * on half the ones people will actually drop in. The central directory at the
 * end is authoritative in every case.
 *
 * SECURITY. Entry names are returned as stored, and the caller is responsible
 * for treating them as untrusted (`resourcePath` in agent-plugin.ts is what
 * sanitises them). A zip is allowed to contain `../../etc/passwd`, and nothing
 * here should quietly decide what that means.
 */

export interface ZipRead { path: string; content: string }

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

/** Locate the End Of Central Directory record, scanning back from the tail. */
function findEocd(view: DataView): number {
  // The EOCD is 22 bytes plus a comment of up to 65535, so it lives in the last
  // ~64KB. Scanning the whole file backwards would also work and would be
  // slower on a large archive for no benefit.
  const max = Math.min(view.byteLength, 22 + 0xffff);
  for (let i = 22; i <= max; i++) {
    const at = view.byteLength - i;
    if (at < 0) break;
    if (u32(view, at) === 0x06054b50) return at;
  }
  return -1;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  // `deflate-raw` (no zlib header) is what ZIP method 8 stores.
  const ds = new DecompressionStream('deflate-raw');
  const ab = bytes.slice().buffer as ArrayBuffer;
  const stream = new Blob([ab]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read every file entry. Directory entries and anything that does not decode as
 * text are skipped rather than surfaced — a plugin is text, and handing the
 * caller a mojibake string for a bundled PNG would be worse than omitting it.
 */
export async function unzip(data: ArrayBuffer): Promise<ZipRead[]> {
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error('Not a ZIP file, or it is truncated.');

  const count = u16(view, eocd + 10);
  let at = u32(view, eocd + 16);          // offset of the central directory
  const out: ZipRead[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: false });

  for (let i = 0; i < count; i++) {
    if (at + 46 > view.byteLength || u32(view, at) !== 0x02014b50) break;

    const method = u16(view, at + 10);
    const compressedSize = u32(view, at + 20);
    const nameLen = u16(view, at + 28);
    const extraLen = u16(view, at + 30);
    const commentLen = u16(view, at + 32);
    const localAt = u32(view, at + 42);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;

    if (!name || name.endsWith('/')) continue;          // a directory entry

    // The local header's own name/extra lengths decide where the payload
    // starts, and they are NOT required to match the central directory's.
    if (localAt + 30 > view.byteLength || u32(view, localAt) !== 0x04034b50) continue;
    const lNameLen = u16(view, localAt + 26);
    const lExtraLen = u16(view, localAt + 28);
    const start = localAt + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + compressedSize);

    let content: Uint8Array;
    if (method === 0) content = raw;
    else if (method === 8) {
      try { content = await inflateRaw(raw); } catch { continue; }
    } else continue;                                     // bzip2, lzma, encrypted

    const text = decoder.decode(content);
    // A NUL byte means this was not text. Skip it rather than pretend.
    if (text.includes('\u0000')) continue;
    out.push({ path: name, content: text });
  }

  return out;
}
