#!/usr/bin/env node
// Rebuilds public/sheetcalc.wasm — GridCraft's formula engine for Docs sheets.
// See wasm/sheetcalc/README.md. Node, not bash: this repo is driven from PowerShell too.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const crate = join(root, 'wasm', 'sheetcalc');
const run = (args) => execFileSync('cargo', args, { cwd: crate, stdio: 'inherit' });

try { execFileSync('cargo', ['--version'], { stdio: 'ignore' }); }
catch { console.error('build:sheetcalc needs Rust (https://rustup.rs) and `rustup target add wasm32-unknown-unknown`.'); process.exit(1); }

run(['test', '--release']);
run(['build', '--release', '--target', 'wasm32-unknown-unknown']);

const built = join(crate, 'target', 'wasm32-unknown-unknown', 'release', 'rb_sheetcalc.wasm');
const out = join(root, 'public', 'sheetcalc.wasm');
copyFileSync(built, out);
const bytes = readFileSync(out);
const rev = /rev = "([0-9a-f]{40})"/.exec(readFileSync(join(crate, 'Cargo.toml'), 'utf8'))?.[1] || null;
const meta = { gridcraft: rev, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
writeFileSync(join(root, 'lib', 'sheets', 'sheetcalc-meta.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`public/sheetcalc.wasm — ${(bytes.length / 1024).toFixed(0)} KB, sha256 ${meta.sha256.slice(0, 12)}…`);
