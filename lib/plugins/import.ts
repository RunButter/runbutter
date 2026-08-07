/**
 * Read a plugin directory back into something editable.
 *
 * This is the half the builder was missing. You could create a plugin and you
 * could not bring one — so the tool was useless to anyone who already had
 * skills, which is everyone worth reaching. Import makes the round trip closed:
 * export, edit somewhere else, drop it back in, keep going.
 *
 * IT IS DELIBERATELY FORGIVING ABOUT LAYOUT. The archives people actually have
 * are not always a clean `plugin.json` + `skills/`:
 *
 *   - GitHub's "Download ZIP" wraps everything in a `repo-main/` prefix.
 *   - A skills repo may have no manifest at all, just `skills/<name>/SKILL.md`.
 *   - Claude Code projects keep them under `.claude/skills/`.
 *   - Someone may drop a single SKILL.md with no directory at all.
 *
 * Rejecting any of those with "invalid plugin" would be technically defensible
 * and useless. Anything containing a SKILL.md is something we can read.
 *
 * IT IS NOT FORGIVING ABOUT PATHS. Everything that becomes a file goes through
 * `resourcePath`, so an entry called `../../.ssh/authorized_keys` cannot escape
 * the skill directory when the package is written back out.
 */

import { parseSkillMd } from '@/lib/skills/github';
import { resourcePath, skillSlug } from '@/lib/plugins/agent-plugin';

/**
 * `purpose` is REQUIRED here even though it is optional on SkillResource: the
 * importer always sets it (to '' when the SKILL.md never described the file),
 * and saying so lets this drop straight into the editor's state without a cast
 * that would quietly paper over a real undefined later.
 */
export interface ImportedResource { path: string; purpose: string; content: string }

export interface ImportedSkill {
  name: string;
  description: string;
  instructions: string;
  whenToUse: string;
  allowedTools: string;
  resources: ImportedResource[];
}

export interface ImportedPlugin {
  name: string;
  description: string;
  author: string;
  mcpUrl: string;
  hadMarketplace: boolean;
  skills: ImportedSkill[];
  /** Files we recognised but did not map onto anything editable. */
  ignored: string[];
}

/** `acme-main/skills/x/SKILL.md` -> `skills/x/SKILL.md` when EVERY entry shares a root. */
export function stripCommonRoot(paths: string[]): (p: string) => string {
  const tops = new Set(paths.map((p) => p.split('/')[0]));
  // Only strip when there is exactly one top-level segment AND at least one
  // path goes deeper — otherwise a flat archive of three files would lose its
  // first file's name.
  if (tops.size !== 1 || !paths.some((p) => p.includes('/'))) return (p) => p;
  const root = [...tops][0] + '/';
  return (p) => (p.startsWith(root) ? p.slice(root.length) : p);
}

function jsonOr<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

/**
 * Pull the two frontmatter keys the generic parser ignores.
 *
 * `parseSkillMd` reads name and description only — deliberately, because it is
 * fed untrusted GitHub content and must not become a YAML parser. The same
 * reasoning applies here, so these are two more narrow scalar reads rather than
 * a dependency.
 */
function extraFrontmatter(text: string): { whenToUse: string; allowedTools: string } {
  const out = { whenToUse: '', allowedTools: '' };
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return out;
  for (const line of fm[1].split(/\r?\n/)) {
    const m = line.match(/^(when_to_use|allowed-tools|allowed_tools)\s*:\s*(.*)$/i);
    if (!m) continue;
    const v = m[2].trim().replace(/^["']|["']$/g, '');
    if (m[1].toLowerCase() === 'when_to_use') out.whenToUse = v;
    else out.allowedTools = v;
  }
  return out;
}

export function importPlugin(files: { path: string; content: string }[]): ImportedPlugin {
  const strip = stripCommonRoot(files.map((f) => f.path));
  const entries = files.map((f) => ({ path: strip(f.path).replace(/^\.?\//, ''), content: f.content }));

  const manifest = jsonOr<Record<string, any>>(
    entries.find((e) => e.path === 'plugin.json' || e.path === '.claude-plugin/plugin.json')?.content || '',
    {},
  );
  const mcp = jsonOr<Record<string, any>>(entries.find((e) => e.path === 'mcp.json')?.content || '', {});
  const firstServer = Object.values(mcp.mcpServers || {})[0] as any;

  const skills: ImportedSkill[] = [];
  const ignored: string[] = [];
  const claimed = new Set<string>(['plugin.json', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'mcp.json']);

  // A skill is any SKILL.md, wherever it sits. Its directory is everything
  // before it, which is also where its supporting files live.
  for (const e of entries) {
    if (!/(^|\/)SKILL\.md$/i.test(e.path)) continue;
    claimed.add(e.path);

    const dir = e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : '';
    const parsed = parseSkillMd(e.content, e.path);
    const extra = extraFrontmatter(e.content);

    // Everything else in the same directory is a supporting file. The purpose
    // is recovered from the "## Additional resources" list the writer emits, so
    // an export/import round trip does not lose it.
    const resources: ImportedResource[] = [];
    for (const sib of entries) {
      if (sib === e) continue;
      const inDir = dir ? sib.path.startsWith(dir + '/') : !sib.path.includes('/');
      if (!inDir) continue;
      const rel = resourcePath(dir ? sib.path.slice(dir.length + 1) : sib.path);
      if (!rel || rel.toUpperCase() === 'SKILL.MD') continue;
      claimed.add(sib.path);
      const described = e.content.match(
        new RegExp(`^- \`${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\` — (.+)$`, 'm'),
      );
      resources.push({ path: rel, content: sib.content, purpose: described?.[1]?.trim() || '' });
    }

    skills.push({
      // The DIRECTORY name wins over the frontmatter name when they disagree,
      // because the directory is what a client actually keys on — and a
      // mismatch is the single most common defect in a hand-written skill.
      name: dir ? dir.split('/').pop()! : skillSlug(parsed.name),
      description: parsed.description,
      instructions: stripGeneratedSections(parsed.instructions),
      whenToUse: extra.whenToUse,
      allowedTools: extra.allowedTools,
      resources,
    });
  }

  for (const e of entries) if (!claimed.has(e.path)) ignored.push(e.path);

  return {
    name: String(manifest.name || ''),
    description: String(manifest.description || ''),
    author: String(manifest.author?.name || ''),
    mcpUrl: String(firstServer?.url || ''),
    hadMarketplace: entries.some((e) => e.path === '.claude-plugin/marketplace.json'),
    skills,
    ignored,
  };
}

/**
 * Remove the sections the writer GENERATES, so a round trip does not duplicate
 * them. `## Additional resources` is rebuilt from the resource list on every
 * export; leaving it in the body would stack a second copy each time somebody
 * imported and re-exported the same plugin.
 */
const GENERATED_HEADINGS = ['## Additional resources', '## Suggested tools'];

export function stripGeneratedSections(body: string): string {
  // Line-wise, not a regex. The regex version used `(?=\n## |\s*$)` as the
  // terminator, and under /m the `\s*$` alternative matches at the end of the
  // HEADING's own line — so it removed the heading and left the bullets, which
  // then collected a second heading on the next export. The round-trip test is
  // what caught it; nothing about the expression looked wrong.
  const lines = body.split('\n');
  const keep: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (GENERATED_HEADINGS.some((h) => line.trim() === h)) { skipping = true; continue; }
    // Any other h2 ends the skipped block — a generated section never contains
    // one, so the next `## ` is always somebody's own content.
    if (skipping && /^##\s/.test(line)) skipping = false;
    if (!skipping) keep.push(line);
  }
  return keep.join('\n').trim();
}
