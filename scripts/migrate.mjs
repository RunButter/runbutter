#!/usr/bin/env node
/**
 * Apply every RunButter migration, in order, once.
 *
 * WHY THIS EXISTS. Until now the only documented way to set up the database was
 * to paste 87 files into the Supabase SQL editor by hand, in the right order,
 * and remember which ones you had already done. That is fine for the person who
 * wrote them and impossible for anyone else — it is the single biggest thing
 * between this repo and someone actually running it.
 *
 * Works against anything Postgres: a `docker compose up` container, a Supabase
 * project (use the SESSION pooler on 5432, not the transaction pooler on 6543 —
 * migrations need session state), or a local install.
 *
 *   node scripts/migrate.mjs                 # apply what is pending
 *   node scripts/migrate.mjs --status        # list without applying
 *   node scripts/migrate.mjs --dry-run       # show what would run
 *
 * ── THE TWO FOLDERS ─────────────────────────────────────────────────────────
 * supabase/legacy/ predates the numbered migrations and is NOT idempotent —
 * re-running one would re-open an RLS policy that 0077 deliberately closed. So
 * it runs only on a database that is genuinely empty, and is skipped forever
 * afterwards. supabase/migrations/ IS idempotent by convention, but is still
 * recorded so a re-run is fast and so `--status` can tell the truth.
 *
 * ── ONE TRANSACTION PER FILE ────────────────────────────────────────────────
 * A file either lands completely or not at all, and the ledger row is written
 * inside the same transaction. A half-applied migration that the ledger claims
 * is done is the one failure mode that leaves someone truly stuck.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const BOOTSTRAP = join(ROOT, 'supabase', 'bootstrap.sql');
const LEGACY = join(ROOT, 'supabase', 'legacy');

const args = new Set(process.argv.slice(2));
const STATUS_ONLY = args.has('--status');
const DRY_RUN = args.has('--dry-run');

// Colour only when someone is watching; CI logs should stay plain.
const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => c('2', s), green = (s) => c('32', s), red = (s) => c('31', s), yellow = (s) => c('33', s);

/**
 * The legacy files, in dependency order.
 *
 * Hardcoded rather than sorted, because these predate any naming convention and
 * alphabetical order is wrong: the schema has to exist before anything alters
 * it. This list is the only written record of that order.
 */
const LEGACY_ORDER = [
  'supabase-schema.sql',
  'migration.sql',
  'security-migration.sql',
  'screening-migration.sql',
  'neuro-profile-migration.sql',
  'fix-assessment-schema.sql',
  'fix-assessment-and-visibility.sql',
  'fix-company-branding-visibility.sql',
  'fix-logo-storage-rls.sql',
  'create-contact-table.sql',
  'add-gdpr.sql',
  'add-message-templates.sql',
  'add-my-team.sql',
  'add-resume-search.sql',
  'add-source-attribution.sql',
  'add-treasury-dataset.sql',
  'add-webhooks.sql',
];

function connectionString() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) return url;
  // Nudge rather than a bare failure: the two Supabase pooler ports are the
  // thing people get wrong, and the wrong one fails in a confusing way.
  console.error(red('No DATABASE_URL.'));
  console.error(`
Set it to your database, then run this again:

  ${dim('# local / docker')}
  DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres node scripts/migrate.mjs

  ${dim('# Supabase — Project settings → Database → Connection string → Session pooler')}
  ${dim('# NOTE: port 5432 (session), never 6543 (transaction) — migrations need session state')}
  DATABASE_URL='postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres' node scripts/migrate.mjs
`);
  process.exit(1);
}

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

async function main() {
  const client = new pg.Client({
    connectionString: connectionString(),
    // Supabase's pooler presents a certificate the default chain rejects.
    // Everything here runs over TLS to a host the operator named themselves.
    ssl: /supabase\.(com|co)/.test(process.env.DATABASE_URL || '') ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  await client.query(`
    create table if not exists schema_migrations (
      name        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now(),
      -- 'legacy' or 'migration'. Kept so --status can explain why a legacy file
      -- is being skipped rather than appearing mysteriously absent.
      kind        text not null default 'migration'
    );
  `);

  // Always first, always. It creates the roles, the auth schema and the storage
  // tables the very first legacy file references — and it is a guarded no-op
  // against a real Supabase project, so there is no branch to get wrong.
  if (existsSync(BOOTSTRAP) && !STATUS_ONLY && !DRY_RUN) {
    process.stdout.write(`${dim('→')} bootstrap.sql `);
    try {
      await client.query(readFileSync(BOOTSTRAP, 'utf8'));
      console.log(green('ok'));
    } catch (e) {
      console.log(red('failed'));
      console.error(`\n${red(e.message)}`);
      console.error(dim('This creates the roles and the auth/storage schemas. On a hosted Supabase\nproject it should be a no-op — if it failed there, something else is wrong.'));
      await client.end();
      process.exit(1);
    }
  }

  const applied = new Map(
    (await client.query('select name, checksum from schema_migrations')).rows.map((r) => [r.name, r.checksum]),
  );

  // A database is "fresh" if it has none of our tables. `workspaces` is the
  // root of the numbered migrations and `candidates` of the legacy schema —
  // either one means somebody has already set this up.
  const { rows: [{ fresh }] } = await client.query(`
    select not exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name in ('workspaces', 'candidates')
    ) as fresh
  `);

  const legacyFiles = existsSync(LEGACY)
    ? LEGACY_ORDER.filter((f) => existsSync(join(LEGACY, f))).map((f) => ({ file: f, dir: LEGACY, kind: 'legacy' }))
    : [];
  const migrationFiles = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, dir: MIGRATIONS, kind: 'migration' }));

  /**
   * Whether to run the legacy folder.
   *
   * Three states, and conflating the middle one with the last is a bug this
   * already had: after a failure part-way through legacy, the database is no
   * longer empty, so a plain freshness check skipped every REMAINING legacy
   * file forever and went straight to 0001 — which then failed on a column
   * those files create.
   *
   *   fresh, nothing recorded  → run them; this is a new database
   *   part-way through         → finish them; we started this sequence
   *   has tables, none recorded → skip; somebody set this up by hand, and
   *                               these files are not idempotent
   */
  const legacyStarted = [...applied.keys()].some((n) => n.startsWith('legacy/'));
  const runLegacy = fresh || legacyStarted;
  const plan = [...(runLegacy ? legacyFiles : []), ...migrationFiles];

  if (!runLegacy && legacyFiles.length) {
    console.log(yellow('Skipping supabase/legacy/ — this database already has tables.'));
    console.log(dim('  They are not idempotent, and re-running one would re-open a policy 0077 closed.\n'));
  }

  let pending = 0, done = 0, changed = 0;

  for (const { file, dir, kind } of plan) {
    const name = kind === 'legacy' ? `legacy/${file}` : file;
    const sql = readFileSync(join(dir, file), 'utf8');
    const sum = sha(sql);
    const was = applied.get(name);

    if (was) {
      // A changed file that is already applied is worth saying out loud. The
      // migrations are idempotent, so re-running is safe and often what you
      // want — but silently ignoring an edit is how a fix never gets deployed.
      if (was !== sum) { changed++; console.log(yellow(`~ ${name}`), dim('changed since it was applied — re-running')); }
      else { done++; if (STATUS_ONLY) console.log(green('✓'), dim(name)); continue; }
    } else {
      pending++;
    }

    if (STATUS_ONLY) { console.log(yellow('•'), name, dim('pending')); continue; }
    if (DRY_RUN) { console.log(dim('would run'), name); continue; }

    process.stdout.write(`${dim('→')} ${name} `);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query(
        `insert into schema_migrations (name, checksum, kind) values ($1, $2, $3)
         on conflict (name) do update set checksum = excluded.checksum, applied_at = now()`,
        [name, sum, kind],
      );
      await client.query('commit');
      console.log(green('ok'));
    } catch (e) {
      await client.query('rollback').catch(() => {});
      console.log(red('failed'));
      console.error(`\n${red(e.message)}`);
      if (e.position) {
        // The offending line, because "syntax error at position 8412" in a
        // 700-line file is not something anyone can act on.
        const upto = sql.slice(0, Number(e.position));
        const line = upto.split('\n').length;
        console.error(dim(`  ${name}:${line}  ${sql.split('\n')[line - 1]?.trim().slice(0, 120) ?? ''}`));
      }
      console.error(`\nNothing from ${name} was applied — the whole file rolled back.`);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();

  if (STATUS_ONLY) {
    console.log(`\n${done} applied, ${pending} pending${changed ? `, ${changed} changed` : ''}.`);
  } else if (DRY_RUN) {
    console.log(`\n${pending} would run.`);
  } else if (pending || changed) {
    console.log(green(`\nDatabase is up to date — ${pending} applied${changed ? `, ${changed} re-applied` : ''}.`));
  } else {
    console.log(green('\nDatabase is already up to date.'));
  }
}

main().catch((e) => { console.error(red(e.message)); process.exit(1); });
