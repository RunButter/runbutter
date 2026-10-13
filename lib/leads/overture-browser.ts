'use client';

// The free lead search, run in the person's own browser.
//
// WHY THE BROWSER: the open data is files on a public S3 bucket that allows
// cross-origin reads (checked: Access-Control-Allow-Origin * for GET, HEAD and
// Range). Read from the browser, a search depends on nothing of ours — not the
// server's network (the OpenStreetMap servers refused our host's shared IPs),
// not its memory, not its region — and every person reads on their own
// connection. The server's /api/leads/search is the fallback, not the path.
//
// The one thing a browser should not do is build the index (~30 MB of
// footers), so it is fetched: from the server (a few hundred KB, cached), else
// from the copy shipped with the app, and built here only as the last resort.
import { setIndexLoader, unpackIndex, packIndex, buildIndexFromS3, type OvertureIndex } from './overture';
import { searchFree, type FreeSearchInput, type FreeSearchResult } from './free';

const LOCAL = 'rb-overture-index-v1';
const LOCAL_TTL_MS = 24 * 3600_000;

async function getJson(url: string, ms: number): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function browserLoader(): Promise<OvertureIndex> {
  try {
    const held = JSON.parse(localStorage.getItem(LOCAL) || 'null');
    if (held && Date.now() - held.at < LOCAL_TTL_MS) {
      const idx = unpackIndex(held.index);
      if (idx) return idx;
    }
  } catch { /* private mode or quota */ }

  let idx: OvertureIndex | null = null;
  for (const url of ['/api/leads/overture-index', '/overture/places-index.json']) {
    try { idx = unpackIndex(await getJson(url, 15_000)); } catch { idx = null; }
    if (idx) break;
  }
  if (!idx) idx = await buildIndexFromS3();
  try { localStorage.setItem(LOCAL, JSON.stringify({ at: Date.now(), index: packIndex(idx) })); } catch { /* quota */ }
  return idx;
}

setIndexLoader(browserLoader);

/** Forget the stored index — when a search finds that its files were retired. */
export function forgetStoredIndex() {
  try { localStorage.removeItem(LOCAL); } catch { /* ignore */ }
}

export function searchFreeHere(input: FreeSearchInput): Promise<FreeSearchResult> {
  return searchFree({ ...input, lang: input.lang || navigator.language?.slice(0, 2) || 'en' });
}
