// Pure helpers for the GitHub skill import. They live here rather than in the
// route because a Next.js route module may only export the HTTP verbs and a
// small set of config keys — exporting anything else is a type error. Being in
// lib/ also means they can be unit-tested without standing up the route.

export interface RepoRef { owner: string; repo: string; ref?: string; subdir?: string }

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

