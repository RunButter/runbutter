#!/usr/bin/env node
/**
 * Bring the public repo up to date with the working repo.
 *
 *   npm run publish:oss
 *
 * WHY THIS EXISTS. There are two GitHub repos and only one of them is where
 * work lands:
 *
 *   CasperCrypto/hirebtr    the WORKING repo. Cloud sessions push here, and
 *                           it is the only one guaranteed current.
 *   RunButter/runbutter     the PUBLIC repo. Same commits, published.
 *
 * They are not two projects and there is no second set of commits to write.
 * This fast-forwards `main` from the working repo and pushes it to the public
 * one. It is a stopgap: once cloud sessions are started from the public repo
 * there is one repo and this script should be deleted.
 *
 * ── IT DOES NOT CARE WHICH ONE IS `origin` ─────────────────────────────────
 * The first version demanded that `origin` be the working repo, which was true
 * of exactly one clone on one machine. The moment the public repo became
 * `origin` — which is the whole direction this is heading — a correct clone got
 * refused with a message telling it to go and clone something else. Remotes are
 * matched BY URL now, and whichever one is missing is added under a name that
 * is not taken. Where `origin` points is not information about anything.
 *
 * NODE, NOT BASH: this is run from PowerShell, where a .sh file is not
 * executable and `bash` is on PATH only if Git for Windows was installed with
 * that option ticked. migrate.mjs and bundle-sql.mjs are Node for the same
 * reason. It also has no dependencies, so it runs in a clone with no
 * node_modules.
 */

import { execFileSync } from 'node:child_process';

const SOURCE = { url: 'https://github.com/CasperCrypto/hirebtr.git', fallbackName: 'working', label: 'CasperCrypto/hirebtr' };
const PUBLIC = { url: 'https://github.com/RunButter/runbutter.git', fallbackName: 'public', label: 'RunButter/runbutter' };
const BRANCH = 'main';

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const info = (m) => console.log(`\x1b[2m•\x1b[0m ${m}`);
const die = (m) => { console.error(`\x1b[31m✗\x1b[0m ${m}`); process.exit(1); };

/** Captured, for asking git a question. */
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
/** Inherited, for network operations — credential prompts and progress must reach the terminal. */
const gitLive = (...args) => execFileSync('git', args, { stdio: 'inherit' });

/** `name\turl` per remote, both fetch and push rows. */
function remotes() {
  const out = new Map();
  for (const line of git('remote', '-v').split('\n').filter(Boolean)) {
    const [name, rest] = line.split('\t');
    if (rest) out.set(name, rest.replace(/\s+\(\w+\)$/, ''));
  }
  return out;
}

/**
 * GitHub URLs come in several spellings (https, ssh, with and without .git),
 * so remotes are compared by owner/repo rather than by string.
 *
 * Returns null — never '' — when a URL is not a GitHub one. An empty string
 * compares equal to another empty string, which meant a remote this could not
 * parse matched EVERY target: both repos resolved to the same remote and the
 * script cheerfully published a repo to itself, reporting success. A matcher
 * that cannot identify something must say so, not return a value that matches
 * everything.
 */
const slugOf = (url) => url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/i)?.[1].toLowerCase() ?? null;

/** The remote pointing at this repo, creating one if none does. */
function remoteFor(target) {
  const want = slugOf(target.url);
  for (const [name, url] of remotes()) {
    const got = slugOf(url);
    if (got !== null && got === want) return name;
  }
  let name = target.fallbackName;
  for (let i = 2; remotes().has(name); i++) name = `${target.fallbackName}${i}`;
  git('remote', 'add', name, target.url);
  ok(`Added remote '${name}' → ${target.label}`);
  return name;
}

// ── The tree has to be clean ────────────────────────────────────────────────
// Publishing from a dirty tree publishes the last commit, not what you are
// looking at, which is the kind of surprise you find out about from an issue.
if (git('status', '--porcelain')) {
  die('You have uncommitted changes. Commit or stash them first — publishing pushes commits, not your working tree.');
}

// ── …and it has to be main ──────────────────────────────────────────────────
const current = git('rev-parse', '--abbrev-ref', 'HEAD');
if (current !== BRANCH) die(`You are on '${current}'. Switch to ${BRANCH} — that is the branch the public repo tracks.`);

const source = remoteFor(SOURCE);
const target = remoteFor(PUBLIC);
info(`working: ${source} → ${SOURCE.label}`);
info(`public:  ${target} → ${PUBLIC.label}`);

// ── Take everything the working repo has ────────────────────────────────────
// This is the step the old script left to the caller, which is exactly how a
// `git pull` against the wrong remote answered "Already up to date" and looked
// like success while sitting a hundred commits behind.
info(`Fetching ${BRANCH} from ${SOURCE.label}…`);
gitLive('fetch', source, BRANCH);

const behind = git('rev-list', '--count', `HEAD..${source}/${BRANCH}`);
const ahead = git('rev-list', '--count', `${source}/${BRANCH}..HEAD`);

if (behind !== '0') {
  if (ahead !== '0') {
    die(`Your ${BRANCH} has ${ahead} commit(s) the working repo does not, and is ${behind} behind it.

    That is a real divergence and picking a side automatically would lose work.
    Merge it yourself, then run this again:

      git merge ${source}/${BRANCH}`);
  }
  git('merge', '--ff-only', `${source}/${BRANCH}`);
  ok(`Fast-forwarded ${BRANCH} by ${behind} commit(s)`);
} else {
  info(`Already has everything from ${SOURCE.label}`);
}

// Local commits go to the working repo FIRST. The published copy must never be
// ahead of the repo the deploy builds from — that is how you end up serving
// something older than what people are reading.
if (git('rev-list', '--count', `${source}/${BRANCH}..HEAD`) !== '0') {
  info(`Pushing your local commits to ${SOURCE.label}…`);
  try { gitLive('push', source, BRANCH); } catch { die(`Could not push to ${SOURCE.label}. Fix that before publishing.`); }
}

// ── Publish ─────────────────────────────────────────────────────────────────
// A force-push to a public repo rewrites history under anyone who has cloned or
// forked it, so a rejected push is reported with the merge instead.
try {
  info(`Publishing to ${PUBLIC.label}…`);
  gitLive('push', target, BRANCH);
  ok('Published — https://github.com/RunButter/runbutter');
} catch {
  die(`Push rejected. Either the public repo has commits yours does not, or a
    ruleset requires a pull request on ${BRANCH}.

    If it is commits, bring them in rather than overwriting:

      git fetch ${target} ${BRANCH}
      git merge ${target}/${BRANCH}
      npm run publish:oss

    If it is the ruleset, add yourself to its bypass list:
      Settings → Rules → Rulesets → the ${BRANCH} ruleset → Bypass list`);
}
