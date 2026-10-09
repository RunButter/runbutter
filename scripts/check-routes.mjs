#!/usr/bin/env node
// Every screen in the menu answers — against a real production build.
//
// WHY THIS EXISTS. /insights was described in CLAUDE.md as shipped for two
// months and never committed: the engine was there, the page was not, nothing
// linked to it, and types, build and every other check passed. A menu entry
// pointing at a route that does not exist fails the same way — silently, as a
// 404 somebody clicks into. This starts the built app and requests every href
// in NAV (tabs included) plus the public pages, and fails on any 404 or 5xx.
//
// It sends a dummy `privy-token` cookie. The middleware only checks that the
// cookie is PRESENT before letting a request through to an app route, so without
// it every app route answers 307 → /auth/login and a missing page would hide
// behind the redirect. The pages themselves are client components that render a
// shell server-side; nothing here talks to a database.
//
// Usage: npm run build && npm run check:routes
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.CHECK_ROUTES_PORT || 3123);
const BASE = `http://127.0.0.1:${PORT}`;

const PUBLIC = [
  '/', '/developers', '/brand', '/plugins', '/ai-agents', '/pdf', '/qr',
  '/robots.txt', '/sitemap.xml', '/llms.txt', '/t.js', '/support.js',
];

function navRoutes() {
  const src = readFileSync(new URL('../lib/crm/registry.ts', import.meta.url), 'utf8');
  const start = src.indexOf('export const NAV');
  const end = src.indexOf('export function navTabsFor');
  if (start < 0 || end < 0) throw new Error('check-routes: could not find NAV in lib/crm/registry.ts');
  return [...src.slice(start, end).matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1].split('?')[0]);
}

async function waitUp(ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(`${BASE}/robots.txt`); if (r.status < 500) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('check-routes: the server did not start');
}

const routes = [...new Set([...navRoutes(), ...PUBLIC])];
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {
  stdio: ['ignore', 'ignore', 'inherit'], env: process.env,
});

let failed = 0;
try {
  await waitUp();
  for (const path of routes) {
    const res = await fetch(BASE + path, { redirect: 'manual', headers: { cookie: 'privy-token=check-routes' } });
    const ok = res.status < 400;
    if (!ok) failed++;
    console.log(`${ok ? '  ✓' : '  ✗'} ${res.status} ${path}`);
  }
} catch (e) {
  console.error(e.message);
  failed++;
} finally {
  server.kill('SIGTERM');
}

if (failed) {
  console.error(`\ncheck-routes: ${failed} route(s) did not answer. A menu entry that 404s is a broken product, not a missing feature.`);
  process.exit(1);
}
console.log(`\ncheck-routes: OK — ${routes.length} routes answer.`);
