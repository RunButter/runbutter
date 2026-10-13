// The server's way to the Overture index (see lib/leads/overture.ts).
// Server-only: it touches the disk. Importing this file installs the loader.
//
//   1. the index of the newest release, cached on disk from an earlier build;
//   2. build it from S3 (~30 MB of footers, a few seconds) and cache it;
//   3. the copy shipped with the app (public/overture/places-index.json), if
//      S3 cannot be listed from here — searching still reads S3, but a server
//      that cannot list the bucket may still be able to read the files.
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  setIndexLoader, buildIndexFromS3, currentRelease, unpackIndex, packIndex, reasonOf, OvertureError,
  type OvertureIndex,
} from './overture';

const diskPath = (release: string) => join(tmpdir(), `runbutter-overture-places-${release.replace(/[^\w.-]/g, '')}.v1.json`);

async function fromDisk(release: string): Promise<OvertureIndex | null> {
  try { return unpackIndex(JSON.parse(await readFile(diskPath(release), 'utf8'))); }
  catch { return null; }
}

/** The copy committed with the app — always there, maybe a release behind. */
export async function shippedIndex(): Promise<OvertureIndex | null> {
  try { return unpackIndex(JSON.parse(await readFile(join(process.cwd(), 'public', 'overture', 'places-index.json'), 'utf8'))); }
  catch { return null; }
}

async function serverLoader(): Promise<OvertureIndex> {
  let why = '';
  try {
    const release = await currentRelease();
    const cached = await fromDisk(release);
    if (cached) return cached;
    const built = await buildIndexFromS3(release);
    writeFile(diskPath(release), JSON.stringify(packIndex(built))).catch(() => { /* read-only disk */ });
    return built;
  } catch (e) {
    why = reasonOf(e);
    console.error('leads/overture index', why);
  }
  const shipped = await shippedIndex();
  if (shipped) return shipped;
  throw new OvertureError(why || 'no index');
}

setIndexLoader(serverLoader);

export {};
