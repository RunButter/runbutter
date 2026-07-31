import { NextResponse } from 'next/server';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { parseRepoUrl, parseSkillMd } from '@/lib/skills/github';

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
 * Keyless by design (the free-data rule): the public GitHub REST API and
 * raw.githubusercontent, no token, no metering. Unauthenticated GitHub allows
 * 60 requests/hour per IP, which is why the file count is capped low and the
 * tree is fetched in ONE call rather than walked directory by directory.
 */

const MAX_FILES = 25;
const MAX_BYTES = 64 * 1024;         // per file
const FETCH_TIMEOUT_MS = 10_000;

// GitHub's API 403s a request with no User-Agent — the same failure mode that
// silently broke the OFAC ingest.
const UA = { 'user-agent': 'RunButter-Skills-Import', accept: 'application/vnd.github+json' };

async function getJson(url: string): Promise<any | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
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
    if (!meta) return NextResponse.json({ error: 'Repository not found, or GitHub rate-limited this server. Try again shortly.' }, { status: 404 });
    branch = meta.default_branch || 'main';
  }

  const tree = await getJson(`https://api.github.com/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (!tree?.tree) return NextResponse.json({ error: `Could not read the file list for branch "${branch}".` }, { status: 404 });

  const wanted = (tree.tree as any[])
    .filter((n) => n.type === 'blob' && /(^|\/)SKILL\.md$/i.test(n.path))
    .filter((n) => (ref.subdir ? String(n.path).startsWith(ref.subdir + '/') : true))
    .filter((n) => (n.size ?? 0) <= MAX_BYTES)
    .slice(0, MAX_FILES);

  if (!wanted.length) {
    return NextResponse.json({
      error: tree.truncated
        ? 'No SKILL.md files found in the part of this repository GitHub returned — try linking a subfolder.'
        : 'No SKILL.md files found in that repository.',
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
    truncated: Boolean(tree.truncated),
    skills,
  });
}
