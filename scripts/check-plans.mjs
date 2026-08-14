#!/usr/bin/env node
/**
 * Fail if the plan limits in the database disagree with lib/plans.ts.
 *
 * WHY THIS EXISTS. The numbers have to live in two places and neither one is
 * optional: SQL enforces them (0108), and lib/plans.ts renders them on the
 * pricing page, the billing screen and /llms.txt. Two copies of a number a
 * human maintains is precisely how the plan matrix in CLAUDE.md ended up a
 * whole business model behind reality — it still described Starter $99 and
 * Professional $299 long after neither existed.
 *
 * So: two copies, and a gate that makes disagreement impossible to merge. Same
 * shape as check:grants — the check reads BOTH sources rather than keeping a
 * third.
 *
 * The failure this prevents is not cosmetic. If plans.ts says Team gets 25,000
 * records and plan_limits says 2,500, the pricing page sells one thing and the
 * product enforces another, and the first person to find out is a paying
 * customer hitting a wall they were told they had not reached.
 *
 *   DATABASE_URL=postgres://… node scripts/check-plans.mjs
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Read the limits out of lib/plans.ts without importing it — it is TypeScript,
 * and a build step here would mean this gate breaks whenever the bundler does.
 * The file is repo-owned and reviewed, so parsing it is the cheap correct move
 * (`lib/markdown.ts` makes the same call for the same reason).
 */
function limitsFromTs() {
  const src = readFileSync(join(ROOT, 'lib', 'plans.ts'), 'utf8');
  const out = {};
  // Each plan block: `free: {` … `limits: { … }`
  const planRe = /(\w+):\s*\{[^]*?limits:\s*\{([^}]*)\}/g;
  let m;
  while ((m = planRe.exec(src))) {
    const plan = m[1];
    if (!['free', 'team', 'business', 'enterprise'].includes(plan)) continue;
    const body = m[2];
    const num = (key) => {
      const k = new RegExp(`${key}\\s*:\\s*(Infinity|\\d+)`).exec(body);
      if (!k) return null;
      return k[1] === 'Infinity' ? -1 : Number(k[1]);
    };
    out[plan] = {
      max_seats: num('maxSeats'),
      max_records: num('maxRecords'),
      max_positions: num('maxPositions'),
      max_candidates: num('maxCandidates'),
      max_automations: num('maxAutomations'),
      max_esign_per_month: num('maxESignPerMonth'),
    };
  }
  return out;
}

const url = process.env.DATABASE_URL;
if (!url) { console.error('check-plans: DATABASE_URL is not set.'); process.exit(2); }

const ts = limitsFromTs();
const plans = Object.keys(ts);
if (plans.length !== 4) {
  console.error(`check-plans: parsed ${plans.length} plans from lib/plans.ts, expected 4 (free, team, business, enterprise).`);
  process.exit(2);
}

const client = new pg.Client({
  connectionString: url,
  ssl: /supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();
  const { rows } = await client.query('select * from plan_limits');
  const db = Object.fromEntries(rows.map((r) => [r.plan, r]));

  const problems = [];
  for (const plan of plans) {
    if (!db[plan]) { problems.push(`${plan}: missing from plan_limits`); continue; }
    for (const [key, expected] of Object.entries(ts[plan])) {
      if (expected === null) { problems.push(`${plan}.${key}: could not be read from lib/plans.ts`); continue; }
      const actual = Number(db[plan][key]);
      if (actual !== expected) {
        const show = (n) => (n === -1 ? 'unlimited' : String(n));
        problems.push(`${plan}.${key}: lib/plans.ts says ${show(expected)}, plan_limits says ${show(actual)}`);
      }
    }
  }
  for (const plan of Object.keys(db)) {
    if (!plans.includes(plan)) problems.push(`${plan}: in plan_limits but not in lib/plans.ts`);
  }

  if (problems.length === 0) {
    console.log(`check-plans: OK — lib/plans.ts and plan_limits agree on all ${plans.length} plans`);
    process.exit(0);
  }

  console.error('\ncheck-plans: the pricing page and the database disagree:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(`
Fix whichever is wrong, in BOTH places:

  • lib/plans.ts  — what the pricing page, billing screen and /llms.txt show.
  • the plan_limits seed in the newest migration that writes it — what
    create_record and import_records actually enforce.

Shipping them apart means selling one number and enforcing another, and the
first person to notice is a paying customer hitting a wall they were told they
had not reached.
`);
  process.exit(1);
} catch (err) {
  console.error(`check-plans: ${err.message}`);
  process.exit(2);
} finally {
  await client.end().catch(() => {});
}
