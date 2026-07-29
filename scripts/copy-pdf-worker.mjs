// Copy pdf.js's worker into public/ before dev and build.
//
// The obvious approach — `new URL('pdfjs-dist/build/pdf.worker.min.mjs',
// import.meta.url)` — does emit the asset, but Next then hands it to Terser as
// a plain script and the build dies on "'import', and 'export' cannot be used
// outside of module code", because the worker is an ES module.
//
// Serving it from public/ sidesteps the bundler entirely. Copying at build time
// rather than committing the file keeps it locked to whatever version of
// pdfjs-dist is actually installed — a stale committed worker against a bumped
// library is a genuinely horrible bug to track down.
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

try {
  const pkg = require.resolve('pdfjs-dist/package.json');
  const src = join(dirname(pkg), 'build', 'pdf.worker.min.mjs');
  if (!existsSync(src)) throw new Error(`worker not found at ${src}`);

  await mkdir('public', { recursive: true });
  await copyFile(src, join('public', 'pdf.worker.min.mjs'));
  console.log('pdf.js worker → public/pdf.worker.min.mjs');
} catch (err) {
  // Don't fail the build: every other page works without it, and the PDF
  // editor already degrades to "previews unavailable, editing still works".
  console.warn(`pdf worker copy skipped: ${err.message}`);
}
