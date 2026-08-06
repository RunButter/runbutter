#!/usr/bin/env node
/**
 * Mirror main to the public open-source repo.
 *
 *   npm run publish:oss
 *
 * WHY THIS EXISTS. There are two GitHub repos and only one of them is the one
 * you work in:
 *
 *   CasperCrypto/hirebtr    the working repo. Render deploys from it. Every
 *                           commit lands here first.
 *   RunButter/runbutter     the public, open-source repo. Same code, published.
 *
 * They are NOT two projects and there is no second set of commits to write. The
 * public repo is a copy of `main`, pushed when you want the world to see what
 * you have.
 *
 * NODE, NOT BASH, on purpose: this is run from PowerShell on Windows, where a
 * `.sh` file is not executable and `bash` is only on PATH if Git for Windows
 * was installed with the option ticked. The first version of this script was
 * bash and simply did not run. `migrate.mjs` and `bundle-sql.mjs` are Node for
 * the same reason — match them.
 */

import { execFileSync } from 'node:child_process';

const PUBLIC_URL = 'https://github.com/RunButter/runbutter.git';
const BRANCH = 'main';

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const info = (m) => console.log(`\x1b[2m•\x1b[0m ${m}`);
const die = (m) => { console.error(`\x1b[31m✗\x1b[0m ${m}`); process.exit(1); };

/** Captured, for asking git a question. */
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
/** Inherited, for pushes — so credential prompts and progress reach the terminal. */
const gitLive = (...args) => execFileSync('git', args, { stdio: 'inherit' });

// ── The tree has to be clean ────────────────────────────────────────────────
// Publishing from a dirty tree publishes the last commit, not what you are
// looking at, which is the kind of surprise you find out about from an issue.
if (git('status', '--porcelain')) {
  die('You have uncommitted changes. Commit them first — publishing pushes commits, not your working tree.');
}

// ── …and it has to be main ──────────────────────────────────────────────────
const current = git('rev-parse', '--abbrev-ref', 'HEAD');
if (current !== BRANCH) {
  die(`You are on '${current}'. Switch to ${BRANCH} first — the public repo tracks ${BRANCH}.`);
}

// ── You have to be in the repo this script is for ───────────────────────────
// This is the check that matters, and it exists because the mistake actually
// happened. An old local clone had `origin` pointing at CasperCrypto/talent-insight
// — the STALE MIRROR named in CLAUDE.md — so `git pull` answered "Already up to
// date" while sitting a hundred commits behind, and publishing from it would
// have pushed months-old code to the repo strangers read. "Already up to date"
// is not evidence that you are up to date; it only means your origin had
// nothing new.
//
// So: refuse unless origin is the working repo. Naming what was found is the
// whole value — "wrong repo" without the URL sends you hunting.
let originUrl = '';
try { originUrl = git('remote', 'get-url', 'origin'); } catch { /* no origin */ }
if (!/CasperCrypto\/hirebtr/i.test(originUrl)) {
  die(`This clone's origin is not the working repo.

    found:    ${originUrl || '(no origin remote)'}
    expected: https://github.com/CasperCrypto/hirebtr.git

    Publishing from here would push whatever THAT repo contains. Clone the
    working repo instead — it is the only one guaranteed current:

      git clone https://github.com/CasperCrypto/hirebtr.git
      cd hirebtr && npm run publish:oss`);
}

// ── The remote, created on first use ────────────────────────────────────────
let publicUrl = '';
try { publicUrl = git('remote', 'get-url', 'public'); } catch { /* not added yet */ }
if (publicUrl) {
  info(`remote 'public' → ${publicUrl}`);
} else {
  git('remote', 'add', 'public', PUBLIC_URL);
  ok(`Added remote 'public' → ${PUBLIC_URL}`);
}

// ── Push the working repo first ─────────────────────────────────────────────
// The public copy must never be AHEAD of the one Render builds; that is how you
// end up serving something older than what people are reading.
try {
  info('Pushing to origin (the repo Render deploys)…');
  gitLive('push', 'origin', BRANCH);
  ok(`origin/${BRANCH} up to date`);
} catch {
  die('Could not push to origin. Fix that first — the public copy must not get ahead of what is deployed.');
}

// ── Then publish ────────────────────────────────────────────────────────────
// A force-push to a public repo rewrites history under anyone who has cloned or
// forked it, so a rejected push is reported with the merge instead.
try {
  info('Publishing to RunButter/runbutter…');
  gitLive('push', 'public', BRANCH);
  ok('Published — https://github.com/RunButter/runbutter');
} catch {
  die(`Push rejected. The public repo has commits yours does not (edited a file on
    github.com? merged a PR there?). Bring them in rather than overwriting:

      git fetch public ${BRANCH}
      git merge public/${BRANCH}
      npm run publish:oss

    Only force if you are certain nobody has that history:
      git push public ${BRANCH} --force`);
}
