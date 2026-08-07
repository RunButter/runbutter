#!/usr/bin/env node
/**
 * create-runbutter — the four commands in the README, as one.
 *
 *   npx create-runbutter
 *   npm create runbutter
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `npm install runbutter` would be wrong and is deliberately not published:
 * `npm install` is for libraries you import, and RunButter is an application
 * with a database. What projects people are thinking of actually ship is a
 * SCAFFOLDER — one command that runs once and leaves you with something
 * running. This is that.
 *
 * It also replaces setup.sh on the majority of desktops. That script is bash,
 * which on Windows exists only if Git was installed with the option ticked —
 * the same mistake publish-oss.sh made before it was rewritten in Node.
 *
 * ── ZERO DEPENDENCIES, ON PURPOSE ───────────────────────────────────────────
 * `npx` downloads a package before it runs it. Every dependency here is latency
 * in the first ten seconds a stranger spends with the project, which is the
 * exact ten seconds that decides whether they keep going. Node builtins only —
 * no colour library, no prompt library, no spinner.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, argv, exit, platform } from 'node:process';

const REPO = 'https://github.com/RunButter/runbutter.git';

// Windows terminals have handled ANSI since Windows 10, but a redirected
// stream (a log file, a CI step) should not collect escape codes.
const tty = stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const ok = (m) => console.log(`${c(32, '✓')} ${m}`);
const info = (m) => console.log(`${c(2, '•')} ${m}`);
const step = (m) => console.log(`\n${c(1, m)}`);
const die = (m) => { console.error(`${c(31, '✗')} ${m}`); exit(1); };

const args = argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const has = (name) => args.includes(`--${name}`);

if (has('help')) {
  console.log(`
create-runbutter — set up a self-hosted RunButter.

  npx create-runbutter [directory] [options]

  --privy-app-id <id>   Skip the prompt (dashboard.privy.io, free)
  --no-start            Set everything up but do not run docker compose
  --branch <name>       Clone a branch other than the default
  --help
`);
  exit(0);
}

const target = resolve(args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--privy-app-id' && args[args.indexOf(a) - 1] !== '--branch') || 'runbutter');

console.log(`\n${c(1, 'RunButter')} — the open company OS\n${c(2, 'sales · finance · marketing · projects · hiring, on one Postgres')}`);

// ── What we need before touching the disk ───────────────────────────────────
step('Checking your machine');

const have = (cmd, versionArg = '--version') => {
  try { return execFileSync(cmd, [versionArg], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0]; }
  catch { return null; }
};

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 18) die(`Node ${process.versions.node} is too old — 18 or newer is required.`);
ok(`Node ${process.versions.node}`);

const git = have('git');
if (!git) die('git is not installed. Get it from https://git-scm.com and run this again.');
ok(git);

// Docker is checked but never required: someone who wants the hosted-Postgres
// path should still get a clone and an .env out of this, not a refusal.
let docker = have('docker');
if (docker) {
  const daemon = spawnSync('docker', ['info'], { stdio: 'ignore' });
  if (daemon.status !== 0) {
    docker = null;
    info('Docker is installed but not running — start Docker Desktop to use the one-command path.');
  } else ok(docker);
} else {
  info('Docker not found. You can still use a hosted Postgres — see docs/install.md.');
}

// ── Clone ───────────────────────────────────────────────────────────────────
step('Getting the code');

if (existsSync(target) && readdirSync(target).length > 0) {
  die(`${target} already exists and is not empty.\n\n    Pick another directory:  npx create-runbutter my-runbutter`);
}

const branch = flag('branch');
try {
  // --depth 1: nobody scaffolding an app wants 150 commits of history, and on a
  // slow connection the shallow clone is the difference between 5s and a minute.
  execFileSync('git', ['clone', '--depth', '1', ...(branch ? ['--branch', branch] : []), REPO, target], { stdio: 'inherit' });
} catch {
  die('Could not clone the repository. Check your network and try again.');
}
ok(`Cloned into ${target}`);

// ── Secrets ─────────────────────────────────────────────────────────────────
step('Generating secrets');

const envPath = join(target, '.env');
const examplePath = join(target, '.env.docker.example');
if (!existsSync(examplePath)) die('.env.docker.example is missing from the clone — this should not happen; please open an issue.');

writeFileSync(envPath, readFileSync(examplePath, 'utf8'));

/** The three the containers verify against each other. Empty means broken. */
const REQUIRED = ['JWT_SECRET', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY'];
const missingKeys = () => {
  const text = readFileSync(envPath, 'utf8');
  return REQUIRED.filter((k) => !(text.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1] || '').trim());
};

const genKeys = (args, opts = {}) => {
  try { return execFileSync(process.execPath, ['scripts/gen-keys.mjs', ...args], { cwd: target, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }); }
  catch { return null; }
};

// The repo's own generator, so there is one definition of what a valid key
// looks like. These are JWTs signed with JWT_SECRET; PostgREST and the storage
// API both verify against it, and a hand-written placeholder fails the
// handshake in a way that looks like a networking fault.
//
// --write, not `--env >>`: every one of these keys already exists (empty) in
// the example, so appending wrote each of them twice. Compose reads the last
// value, so it worked — until someone edited the first one, under the comment
// that explains it, and watched the edit do nothing.
genKeys(['--write', '.env']);

// AND THEN CHECK, because this package is published separately from the repo
// and can be pointed at an older tag or a fork. A gen-keys.mjs that predates
// --write does not fail: it treats the flag as noise, prints its usage block,
// and exits 0 having written nothing. Trusting the exit code meant reporting
// "✓ .env written" over an empty file, and the next thing the person saw was
// a JWT error from a container. Found by running this against a clone one
// commit behind — exactly the situation every real user will be in.
if (missingKeys().length) {
  const printed = genKeys(['--env']);
  if (printed) {
    // Older layout: append, then de-duplicate so the file still has each key
    // once. Last value wins in dotenv, so the appended one is the live one.
    let text = readFileSync(envPath, 'utf8');
    for (const line of printed.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (!m) continue;
      const re = new RegExp(`^${m[1]}=.*$`, 'm');
      text = re.test(text) ? text.replace(re, line) : text + (text.endsWith('\n') ? '' : '\n') + line + '\n';
    }
    writeFileSync(envPath, text);
  }
}

const stillMissing = missingKeys();
if (stillMissing.length) {
  die(`Could not generate ${stillMissing.join(', ')}.\n\n    Run it yourself:  cd ${target} && node scripts/gen-keys.mjs --write .env`);
}
ok('.env written — JWT secret, anon key, service key, encryption key');

// ── The one thing that is not local ─────────────────────────────────────────
step('Authentication');

let privy = flag('privy-app-id');
if (!privy) {
  console.log(`
  RunButter signs people in with ${c(1, 'Privy')}, which is a hosted service. It is
  free, takes about two minutes, and there is no way around it in this stack —
  so it is asked for here rather than discovered halfway through.

  Create an app at ${c(4, 'https://dashboard.privy.io')} and paste its App ID.
  Everything else — your data, your files, your API — stays on this machine.
`);
  if (stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    privy = (await rl.question('  Privy App ID (or press enter to add it later): ')).trim();
    rl.close();
  } else {
    info('Not an interactive terminal — add PRIVY_APP_ID to .env yourself.');
  }
}

if (privy) {
  // In place, for the same reason as the keys above: PRIVY_APP_ID is already in
  // the example, and a second one further down is a debugging session nobody
  // should have to have.
  const text = readFileSync(envPath, 'utf8');
  writeFileSync(envPath, /^PRIVY_APP_ID=.*$/m.test(text)
    ? text.replace(/^PRIVY_APP_ID=.*$/m, `PRIVY_APP_ID=${privy}`)
    : text + (text.endsWith('\n') ? '' : '\n') + `PRIVY_APP_ID=${privy}\n`);
  ok('Privy app id saved');
} else {
  // Not a failure. A clone with a complete .env minus one line is a much better
  // place to be stuck than no clone at all.
  info('Skipped. Add PRIVY_APP_ID to .env before starting, or login will not work.');
}

// ── Start ───────────────────────────────────────────────────────────────────
const canStart = docker && privy && !has('no-start');

if (canStart) {
  step('Starting (first run builds the app image — a few minutes)');
  const up = spawnSync('docker', ['compose', 'up', '-d', '--wait', '--wait-timeout', '900'], { cwd: target, stdio: 'inherit' });
  if (up.status !== 0) {
    console.log(`
${c(31, '✗')} The stack did not come up. See what happened with:

    cd ${target}
    docker compose logs --tail 100
`);
    exit(1);
  }
  console.log(`
${c(32, '✓')} ${c(1, 'RunButter is running')} → ${c(4, 'http://localhost:3000')}

  Sign in, then use ${c(1, 'Add sample data')} on the home screen to see how the
  modules connect — it only offers itself on an empty workspace.

  Stop it:      cd ${target} && docker compose down
  Wipe it:      cd ${target} && docker compose down -v
`);
} else {
  const why = !docker ? 'Docker is not running' : !privy ? 'no Privy app id yet' : 'you passed --no-start';
  console.log(`
${c(32, '✓')} Set up in ${c(1, target)} ${c(2, `(not started — ${why})`)}

  ${!privy ? `1. Put PRIVY_APP_ID in ${join(target, '.env')}\n  2. ` : '1. '}cd ${target} && docker compose up

  No Docker? A hosted Postgres works too:
    DATABASE_URL='postgresql://…:5432/postgres' npm run migrate
    npm install && npm run dev

  The long version: ${c(4, 'https://runbutter.app/developers/install')}
`);
}

// A parting note that is easy to miss and expensive to learn late.
if (platform === 'win32') {
  console.log(`${c(2, '  Windows: run this from PowerShell or Terminal. WSL works too, but keep\n  the clone inside the WSL filesystem or Docker file-watching will crawl.')}\n`);
}
