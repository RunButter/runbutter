#!/usr/bin/env node
/**
 * Does the migrate image actually contain everything migrate.mjs imports?
 *
 *   npm run check:docker
 *
 * WHY THIS EXISTS. `docker/migrate.Dockerfile` copied `scripts/migrate.mjs` and
 * not `scripts/lib/`, which that file imports. The container therefore failed on
 * its very first import, the migrate service exited 1, every service waiting on
 * it never started, and `docker compose up` died before the app was reached.
 *
 * It was invisible everywhere except in a container: `npm run migrate` runs in
 * the full repository, where the missing file is simply there. The bug survived
 * being written, documented, reviewed and shipped, and was found only when CI
 * booted the stack for the first time.
 *
 * The general shape — an image that copies a subset of a working tree, and a
 * script whose imports quietly leave that subset — will recur the moment anyone
 * adds an import to migrate.mjs. So it is checked rather than remembered.
 *
 * Deliberately static: it reads the COPY lines and follows the import graph.
 * No Docker daemon, so it runs in any sandbox and takes milliseconds.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';

const DOCKERFILE = 'docker/migrate.Dockerfile';
const ENTRY = 'scripts/migrate.mjs';

let problems = 0;
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); problems++; };
const good = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);

// ── What the image contains ─────────────────────────────────────────────────
// Only the source side of each COPY matters; where it lands is the Dockerfile's
// business. `--from=` lines are skipped: those copy build output, not repo files.
const copied = [];
for (const line of readFileSync(DOCKERFILE, 'utf8').split('\n')) {
  const m = line.match(/^\s*COPY\s+(.+)$/i);
  if (!m || /--from=/.test(m[1])) continue;
  const parts = m[1].trim().split(/\s+/).filter((p) => !p.startsWith('--'));
  // The last token is the destination.
  for (const src of parts.slice(0, -1)) copied.push(normalize(src));
}

const isCopied = (file) => {
  const rel = normalize(relative(process.cwd(), resolve(file)));
  return copied.some((c) => rel === c || rel.startsWith(c.replace(/\/$/, '') + '/'));
};

console.log(`${DOCKERFILE} copies: ${copied.join(', ')}\n`);

// ── What the entrypoint reaches ─────────────────────────────────────────────
// Relative specifiers only. A bare specifier is a package, which `npm install`
// in the image resolves — that is a different question from file layout.
const seen = new Set();
const missing = [];

function walk(file) {
  const abs = resolve(file);
  if (seen.has(abs)) return;
  seen.add(abs);

  if (!existsSync(abs) || !statSync(abs).isFile()) { missing.push([file, 'does not exist in the repo']); return; }
  if (!isCopied(abs)) missing.push([relative(process.cwd(), abs), 'is NOT copied into the image']);

  const src = readFileSync(abs, 'utf8');
  for (const m of src.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]|\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    walk(join(dirname(abs), m[1] || m[2]));
  }
}

walk(ENTRY);

console.log(`${ENTRY} reaches ${seen.size} repo file(s):`);
for (const abs of seen) {
  const rel = relative(process.cwd(), abs);
  const problem = missing.find(([f]) => f === rel);
  problem ? bad(`${rel} — ${problem[1]}`) : good(rel);
}

if (problems) {
  console.log(`\n\x1b[31m${problems} file(s) the image needs and does not have.\x1b[0m`);
  console.log(`Add them to ${DOCKERFILE}, or the migrate service exits 1 and takes the whole stack with it.`);
}
process.exit(problems ? 1 : 0);
