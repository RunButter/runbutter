import { NextResponse } from 'next/server';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { parseRepoUrl, parseSkillMd, classifyGithubResponse, waitFor, type GithubFailure } from '@/lib/skills/github';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/skills/import { url }
 * Reads SKILL.md files from a PUBLIC GitHub repository and returns them parsed.
 *
 * This route deliberately WRITES NOTHING. An imported skill becomes part of a
 * system prompt, so the human picks which of the previewed skills to save and
 * the save goes through save_skill like any other. That also keeps this route
 * from being a way to push text into someone's workspace.
 *
 * Keyless by DEFAULT (the free-data rule): the public GitHub REST API and
 * raw.githubusercontent, nothing metered. Unauthenticated GitHub allows 60
 * requests/hour per IP, which is why the file count is capped low and the tree
 * is fetched in ONE call rather than walked directory by directory. GITHUB_TOKEN
 * is optional and only raises that ceiling — see below.
 */

const MAX_FILES = 25;
const MAX_BYTES = 64 * 1024;         // per file
const FETCH_TIMEOUT_MS = 10_000;

// GitHub's API 403s a request with no User-Agent — the same failure mode that
// silently broke the OFAC ingest.
//
// GITHUB_TOKEN is OPTIONAL and raises the limit from 60 requests/hour to 5,000.
// Without it the quota is per IP, and on a hosted deployment that IP is the
// SERVER's — so every user of the instance shares one 60/hour budget and a
// handful of imports exhausts it for everybody. Any token with no scopes at all
// works; this only ever reads public repositories.
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const UA: Record<string, string> = {
  'user-agent': 'RunButter-Skills-Import',
  accept: 'application/vnd.github+json',
  ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
};

/** Success carries the parsed body; failure carries a reason the caller can explain. */
type Fetched = { ok: true; json: any } | ({ ok: false } & GithubFailure);

async function getJson(url: string): Promise<Fetched> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal });
    if (r.ok) return { ok: true, json: await r.json() };
    return { ok: false, ...classifyGithubResponse(r.status, r.headers) };
  } catch {
    // A timeout or DNS failure is not a missing repository.
    return { ok: false, reason: 'error' };
  } finally { clearTimeout(t); }
}

function rateLimitBody(resetAt?: number) {
  return {
    error: TOKEN
      ? `GitHub's API limit for this server is used up. Try again ${waitFor(resetAt)}.`
      : `GitHub allows this server 60 API requests an hour and they are used up — that budget is shared by everyone on this instance. Try again ${waitFor(resetAt)}, or ask the operator to set GITHUB_TOKEN (any token, no scopes needed) to raise it to 5,000.`,
    rateLimited: true,
    retryAt: resetAt ?? null,
  };
}

export async function POST(req: Request) {
  const rl = rateLimit(`skillimport:${clientIp(req)}`, 10);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const ref = parseRepoUrl(String(b?.url || ''));
  if (!ref) return NextResponse.json({ error: 'Enter a GitHub repository URL, e.g. github.com/owner/repo' }, { status: 400 });

  // Resolve the default branch when the URL didn't name one.
  let branch: string = ref.ref || '';
  if (!branch) {
    const meta = await getJson(`https://api.github.com/repos/${ref.owner}/${ref.repo}`);
    if (!meta.ok) {
      if (meta.reason === 'ratelimit') return NextResponse.json(rateLimitBody(meta.resetAt), { status: 429 });
      if (meta.reason === 'notfound') {
        return NextResponse.json({
          error: `No public repository at github.com/${ref.owner}/${ref.repo}. Check the spelling — private repositories cannot be read.`,
        }, { status: 404 });
      }
      return NextResponse.json({ error: 'Could not reach GitHub. Try again in a moment.' }, { status: 502 });
    }
    branch = meta.json.default_branch || 'main';
  }

  const tree = await getJson(`https://api.github.com/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (!tree.ok) {
    if (tree.reason === 'ratelimit') return NextResponse.json(rateLimitBody(tree.resetAt), { status: 429 });
    if (tree.reason === 'error') return NextResponse.json({ error: 'Could not reach GitHub. Try again in a moment.' }, { status: 502 });
    return NextResponse.json({
      error: ref.ref
        ? `The repository has no branch called "${branch}". Link it without the branch, e.g. github.com/${ref.owner}/${ref.repo}.`
        : `Could not read the file list for "${branch}". The repository may be empty.`,
    }, { status: 404 });
  }

  const wanted = (tree.json.tree as any[])
    .filter((n) => n.type === 'blob' && /(^|\/)SKILL\.md$/i.test(n.path))
    .filter((n) => (ref.subdir ? String(n.path).startsWith(ref.subdir + '/') : true))
    .filter((n) => (n.size ?? 0) <= MAX_BYTES)
    .slice(0, MAX_FILES);

  if (!wanted.length) {
    return NextResponse.json({
      error: tree.json.truncated
        ? 'No SKILL.md files found in the part of this repository GitHub returned — try linking a subfolder.'
        : 'No SKILL.md files found in that repository. Skills live in directories containing a SKILL.md file, usually under skills/.',
    }, { status: 404 });
  }

  const base = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${branch}/`;
  const skills = (await Promise.all(wanted.map(async (n) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(base + n.path.split('/').map(encodeURIComponent).join('/'), { headers: { 'user-agent': UA['user-agent'] }, signal: ctl.signal });
      if (!r.ok) return null;
      const text = (await r.text()).slice(0, MAX_BYTES);
      return parseSkillMd(text, n.path);
    } catch { return null; } finally { clearTimeout(t); }
  }))).filter(Boolean);

  if (!skills.length) return NextResponse.json({ error: 'Found SKILL.md files but none could be read.' }, { status: 502 });

  return NextResponse.json({
    source_url: `https://github.com/${ref.owner}/${ref.repo}`,
    branch,
    truncated: Boolean(tree.json.truncated),
    skills,
  });
}
