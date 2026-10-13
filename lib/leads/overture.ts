// Overture Maps Places — the free source that works.
//
// Overture Maps Foundation (Amazon, Meta, Microsoft, TomTom and others)
// publishes ~70 million businesses worldwide as open data, refreshed monthly,
// under CDLA-Permissive-2.0: free, no key, and storable with attribution. Most
// of it comes from Meta's and Microsoft's business listings, so it carries what
// a lead needs — phone, website, email, Facebook page — far more often than
// volunteer-mapped OpenStreetMap: in the 2026-09 release, Kraków's 280
// dentists had a phone on 274, a website on 247 and an email on 218.
//
// It is published as GeoParquet on a public S3 bucket. There is no query API
// to be throttled by, which is what broke the OpenStreetMap servers for us:
// this reads the files directly with HTTP range requests, and S3 does not
// ration anybody by IP.
//
// ── READING 11 GB TO ANSWER ONE QUESTION, WITHOUT READING 11 GB ─────────────
// The places are ~16 files of ~700 MB, each split into ~256 row groups of
// ~20,000 places, sorted spatially, and every row group's footer carries the
// min/max of each place's bounding box. So:
//   1. once per process (and per monthly release), read every file's footer
//      and keep only a tiny index — which rows of which file cover which box;
//   2. per search, read just the row groups whose box meets the area (Kraków:
//      5 of ~4,000; New York: 37), first only the cheap columns (box, taxonomy,
//      status, confidence) to find the matches,
//   3. then the full row for the best matches only.
// MEMORY is the constraint, not time. A parsed footer is ~17 MB of objects, and
// one row group read as whole rows is ~200 MB (names carry every translation,
// addresses and sources are lists) — the first prototype peaked at 3.5 GB. So:
// footers are parsed one or two at a time and only their box statistics kept;
// rows are read ONE COLUMN AT A TIME and only the matching rows' values kept;
// and the detail columns are read only for the row groups holding the results
// shown. Peak stays near one column of one row group (~60 MB).
//
// hyparquet (MIT, pure JS, no native code) does the Parquet work. DuckDB was
// the obvious alternative and was not taken: reading S3 needs its httpfs
// extension, downloaded at run time from extensions.duckdb.org — a second
// network dependency, 70 MB of native binaries, and nothing to test it with.
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects, type FileMetaData, type AsyncBuffer } from 'hyparquet';
import { decompress as zstd } from 'fzstd';
import { cleanEmail, cleanPhone, cleanWebsite, type FoundPlace } from './osm';
import { OVERTURE_SEGMENTS } from './categories';

const BASE = (process.env.OVERTURE_BASE_URL || 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com').replace(/\/$/, '');
/** Pin a release ("2026-09-23.1"); otherwise the newest is found and re-checked daily. */
const PINNED = (process.env.OVERTURE_RELEASE || '').trim();

// Overture writes ZSTD. fzstd (MIT, pure JS) is the one decompressor needed;
// hyparquet decodes snappy itself, and nothing here loads WebAssembly.
const compressors = { ZSTD: (input: Uint8Array) => zstd(input) };

const INDEX_TTL_MS = 24 * 3600_000;
/** More row groups than this is a region, not a place to prospect. New York is 37. */
const MAX_GROUPS = 80;
/** Places below this confidence are mostly stale or duplicate listings. */
const MIN_CONFIDENCE = 0.4;
/** Row groups scanned at once. Each holds one column of ~20,000 places while it is read. */
const SCAN_CONCURRENCY = 2;
/** What a lead needs that the scan did not already read. */
const DETAIL = ['id', 'names', 'websites', 'phones', 'emails', 'socials', 'addresses'];

export class OvertureError extends Error {}
/** The person's answer to fix, not an outage: said as is, never fallen back from. */
export class OvertureAreaTooBig extends OvertureError {}

export interface Box { w: number; s: number; e: number; n: number }

export interface Group { key: string; rg: number; rowStart: number; rowEnd: number; x0: number; x1: number; y0: number; y1: number }
export interface OvertureIndex { release: string; groups: Group[] }

let index: (OvertureIndex & { at: number }) | null = null;
let building: Promise<OvertureIndex> | null = null;

/**
 * Where the index comes from, set by whoever runs this file. The server reads
 * it from disk or builds it from S3 (lib/leads/overture-server.ts); a browser
 * asks the server, then a copy shipped with the app, and builds it only as a
 * last resort (lib/leads/overture-browser.ts) — building means ~30 MB of
 * footers, which is fine once on a server and too much for every phone.
 */
let loader: () => Promise<OvertureIndex> = () => buildIndexFromS3();
export function setIndexLoader(fn: () => Promise<OvertureIndex>) { loader = fn; index = null; }
/** Drop the held index — after the store says a file of it is gone (a release was retired). */
export function forgetIndex() { index = null; }

const onServer = typeof window === 'undefined';

/**
 * fetch for the open data. Two guards that matter more than they look:
 *  - a byte-RANGE request answered 200 instead of 206 means the whole 700 MB
 *    file is on its way; hyparquet would buffer all of it. Refused instead.
 *  - every request gets its own timeout, and on the server opts out of Next's
 *    fetch cache (a range read is not something to store).
 */
export const dataFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  const ranged = headers.has('Range');
  const res = await fetch(input, {
    ...init,
    headers,
    signal: init?.signal ?? AbortSignal.timeout(30_000),
    ...(onServer ? { cache: 'no-store' as RequestCache } : {}),
  });
  if (ranged && res.status === 200) {
    res.body?.cancel().catch(() => {});
    throw new OvertureError('the data store ignored a partial read');
  }
  if (res.status === 404 || res.status === 403) forgetIndex();
  return res;
};

async function s3List(prefix: string, delimiter = ''): Promise<{ keys: string[]; prefixes: string[] }> {
  const keys: string[] = [], prefixes: string[] = [];
  let token = '';
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ 'list-type': '2', prefix, ...(delimiter ? { delimiter } : {}), ...(token ? { 'continuation-token': token } : {}) });
    const res = await dataFetch(`${BASE}/?${q}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new OvertureError(`the data store answered HTTP ${res.status}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
    for (const m of xml.matchAll(/<CommonPrefixes>\s*<Prefix>([^<]+)<\/Prefix>\s*<\/CommonPrefixes>/g)) prefixes.push(m[1]);
    const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !next) break;
    token = next[1];
  }
  return { keys, prefixes };
}

/** "release/2026-09-23.1/" → "2026-09-23.1", newest first by name (they are dates). */
export function newestRelease(prefixes: string[]): string | null {
  const names = prefixes.map((p) => /^release\/([^/]+)\/$/.exec(p)?.[1]).filter((x): x is string => !!x && /^\d{4}-\d{2}-\d{2}/.test(x));
  return names.sort().pop() ?? null;
}

/** The release to use: the pinned one, else the newest on S3. */
export async function currentRelease(): Promise<string> {
  if (PINNED) return PINNED;
  const r = newestRelease((await s3List('release/', '/')).prefixes);
  if (!r) throw new OvertureError('no release was found in the data store');
  return r;
}

const num = (v: unknown) => (typeof v === 'bigint' ? Number(v) : Number(v));
function statOf(rg: any, path: string): { min: number; max: number } | null {
  const c = rg.columns?.find((x: any) => x.meta_data?.path_in_schema?.join('.') === path);
  const st = c?.meta_data?.statistics;
  if (!st || st.min_value === undefined || st.max_value === undefined) return null;
  return { min: num(st.min_value), max: num(st.max_value) };
}

/** A file footer as index rows: which rows cover which box. */
export function groupsOf(key: string, md: Pick<FileMetaData, 'row_groups'>): Group[] {
  const out: Group[] = [];
  let start = 0;
  md.row_groups.forEach((rg: any, i: number) => {
    const rows = num(rg.num_rows);
    const x0 = statOf(rg, 'bbox.xmin'), x1 = statOf(rg, 'bbox.xmax'), y0 = statOf(rg, 'bbox.ymin'), y1 = statOf(rg, 'bbox.ymax');
    // A row group without statistics cannot be skipped safely, so it covers everything.
    out.push({ key, rg: i, rowStart: start, rowEnd: start + rows, x0: x0?.min ?? -180, x1: x1?.max ?? 180, y0: y0?.min ?? -90, y1: y1?.max ?? 90 });
    start += rows;
  });
  return out;
}

const fileUrl = (key: string) => `${BASE}/${key}`;
const openBuffer = (key: string) => asyncBufferFromUrl({ url: fileUrl(key), fetch: dataFetch });

/** Read every footer of a release (~30 MB) and keep only the boxes. */
export async function buildIndexFromS3(release?: string): Promise<OvertureIndex> {
  const rel = release || await currentRelease();
  const { keys } = await s3List(`release/${rel}/theme=places/type=place/`);
  const files = keys.filter((k) => k.endsWith('.parquet'));
  if (!files.length) throw new OvertureError(`release ${rel} has no places files`);
  const groups: Group[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (i < files.length) {
      const key = files[i++];
      // Parsed, reduced to its box statistics, and dropped — not cached.
      const md = await parquetMetadataAsync(await openBuffer(key));
      groups.push(...groupsOf(key, md));
    }
  }));
  return { release: rel, groups };
}

// ── The index on the wire: ~5,000 rows of numbers, ~100 KB gzipped ─────────

export interface PackedIndex { v: 1; release: string; files: string[]; groups: number[][] }

/** Boxes rounded OUTWARD to 1e-4°, so rounding can only include a row group, never wrongly skip one. */
export function packIndex(i: OvertureIndex): PackedIndex {
  const files = [...new Set(i.groups.map((g) => g.key))];
  const at = new Map(files.map((f, k) => [f, k]));
  const lo = (x: number) => Math.floor(x * 1e4) / 1e4, hi = (x: number) => Math.ceil(x * 1e4) / 1e4;
  return {
    v: 1, release: i.release, files,
    groups: i.groups.map((g) => [at.get(g.key)!, g.rg, g.rowStart, g.rowEnd, lo(g.x0), hi(g.x1), lo(g.y0), hi(g.y1)]),
  };
}

export function unpackIndex(p: any): OvertureIndex | null {
  if (!p || p.v !== 1 || typeof p.release !== 'string' || !Array.isArray(p.files) || !Array.isArray(p.groups)) return null;
  const groups: Group[] = [];
  for (const r of p.groups) {
    if (!Array.isArray(r) || r.length !== 8 || !r.every((x: unknown) => Number.isFinite(x))) return null;
    const key = p.files[r[0]];
    if (typeof key !== 'string' || !key.startsWith(`release/${p.release}/`)) return null;
    groups.push({ key, rg: r[1], rowStart: r[2], rowEnd: r[3], x0: r[4], x1: r[5], y0: r[6], y1: r[7] });
  }
  return groups.length ? { release: p.release, groups } : null;
}

async function getIndex(): Promise<OvertureIndex> {
  if (index && Date.now() - index.at < INDEX_TTL_MS) return index;
  if (!building) {
    building = loader()
      .then((x) => { index = { ...x, at: Date.now() }; return x; })
      .finally(() => { building = null; });
  }
  try { return await building; }
  catch (e) {
    // A stale index still answers; better than none while S3 hiccups.
    if (index) return index;
    throw e instanceof OvertureError ? e : new OvertureError(reasonOf(e));
  }
}

/** The index in its wire format, for /api/leads/overture-index. */
export async function packedIndex(): Promise<PackedIndex> {
  return packIndex(await getIndex());
}

/** Why something failed, in a few words a screenshot can carry. */
export function reasonOf(e: unknown): string {
  const err = e as any;
  if (err instanceof OvertureError) return err.message;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'no answer in time';
  const code = err?.cause?.code || err?.code;
  return String(code ? `${err?.message || 'error'} (${code})` : err?.message || err || 'unknown error').slice(0, 160);
}

// Two parsed footers at most — each is ~17 MB of objects.
const footers = new Map<string, { file: AsyncBuffer; md: FileMetaData }>();
async function open(key: string): Promise<{ file: AsyncBuffer; md: FileMetaData }> {
  const hit = footers.get(key);
  if (hit) { footers.delete(key); footers.set(key, hit); return hit; }
  const file = await openBuffer(key);
  const md = await parquetMetadataAsync(file);
  footers.set(key, { file, md });
  while (footers.size > 2) footers.delete(footers.keys().next().value as string);
  return { file, md };
}

// ── Matching ─────────────────────────────────────────────────────────────────

const STOP = new Set(['the', 'and', 'for', 'with', 'near', 'shop', 'store', 'service', 'services', 'company', 'local', 'best']);
/** "photographers" → "photograph", "plumber" → "plumb", "dentist" → "dent". Crude on purpose: it only has to meet the taxonomy halfway. */
export const stem = (w: string) => w.replace(/(ers|er|ing|ists|ist|ies|es|s|y)$/, '').slice(0, 12);
const fold = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const wordsOf = (t: string) => fold(t).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * How well a place's categories match: 0 = not at all. `cats` is its taxonomy
 * hierarchy plus its alternate categories (an electrician that also lists
 * solar_installation counts for "solar installer").
 */
export type Matcher = (cats: string[]) => number;

/** A built-in category: any of the place's categories is one of the category's. */
export function categoryMatcher(category: string): Matcher | null {
  const segs = OVERTURE_SEGMENTS[category];
  if (!segs) return null;
  const set = new Set(segs);
  return (cats) => (cats.some((x) => set.has(x)) ? 1 : 0);
}

/**
 * Free text. The LAST word is the head noun in English ("solar panel
 * INSTALLER", "wedding PHOTOGRAPHER") and must start a word of one of the
 * place's categories; every other word that also does adds to the score, and
 * only the best-scoring places are kept — which is what stops "solar
 * installer" returning installment-loan offices.
 */
export function textMatcher(text: string): Matcher | null {
  const stems = [...new Set(wordsOf(text).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem).filter((w) => w.length >= 3))];
  if (!stems.length) return null;
  const head = stems[stems.length - 1];
  return (cats) => {
    const words = cats.flatMap((c) => c.split('_'));
    const has = (s: string) => words.some((w) => w.startsWith(s));
    if (!has(head)) return 0;
    return 1 + stems.filter((s) => s !== head && has(s)).length;
  };
}

// ── Rows to leads ───────────────────────────────────────────────────────────

const first = (v: unknown): string => (Array.isArray(v) ? String(v.find((x) => x) ?? '') : '');
const social = (list: unknown, host: RegExp) => (Array.isArray(list) ? String(list.find((u) => host.test(String(u))) ?? '') : '');

/** Turn an Overture place (detail columns + what the scan kept) into the screen's lead row. */
export function overtureToFoundPlace(o: any, fallbackCategory = ''): FoundPlace | null {
  const name = String(o?.names?.primary || '').trim();
  const id = String(o?.id || '');
  if (!name || !id) return null;
  const a = Array.isArray(o?.addresses) ? o.addresses[0] || {} : {};
  const b = o?.bbox || {};
  const lat = (num(b.ymin) + num(b.ymax)) / 2, lon = (num(b.xmin) + num(b.xmax)) / 2;
  const leaf = String(o?.taxonomy?.primary || '').replace(/_/g, ' ');
  const address = [a.freeform, [a.postcode, a.locality].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const emails = (Array.isArray(o?.emails) ? o.emails : []).map((e: unknown) => cleanEmail(String(e))).filter(Boolean);
  return {
    ref: `overture/${id}`,
    // One click to the same business on Google Maps, to check reviews and
    // photos before calling — a public link, no key, nothing stored there.
    url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, address || `${lat.toFixed(5)},${lon.toFixed(5)}`].join(', '))}`,
    name: name.slice(0, 200),
    category: (leaf ? leaf.replace(/^\w/, (c) => c.toUpperCase()) : fallbackCategory).slice(0, 80),
    address: address.slice(0, 300),
    city: String(a.locality || '').slice(0, 120),
    postcode: String(a.postcode || '').slice(0, 20),
    country: String(a.country || '').slice(0, 2).toUpperCase(),
    phone: cleanPhone(first(o?.phones)),
    email: emails[0] || '',
    website: cleanWebsite(first(o?.websites)),
    opening_hours: '',
    facebook: social(o?.socials, /facebook\.com\//i),
    instagram: social(o?.socials, /instagram\.com\//i),
    lat: Number.isFinite(lat) ? lat : 0,
    lon: Number.isFinite(lon) ? lon : 0,
  };
}

// ── Search ──────────────────────────────────────────────────────────────────

export interface OvertureSearch {
  box: Box;
  match: Matcher;
  /** Narrows by business name, like the open map's filter. */
  name?: string;
  limit?: number;
  fallbackCategory?: string;
}

export interface OvertureResult {
  results: FoundPlace[];
  /** Matches in the area, before the limit. */
  matched: number;
  release: string;
}

const meets = (g: Pick<Group, 'x0' | 'x1' | 'y0' | 'y1'>, b: Box) => !(g.x0 > b.e || g.x1 < b.w || g.y0 > b.n || g.y1 < b.s);

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** One column of rows [start, end) — the only shape this module reads rows in. */
async function column(file: AsyncBuffer, md: FileMetaData, name: string, start: number, end: number): Promise<any[]> {
  const rows = await parquetReadObjects({ file, metadata: md, columns: [name], rowStart: start, rowEnd: end, compressors });
  return rows.map((r: any) => r[name]);
}

type Hit = { g: Group; row: number; conf: number; score: number; bbox: any; taxonomy: any };

/** Pass 1 over one row group: which of its places are in the box and match. */
async function scan(file: AsyncBuffer, md: FileMetaData, g: Group, q: OvertureSearch, nameRx: string): Promise<Hit[]> {
  const { box } = q;
  const bbox = await column(file, md, 'bbox', g.rowStart, g.rowEnd);
  const inBox: number[] = [];
  bbox.forEach((b, k) => { if (b && num(b.xmin) <= box.e && num(b.xmax) >= box.w && num(b.ymin) <= box.n && num(b.ymax) >= box.s) inBox.push(k); });
  if (!inBox.length) return []; // the row group's box met the area; none of its places do
  const conf = await column(file, md, 'confidence', g.rowStart, g.rowEnd);
  const status = await column(file, md, 'operating_status', g.rowStart, g.rowEnd);
  const live = inBox.filter((k) => (Number(conf[k]) || 0) >= MIN_CONFIDENCE && (!status[k] || status[k] === 'open'));
  if (!live.length) return [];
  const tax = await column(file, md, 'taxonomy', g.rowStart, g.rowEnd);
  let hits: Hit[] = [];
  for (const k of live) {
    const t = tax[k];
    const cats: string[] = [
      ...(Array.isArray(t?.hierarchy) ? t.hierarchy : t?.primary ? [t.primary] : []),
      ...(Array.isArray(t?.alternates) ? t.alternates : []),
    ];
    const score = q.match(cats);
    if (score > 0) hits.push({ g, row: g.rowStart + k, conf: Number(conf[k]) || 0, score, bbox: bbox[k], taxonomy: { primary: t?.primary } });
  }
  if (nameRx && hits.length) {
    const names = await column(file, md, 'names', g.rowStart, g.rowEnd);
    hits = hits.filter((h) => fold(String(names[h.row - g.rowStart]?.primary || '')).includes(nameRx));
  }
  return hits;
}

export async function searchOverture(q: OvertureSearch): Promise<OvertureResult> {
  const idx = await getIndex();
  const groups = idx.groups.filter((g) => meets(g, q.box));
  if (groups.length > MAX_GROUPS) throw new OvertureAreaTooBig('That area is too big to search in one go. Pick a city or a district, or a distance from an address.');
  const limit = Math.min(1000, Math.max(1, q.limit ?? 400));
  const nameRx = fold((q.name || '').trim());

  const byFile = new Map<string, Group[]>();
  for (const g of groups) byFile.set(g.key, [...(byFile.get(g.key) || []), g]);

  // Pass 1: the cheap columns, one at a time, of every row group in the area.
  let hits: Hit[] = [];
  for (const [key, gs] of byFile) {
    const { file, md } = await open(key);
    await pool(gs, SCAN_CONCURRENCY, async (g) => { hits.push(...(await scan(file, md, g, q, nameRx))); });
  }
  // Free text: only the best-scoring tier (and the next, if the best is thin).
  const top = hits.reduce((m, h) => Math.max(m, h.score), 0);
  if (top > 1) {
    const best = hits.filter((h) => h.score === top);
    hits = best.length >= 20 ? best : hits.filter((h) => h.score >= top - 1);
  }
  const matched = hits.length;

  // Pass 2: detail columns for the results shown. When there are more matches
  // than the limit, the row groups with the most matches are read first —
  // fewer row groups is less memory and time, and the screen says how many
  // more there were.
  const perGroup = new Map<Group, Hit[]>();
  for (const h of hits) perGroup.set(h.g, [...(perGroup.get(h.g) || []), h]);
  const order = [...perGroup].sort((a, b) => b[1].length - a[1].length);
  const chosen: [Group, Hit[]][] = [];
  let taken = 0;
  for (const [g, hs] of order) {
    if (taken >= limit) break;
    const pick = hs.sort((a, b) => b.conf - a.conf).slice(0, limit - taken);
    chosen.push([g, pick]);
    taken += pick.length;
  }

  const out: FoundPlace[] = [];
  const seen = new Set<string>();
  for (const [key] of byFile) {
    const mine = chosen.filter(([g]) => g.key === key);
    if (!mine.length) continue;
    const { file, md } = await open(key);
    await pool(mine, SCAN_CONCURRENCY, async ([g, hs]) => {
      const lo = Math.min(...hs.map((h) => h.row)), hi = Math.max(...hs.map((h) => h.row)) + 1;
      const rows: Record<string, any>[] = hs.map((h) => ({ bbox: h.bbox, taxonomy: h.taxonomy }));
      for (const col of DETAIL) {
        const vals = await column(file, md, col, lo, hi);
        hs.forEach((h, i) => { rows[i][col] = vals[h.row - lo]; });
      }
      rows.forEach((o) => {
        const f = overtureToFoundPlace(o, q.fallbackCategory);
        if (f && !seen.has(f.ref)) { seen.add(f.ref); out.push(f); }
      });
    });
  }
  // The richest first: a lead with a phone and a website is the one to call.
  const rich = (p: FoundPlace) => (p.phone ? 2 : 0) + (p.website ? 2 : 0) + (p.email ? 3 : 0);
  out.sort((a, b) => rich(b) - rich(a) || a.name.localeCompare(b.name));
  return { results: out, matched, release: idx.release };
}

/** For tests and the health line: what the index holds. */
export async function overtureStatus(): Promise<{ release: string; groups: number }> {
  const i = await getIndex();
  return { release: i.release, groups: i.groups.length };
}
