#!/usr/bin/env node
/**
 * Mint the three secrets a self-hosted stack needs.
 *
 *   node scripts/gen-keys.mjs        print them
 *   node scripts/gen-keys.mjs --env  print them as .env lines to paste
 *   node scripts/gen-keys.mjs --write .env   merge them INTO a file, in place
 *
 * WHY A SCRIPT RATHER THAN DEFAULTS IN THE COMPOSE FILE. Supabase's own
 * self-host guide ships a well-known demo JWT secret and the two keys signed
 * with it. Everyone copies them, nobody changes them, and the result is a
 * publicly documented service_role key on someone's open port — a key that
 * bypasses RLS on every table. Thirty lines of HMAC here is cheaper than that
 * being anyone's default.
 *
 * The keys are ordinary HS256 JWTs, which is exactly what PostgREST and
 * storage-api expect: PostgREST reads `role` from the payload and switches to
 * that Postgres role, so `anon` and `service_role` are not credentials the app
 * looks up — they ARE the claim.
 *
 * No dependencies. Node's crypto does all of it.
 */

import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const b64u = (b) => Buffer.from(b).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function jwt(payload, secret) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const mac = b64u(crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest());
  return `${head}.${body}.${mac}`;
}

// PostgREST requires at least 32 bytes for HS256 and refuses to start below it.
const jwtSecret = crypto.randomBytes(48).toString('base64url');
const now = Math.floor(Date.now() / 1000);
// Ten years. These are infrastructure credentials rotated by regenerating them,
// not sessions — an expiry that quietly breaks a running instance in a year
// helps nobody.
const exp = now + 60 * 60 * 24 * 365 * 10;

const anon = jwt({ role: 'anon', iss: 'runbutter', iat: now, exp }, jwtSecret);
const service = jwt({ role: 'service_role', iss: 'runbutter', iat: now, exp }, jwtSecret);
// Seals BYO AI keys and social tokens at rest (lib/crypto/secrets.ts). Separate
// from the JWT secret on purpose: rotating one must not silently make every
// stored credential undecryptable.
const master = crypto.randomBytes(32).toString('base64');
const cron = crypto.randomBytes(24).toString('base64url');

// ── --write <file>: merge into an existing .env, in place ───────────────────
// `--env >> .env` was the documented flow and it APPENDS. Every one of these
// keys already exists (empty) in .env.docker.example, so the result had each of
// them twice. dotenv and Docker Compose both take the last value, so it worked
// — right up until someone edited the first one, the one with the explanatory
// comment above it, and watched their change be ignored. Merging writes each
// key exactly once, in the place the comments describe.
const writeIdx = process.argv.indexOf('--write');
if (writeIdx !== -1) {
  const file = process.argv[writeIdx + 1];
  if (!file) { console.error('--write needs a path, e.g. --write .env'); process.exit(1); }

  const pairs = {
    JWT_SECRET: jwtSecret, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_KEY: service,
    SECRETS_MASTER_KEY: master, CRON_SECRET: cron,
  };
  let text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const kept = [];
  for (const [k, v] of Object.entries(pairs)) {
    // Only ever replaces a key that is EMPTY or absent. A file that already has
    // real secrets in it must not be silently reissued — that would invalidate
    // every session and orphan everything sealed with the old master key.
    const re = new RegExp(`^${k}=(.*)$`, 'm');
    const m = text.match(re);
    if (m && m[1].trim()) { kept.push(k); continue; }
    if (m) text = text.replace(re, `${k}=${v}`);
    else text += (text.endsWith('\n') || !text ? '' : '\n') + `${k}=${v}\n`;
  }
  writeFileSync(file, text);
  console.log(`✓ ${file} — ${Object.keys(pairs).length - kept.length} key(s) generated`);
  if (kept.length) console.log(`  kept the values already set: ${kept.join(', ')}`);
  process.exit(0);
}

if (process.argv.includes('--env')) {
  console.log(`JWT_SECRET=${jwtSecret}`);
  console.log(`SUPABASE_ANON_KEY=${anon}`);
  console.log(`SUPABASE_SERVICE_KEY=${service}`);
  console.log(`SECRETS_MASTER_KEY=${master}`);
  console.log(`CRON_SECRET=${cron}`);
} else {
  console.log(`
Paste these into your .env:

  JWT_SECRET=${jwtSecret}
  SUPABASE_ANON_KEY=${anon}
  SUPABASE_SERVICE_KEY=${service}
  SECRETS_MASTER_KEY=${master}
  CRON_SECRET=${cron}

  Or, merged into an existing file:  node scripts/gen-keys.mjs --write .env

SUPABASE_SERVICE_KEY bypasses row-level security on every table. It belongs in
the server environment and nowhere else — never in a browser, never in a repo.
`);
}
