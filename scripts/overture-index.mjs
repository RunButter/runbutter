#!/usr/bin/env node
/**
 * Writes public/overture/places-index.json — the copy of the Overture places
 * index shipped with the app (see lib/leads/overture.ts, PackedIndex).
 *
 * A browser asks the server for the index first; this file is what it gets
 * when the server cannot answer, so Find leads keeps working through a server
 * that cannot reach S3. Re-run monthly after an Overture release (the newest
 * is picked unless a release is given):
 *
 *   npm run overture:index            # newest release
 *   npm run overture:index 2026-09-23.1
 *
 * The format MUST match packIndex/unpackIndex in lib/leads/overture.ts.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asyncBufferFromUrl, parquetMetadataAsync } from 'hyparquet';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.OVERTURE_BASE_URL || 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com').replace(/\/$/, '');

async function list(prefix, delimiter = '') {
  const q = new URLSearchParams({ 'list-type': '2', prefix, ...(delimiter ? { delimiter } : {}) });
  const xml = await (await fetch(`${BASE}/?${q}`)).text();
  return {
    keys: [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]),
    prefixes: [...xml.matchAll(/<CommonPrefixes>\s*<Prefix>([^<]+)<\/Prefix>\s*<\/CommonPrefixes>/g)].map((m) => m[1]),
  };
}

const num = (v) => Number(v);
const stat = (rg, p) => rg.columns.find((c) => c.meta_data?.path_in_schema?.join('.') === p)?.meta_data?.statistics;

const release = process.argv[2] || (await list('release/', '/')).prefixes
  .map((p) => /^release\/([^/]+)\/$/.exec(p)?.[1]).filter((x) => x && /^\d{4}-\d{2}-\d{2}/.test(x)).sort().pop();
if (!release) { console.error('No Overture release found.'); process.exit(1); }

const files = (await list(`release/${release}/theme=places/type=place/`)).keys.filter((k) => k.endsWith('.parquet'));
if (!files.length) { console.error(`Release ${release} has no places files.`); process.exit(1); }

const lo = (x) => Math.floor(x * 1e4) / 1e4, hi = (x) => Math.ceil(x * 1e4) / 1e4;
const groups = [];
for (const [fi, key] of files.entries()) {
  const md = await parquetMetadataAsync(await asyncBufferFromUrl({ url: `${BASE}/${key}` }));
  let start = 0;
  md.row_groups.forEach((rg, i) => {
    const rows = num(rg.num_rows);
    const x0 = stat(rg, 'bbox.xmin'), x1 = stat(rg, 'bbox.xmax'), y0 = stat(rg, 'bbox.ymin'), y1 = stat(rg, 'bbox.ymax');
    groups.push([fi, i, start, start + rows,
      x0 ? lo(num(x0.min_value)) : -180, x1 ? hi(num(x1.max_value)) : 180,
      y0 ? lo(num(y0.min_value)) : -90, y1 ? hi(num(y1.max_value)) : 90]);
    start += rows;
  });
  process.stdout.write(`\r${fi + 1}/${files.length} files`);
}

const out = join(ROOT, 'public', 'overture', 'places-index.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ v: 1, release, files, groups }));
console.log(`\nWrote ${out}: release ${release}, ${files.length} files, ${groups.length} row groups.`);
