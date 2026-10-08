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


/**
 * Skills whose licence is NOT what the repository's LICENSE file says.
 *
 * WHY THIS EXISTS. RunButter suggests `anthropics/skills` by name on the import
 * screen — it is the best public example of the format. Its LICENSE is Apache
 * 2.0, and four directories are carved out of that in the README as
 * "source-available (not open source)": docx, pdf, pptx and xlsx. Nothing in
 * the repository tree says so, so an importer that reads LICENSE and trusts it
 * pulls restricted text into a workspace of an MIT product and tells the person
 * it was Apache.
 *
 * It does NOT block the import. The preview already exists so a human decides
 * what to save (nothing is stored until they do), and deciding is exactly what
 * a licence question needs. What was missing was the fact — so the fact is
 * shown, on the row it applies to, before the tick.
 *
 * HAND-MAINTAINED, AND THAT IS THE HONEST COST. A carve-out written in prose in
 * a README cannot be detected from the tree, so this is a list somebody has to
 * keep. It is small, it names its source, and it is better than the silence it
 * replaces — but if it grows past a handful of repositories, the answer is to
 * stop suggesting repositories rather than to grow the table.
 */
const RESTRICTED: { repo: string; prefixes: string[]; note: string }[] = [
  {
    repo: 'anthropics/skills',
    prefixes: ['skills/docx/', 'skills/pdf/', 'skills/pptx/', 'skills/xlsx/'],
    note: 'Source-available, not open source — the repository carves these four out of its Apache 2.0 licence. Check the terms before using this commercially.',
  },
];

/** The licence caveat for one file, or '' when there is none. */
export function licenceNote(repo: string, path: string): string {
  const key = repo.toLowerCase();
  for (const r of RESTRICTED) {
    if (r.repo !== key) continue;
    if (r.prefixes.some((p) => path.toLowerCase().startsWith(p))) return r.note;
  }
  return '';
}

/**
 * The files a skill points at, as paths in the repository.
 *
 * Skills in the large collections keep their instructions short and push the
 * long material one hop away — "read reference/tone-matching.md", "see
 * ../../shared/untrusted-content.md". Importing only SKILL.md kept the pointer
 * and lost the page, so an imported skill told the agent to read a file it
 * would never be given. This finds those pointers (markdown links and
 * backticked paths), resolves them against the skill's own folder, and keeps
 * only the ones that really exist in the tree — never a path outside the repo,
 * never a URL.
 */
export function referencedFiles(body: string, skillPath: string, treePaths: Set<string>, max = 6): string[] {
  const dir = skillPath.split('/').slice(0, -1);
  const found: string[] = [];
  const re = /\]\(([^)\s#]+\.md)(?:#[^)]*)?\)|`([^`\s]+\.md)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) && found.length < max) {
    const raw = m[1] || m[2];
    if (/^[a-z]+:\/\//i.test(raw) || raw.startsWith('/')) continue;
    const parts = [...dir];
    let escaped = false;
    for (const seg of raw.split('/')) {
      if (seg === '.' || seg === '') continue;
      if (seg === '..') { if (!parts.length) { escaped = true; break; } parts.pop(); continue; }
      parts.push(seg);
    }
    if (escaped) continue;
    const path = parts.join('/');
    if (path !== skillPath && treePaths.has(path) && !found.includes(path)) found.push(path);
  }
  return found;
}
