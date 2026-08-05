import { NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/version — what you are running, and what the newest release is.
 *
 * IT SENDS NOTHING ABOUT THIS INSTANCE. The request to GitHub is a plain
 * unauthenticated GET for a public release list: no instance id, no version, no
 * domain, no query string. There is no telemetry in this project and this is
 * the one place someone would reasonably expect to find some, so it is worth
 * being explicit — an update check that phones home is how a self-hosted app
 * quietly becomes a tracked one.
 *
 * The check runs SERVER-SIDE and is cached, so a hundred people opening the
 * settings page is one request an hour rather than a hundred. GitHub rate-limits
 * unauthenticated calls to 60/hour per IP; going over that is a "could not
 * check", not an error worth showing.
 *
 * An instance with no outbound internet gets `latest: null` and says so, which
 * is the honest answer rather than "you are up to date".
 */

const RELEASES = 'https://api.github.com/repos/RunButter/runbutter/releases/latest';
const TTL_MS = 60 * 60 * 1000;

let cache: { at: number; latest: Release | null } | null = null;

interface Release { version: string; name: string; url: string; published_at: string; notes: string }

function currentVersion(): { version: string; commit: string | null } {
  let version = '0.0.0';
  try {
    version = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version || version;
  } catch { /* a packaged build without package.json — the commit still identifies it */ }
  // Whichever host set one. None of these are secret; they are in the build.
  const commit =
    process.env.RUNBUTTER_COMMIT ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.SOURCE_VERSION ||
    null;
  return { version, commit: commit ? commit.slice(0, 7) : null };
}

/** `v1.2.3` / `1.2.3` → comparable tuple. Anything unparseable sorts as 0.0.0. */
const parts = (v: string) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
};

const isNewer = (latest: string, current: string) => {
  const a = parts(latest), b = parts(current);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
};

async function fetchLatest(): Promise<Release | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.latest;
  try {
    const res = await fetch(RELEASES, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'runbutter-update-check' },
      // Never let a slow or hanging GitHub keep a settings page spinning.
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) { cache = { at: Date.now(), latest: null }; return null; }
    const j: any = await res.json();
    const latest: Release = {
      version: String(j.tag_name || '').replace(/^v/, ''),
      name: String(j.name || j.tag_name || ''),
      url: String(j.html_url || ''),
      published_at: String(j.published_at || ''),
      // Enough to see what changed without opening a browser; the link has the rest.
      notes: String(j.body || '').slice(0, 4000),
    };
    cache = { at: Date.now(), latest };
    return latest;
  } catch {
    // A failed check is cached too, briefly, so an offline instance does not
    // retry on every page view.
    cache = { at: Date.now() - TTL_MS + 5 * 60 * 1000, latest: null };
    return null;
  }
}

export async function GET() {
  const current = currentVersion();
  const latest = await fetchLatest();
  return NextResponse.json({
    current: current.version,
    commit: current.commit,
    latest: latest?.version ?? null,
    release: latest,
    updateAvailable: latest ? isNewer(latest.version, current.version) : false,
    checked: !!latest,
  });
}
