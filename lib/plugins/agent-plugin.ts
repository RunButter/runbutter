/**
 * Agent Plugins 1.0.0 — the package format, in one place.
 *
 * WHAT THIS IS. Agent Plugins is a vendor-neutral standard (TSC: Amazon,
 * Cursor, Microsoft, OpenAI, Vercel) for packaging agent extensions. A plugin
 * is a directory:
 *
 *   my-plugin/
 *   ├── plugin.json        manifest — only $schema and name are required
 *   ├── skills/<name>/SKILL.md
 *   └── mcp.json           stdio | streamable-http | sse servers
 *
 * WHY IT LIVES HERE RATHER THAN IN THE ROUTE. Two things emit plugins: the
 * script that generates the repo's own `plugin/` directory, and the export
 * endpoint that packages a workspace's skills. One builder means the published
 * plugin and an exported one cannot drift into disagreeing about the format,
 * and the conformance script can check both with the same rules.
 *
 * ── THE ONE THING TO KNOW BEFORE USING THIS ─────────────────────────────────
 * Spec §7.2: "Header values are visible package data, not a portable secret
 * mechanism. Plugins MUST NOT embed credentials or other secrets in headers",
 * and clients "MUST NOT perform placeholder or environment-variable expansion
 * in url, header names, or header values". Agent Plugins v1 also "defines no
 * OAuth configuration or portable credential-reference fields".
 *
 * So an exported plugin CANNOT carry a working API key, and this module has no
 * way to put one in. The user pastes their own key into the installed plugin,
 * or their client handles authorization itself. Anything that looks like a
 * shortcut around that is a credential in a file people commit to git.
 */

export const SPEC_VERSION = '1.0.0';
export const PLUGIN_SCHEMA = `https://agent-plugins.org/schemas/${SPEC_VERSION}/plugin.schema.json`;
export const MCP_SCHEMA = `https://agent-plugins.org/schemas/${SPEC_VERSION}/mcp.schema.json`;

export interface PluginFile { path: string; content: string }

export interface SkillSource {
  name: string;
  description: string;
  instructions: string;
  /** A UI hint on our side, never a grant — rendered as prose, not frontmatter. */
  suggested_tools?: string[];
}

export interface ManifestInput {
  name: string;
  version?: string;
  description?: string;
  author?: { name?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
}

// ── Names ───────────────────────────────────────────────────────────────────

/**
 * Skill directory names and skill frontmatter names follow the Agent Skills
 * rules: 1–64 chars, lowercase alphanumerics with SINGLE hyphen separators, no
 * leading or trailing hyphen — and the frontmatter `name` MUST equal the
 * directory name. Both come from this function so they cannot disagree, which
 * is the failure a client reports as "invalid skill" with no further clue.
 */
export function skillSlug(raw: string): string {
  const s = (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');          // a trailing hyphen can reappear after the slice
  return s || 'skill';
}

/** Plugin names allow periods as well, and the same start/end and repetition rules. */
export function pluginSlug(raw: string): string {
  const s = (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    // Collapse ANY run of separators to a single one, not just repeats of the
    // same character. Handling `--` and `..` separately left `.-` untouched, so
    // "Acme Co. Skills" came out as `acme-co.-skills`: a period and a hyphen
    // adjacent, which is not a separator anyone typed and reads as a typo in
    // every install prompt that shows the name. The first character of the run
    // wins, so "Co." keeps its period and a plain space stays a hyphen.
    .replace(/[-.]{2,}/g, (m) => m[0])
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64)
    .replace(/[-.]+$/g, '');
  return s || 'plugin';
}

/** Spec §5.5, as a predicate — used by the conformance check and the tests. */
export function isValidPluginName(name: string): boolean {
  return /^[a-z0-9](?:[a-z0-9]|-(?!-)|\.(?!\.))*[a-z0-9]$|^[a-z0-9]$/.test(name) && name.length <= 64;
}

export function isValidSkillName(name: string): boolean {
  return /^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$|^[a-z0-9]$/.test(name) && name.length <= 64;
}

// ── Emitters ────────────────────────────────────────────────────────────────

/**
 * YAML scalars, double-quoted and escaped.
 *
 * A skill called `Invoices: overdue` produces `name: Invoices: overdue`, which
 * is a YAML parse error, and the client's only available response is to skip
 * the skill. Newlines get folded to spaces for the same reason — a description
 * pasted from a doc arrives with them.
 */
function yamlString(v: string): string {
  const flat = String(v ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
  return `"${flat.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function manifestJson(input: ManifestInput): string {
  // $schema first and name second: the spec requires both, and a human opening
  // the file should see what it is and what it is called without scrolling.
  const manifest: Record<string, unknown> = { $schema: PLUGIN_SCHEMA, name: pluginSlug(input.name) };
  if (input.version) manifest.version = input.version;
  if (input.description) manifest.description = input.description;
  if (input.author?.name) manifest.author = input.author;
  if (input.homepage) manifest.homepage = input.homepage;
  if (input.repository) manifest.repository = input.repository;
  if (input.license) manifest.license = input.license;
  if (input.keywords?.length) manifest.keywords = input.keywords;
  return JSON.stringify(manifest, null, 2) + '\n';
}

/**
 * `mcp.json` for one Streamable HTTP server — which is what /api/mcp is.
 *
 * No `headers`. See the note at the top of this file: a key here is a
 * credential in a file, and the spec forbids it outright.
 */
export function mcpJson(url: string, serverName = 'runbutter'): string {
  return JSON.stringify({
    $schema: MCP_SCHEMA,
    mcpServers: { [serverName]: { type: 'streamable-http', url } },
  }, null, 2) + '\n';
}

export function skillMd(skill: SkillSource): string {
  const name = skillSlug(skill.name);
  // Required, 1–1024 chars, and it is what a model reads to decide whether the
  // skill is relevant. An empty one makes the skill invisible in practice, so
  // it falls back to the title rather than being omitted.
  const description = (skill.description || skill.name || name).slice(0, 1024);

  const tools = (skill.suggested_tools || []).filter(Boolean);
  const body = (skill.instructions || '').trim();

  return [
    '---',
    `name: ${yamlString(name)}`,
    `description: ${yamlString(description)}`,
    '---',
    '',
    body || `# ${skill.name}\n\n${description}`,
    // Prose, deliberately, not frontmatter: in RunButter `suggested_tools` is a
    // hint for the picker and never a grant, and a client that read it as a
    // capability list would be reading it as something it has never been.
    tools.length ? `\n## Suggested tools\n\nThis skill tends to use: ${tools.join(', ')}.\n` : '',
  ].join('\n');
}

/** The whole package, as files, ready for a zip or a filesystem write. */
export function buildPlugin(opts: {
  manifest: ManifestInput;
  skills?: SkillSource[];
  mcpUrl?: string;
  extraFiles?: PluginFile[];
}): PluginFile[] {
  const files: PluginFile[] = [{ path: 'plugin.json', content: manifestJson(opts.manifest) }];
  if (opts.mcpUrl) files.push({ path: 'mcp.json', content: mcpJson(opts.mcpUrl) });

  // Two skills that slug to the same directory would silently overwrite each
  // other — "Invoice tone" and "invoice-tone" are different rows and the same
  // path. Suffixing keeps both, and keeps the frontmatter name equal to the
  // directory name, which the skills spec requires.
  const used = new Set<string>();
  for (const s of opts.skills || []) {
    let slug = skillSlug(s.name);
    if (used.has(slug)) {
      let n = 2;
      while (used.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    used.add(slug);
    files.push({ path: `skills/${slug}/SKILL.md`, content: skillMd({ ...s, name: slug }) });
  }

  return files.concat(opts.extraFiles || []);
}
