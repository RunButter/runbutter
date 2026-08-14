#!/usr/bin/env node
/**
 * Fail if any SECURITY DEFINER function is executable by `anon` or
 * `authenticated` without being on the public-surface allowlist.
 *
 * WHY THIS EXISTS. 0046 revoked those grants across the board. Every migration
 * written afterwards re-added them — `grant execute on function <name>(...) to
 * authenticated, anon` became the house style, and 0104 still ends that way.
 * By the time anyone measured, 69 DEFINER functions were anon-callable on
 * production, including the whole CRUD monolith and three helpers that take no
 * p_privy and authorize nothing at all. 0105 sweeps them; this stops it
 * happening a third time.
 *
 * DEFINER bypasses RLS and the anon key ships in the browser bundle, so an
 * anon-callable DEFINER function is reachable straight against PostgREST,
 * routing around /api/rpc — which is the only thing that verifies a Privy
 * token. That is why this is a CI gate rather than a lint.
 *
 * THE ALLOWLIST IS NOT DUPLICATED HERE. It is parsed out of the newest
 * revoke migration, because two copies of a security list drift and the copy
 * nobody remembers to update is always the one CI reads.
 *
 *   DATABASE_URL=postgres://… node scripts/check-grants.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

/** The allowlist, read from the highest-numbered migration that declares one. */
function keepPublic() {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    const m = sql.match(/keep_public\s+text\[\]\s*:=\s*array\s*\[([\s\S]*?)\]\s*;/);
    if (!m) continue;
    // Strip SQL line comments before pulling the quoted names out, or a name
    // mentioned in a comment would silently join the allowlist.
    const body = m[1].replace(/--[^\n]*/g, '');
    const names = [...body.matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
    if (names.length) return { file: f, names };
  }
  return { file: null, names: [] };
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('check-grants: DATABASE_URL is not set.');
  process.exit(2);
}

const { file, names } = keepPublic();
if (!file) {
  console.error('check-grants: no migration declares a keep_public allowlist — nothing to check against.');
  process.exit(2);
}

const client = new pg.Client({
  connectionString: url,
  ssl: /supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();
  const { rows } = await client.query(
    `select p.proname,
            pg_get_function_identity_arguments(p.oid) as args,
            has_function_privilege('anon', p.oid, 'execute')          as anon,
            has_function_privilege('authenticated', p.oid, 'execute') as authed
       from pg_proc p
       join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public'
        and p.prosecdef
        and not (p.proname = any($1::text[]))
        and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'))
      order by p.proname`,
    [names],
  );

  if (rows.length === 0) {
    console.log(`check-grants: OK — no SECURITY DEFINER function is reachable by anon/authenticated`);
    console.log(`              (allowlist: ${names.length} public surfaces, from ${file})`);
    process.exit(0);
  }

  console.error(`\ncheck-grants: ${rows.length} SECURITY DEFINER function(s) are reachable without the /api/rpc proxy:\n`);
  for (const r of rows) {
    const who = [r.anon && 'anon', r.authed && 'authenticated'].filter(Boolean).join(', ');
    console.error(`  ${r.proname}(${r.args})\n      granted to: ${who}`);
  }
  console.error(`
Fix one of two ways:

  • It is NOT a public surface (the usual case). In the migration that defines
    it, replace the grant with a revoke/grant PAIR:

        revoke all on function <name>(<args>) from public, anon, authenticated;
        grant execute on function <name>(<args>) to service_role;

    DELETING the "to authenticated, anon" line is not enough on its own.
    Postgres grants EXECUTE to PUBLIC on every new function and anon inherits
    through PUBLIC, so a function that grants nobody anything is still
    anon-callable. The revoke is the half that does the work. /api/rpc — the
    only caller that verifies a Privy token — connects as service_role and is
    unaffected.

  • It IS a public surface, called on the direct supabase client by someone with
    no Privy session. Add its name to keep_public in the newest revoke migration
    (${file}), with a comment saying which page calls it and what gates it.
`);
  process.exit(1);
} catch (err) {
  console.error(`check-grants: ${err.message}`);
  process.exit(2);
} finally {
  await client.end().catch(() => {});
}
