#!/usr/bin/env node
/**
 * Mint the three secrets a self-hosted stack needs.
 *
 *   node scripts/gen-keys.mjs        print them
 *   node scripts/gen-keys.mjs --env  print them as .env lines to paste
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

  Or: node scripts/gen-keys.mjs --env >> .env

SUPABASE_SERVICE_KEY bypasses row-level security on every table. It belongs in
the server environment and nowhere else — never in a browser, never in a repo.
`);
}
