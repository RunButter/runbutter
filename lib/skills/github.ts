// Pure helpers for the GitHub skill import. They live here rather than in the
// route because a Next.js route module may only export the HTTP verbs and a
// small set of config keys — exporting anything else is a type error. Being in
// lib/ also means they can be unit-tested without standing up the route.

export interface RepoRef { owner: string; repo: string; ref?: string; subdir?: string }

/**
 * Why a failed GitHub response gets a REASON rather than being thrown away.
 *
 * The importer used to treat every failure the same and told the user
 * "Repository not found, or GitHub rate-limited this server" — two unrelated
 * problems with opposite fixes. One means check the URL, the other means wait,
 * and nothing in that sentence says which applies. In practice it was nearly
 * always the rate limit, and people re-checked a URL that was fine.
 *
 * GitHub signals an exhausted quota as 403 OR 429, and only the
 * x-ratelimit-remaining header separates it from the other things a 403 means
 * (a blocked User-Agent, a repository you cannot see). A 403 reported as "try
 * again shortly" is a lie, because waiting will not help.
 */
export type GithubFailure = { reason: 'notfound' | 'ratelimit' | 'error'; resetAt?: number };

export function classifyGithubResponse(
  status: number,
  headers: { get(name: string): string | null },
): GithubFailure {
  const remaining = headers.get('x-ratelimit-remaining');
  if ((status === 403 || status === 429) && remaining === '0') {
    const reset = Number(headers.get('x-ratelimit-reset') || 0);
    // The header is unix SECONDS. Treating it as ms once produced "try again in
    // about 29,000,000 minutes", which is at least honest about being wrong.
    return { reason: 'ratelimit', resetAt: reset > 0 ? reset * 1000 : undefined };
  }
  if (status === 404) return { reason: 'notfound' };
  return { reason: 'error' };
}

/** "in about 34 minutes" — a wait nobody can act on is just a shrug. */
export function waitFor(resetAt: number | undefined, now = Date.now()): string {
  if (!resetAt || resetAt <= now) return 'shortly';
  const mins = Math.ceil((resetAt - now) / 60_000);
  return mins === 1 ? 'in about a minute' : `in about ${mins} minutes`;
}

/** Accepts github.com/o/r, .../tree/<ref>/<path>, or a bare o/r. */
export function parseRepoUrl(raw: string): RepoRef | null {
  const s = (raw || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  if (!s) return null;
  const bare = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (bare) return { owner: bare[1], repo: bare[2] };
  let u: URL;
  try { u = new URL(s.startsWith('http') ? s : `https://${s}`); } catch { return null; }
  if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo, kind, ref, ...rest] = parts;
  if (kind === 'tree' && ref) return { owner, repo, ref, subdir: rest.join('/') || undefined };
  return { owner, repo };
}

/**
 * Parse a SKILL.md: optional YAML frontmatter (name/description), body is the
 * instructions. Only the two scalar keys are read — this is not a YAML parser
 * and must not become one, because the file is untrusted input.
 */
export function parseSkillMd(text: string, path: string) {
  let body = text;
  let name = '';
  let description = '';

  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    body = text.slice(fm[0].length);
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^(name|description)\s*:\s*(.*)$/i);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (m[1].toLowerCase() === 'name') name = v; else description = v;
    }
  }
  if (!name) {
    const h1 = body.match(/^#\s+(.+)$/m);
    // Fall back to the directory name — "skills/invoice-tone/SKILL.md" is far
    // more useful as a label than "SKILL".
    const seg = path.split('/').filter(Boolean);
    const dir = seg.length > 1 ? seg[seg.length - 2] : seg[0] || 'skill';
    name = (h1?.[1] || dir.replace(/[-_]+/g, ' ')).trim();
  }
  if (!description) {
    const firstPara = body.replace(/^#.*$/m, '').trim().split(/\r?\n\s*\r?\n/)[0] || '';
    description = firstPara.replace(/\s+/g, ' ').slice(0, 200);
  }
  return {
    name: name.slice(0, 120),
    description: description.slice(0, 200),
    instructions: body.trim().slice(0, 20_000),   // matches save_skill's cap
    suggested_tools: [] as string[],
    path,
  };
}

