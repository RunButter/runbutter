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

/**
 * A file that lives BESIDE SKILL.md in the same skill directory.
 *
 * This is the second level of progressive disclosure and the thing that
 * separates a real skill from a long prompt. SKILL.md is read when the skill
 * fires; a resource is read only if the model decides it needs it — so an API
 * reference or a table of examples costs nothing until the moment it is
 * relevant, and can therefore be as long as it needs to be.
 *
 * `purpose` is not decoration. The client's docs are explicit that supporting
 * files must be referenced FROM SKILL.md so the model knows what each one
 * contains and when to load it; a file nobody described is a file nobody opens.
 * That listing is generated from this field rather than left to the author.
 */
export interface SkillResource {
  /** Relative to the skill directory: `reference.md`, `scripts/build.sh`. */
  path: string;
  content: string;
  /** One line: what is in it and when to read it. */
  purpose?: string;
}

export interface SkillSource {
  name: string;
  /**
   * The readable name, when `name` has already been reduced to a slug.
   *
   * `buildPlugin` calls `skillMd({ ...s, name: slug })` — it MUST, because the
   * directory decides the frontmatter name and a deduped skill gets a `-2`
   * suffix that only it knows about. That overwrite is also what silently
   * destroyed the human title: by the time skillMd saw the skill, the readable
   * name was gone and there was nothing left to write.
   */
  title?: string;
  description: string;
  instructions: string;
  /** A UI hint on our side, never a grant — rendered as prose, not frontmatter. */
  suggested_tools?: string[];
  /**
   * Extra frontmatter for clients that read it. Optional everywhere: the
   * portable spec requires only name and description, and a client that does
   * not know a key ignores it, so these cost nothing in a client that does not
   * support them.
   */
  when_to_use?: string;
  /** A REAL pre-approval in Claude Code, unlike suggested_tools. */
  allowed_tools?: string[];
  resources?: SkillResource[];
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

/** `a, b` or `a b` -> ['a','b']. Accepts whatever someone types. */
export function parseToolList(raw: string): string[] {
  return (raw || '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

/** Resource paths are relative and must stay inside the skill directory. */
export function resourcePath(raw: string): string {
  const parts = (raw || '')
    .replace(/\\/g, '/')
    .split('/')
    // `..` and absolute roots would write outside the skill — in a zip that is
    // a path-traversal entry, which some extractors happily honour.
    .filter((p) => p && p !== '.' && p !== '..')
    .map((p) => p.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+/, ''))
    .filter(Boolean);
  return parts.join('/');
}

export function skillMd(skill: SkillSource): string {
  const name = skillSlug(skill.name);
  // Required, 1–1024 chars, and it is what a model reads to decide whether the
  // skill is relevant. An empty one makes the skill invisible in practice, so
  // it falls back to the title rather than being omitted.
  const description = (skill.description || skill.name || name).slice(0, 1024);

  const tools = (skill.suggested_tools || []).filter(Boolean);
  const allowed = (skill.allowed_tools || []).filter(Boolean);
  const whenToUse = (skill.when_to_use || '').trim();
  const body = (skill.instructions || '').trim();
  const resources = (skill.resources || []).filter((r) => resourcePath(r.path));

  const front = [
    '---',
    `name: ${yamlString(name)}`,
    // THE HUMAN NAME, WHICH `name` CANNOT CARRY. The spec requires frontmatter
    // `name` to equal the directory name, so "Invoice reminder tone" is written
    // as `invoice-reminder-tone` and the readable title existed nowhere in the
    // file. Export a skill, import it back, and it had silently renamed itself
    // to its own slug — a round trip that loses data, in both this builder and
    // the public one. An extra frontmatter key is legal YAML and conforming
    // clients ignore what they do not know, so this costs nothing and is only
    // written when it actually differs from the slug.
    (skill.title || skill.name) && (skill.title || skill.name) !== name ? `title: ${yamlString(skill.title || skill.name)}` : '',
    `description: ${yamlString(description)}`,
    // Optional keys are OMITTED when empty rather than written blank. A present
    // key with an empty value is a value, and a client reading `allowed-tools:`
    // as "an empty allow list" would strip every tool instead of not caring.
    whenToUse ? `when_to_use: ${yamlString(whenToUse)}` : '',
    allowed.length ? `allowed-tools: ${yamlString(allowed.join(' '))}` : '',
    '---',
  ].filter(Boolean);

  return [
    ...front,
    '',
    body || `# ${skill.name}\n\n${description}`,
    // The docs are explicit that supporting files have to be described FROM
    // SKILL.md, because that description is the only thing telling the model
    // what is in a file and whether this is the moment to open it. Generated
    // rather than left to the author: an undescribed resource is dead weight
    // in the package, and the failure is silent.
    resources.length
      ? '\n## Additional resources\n\n' + resources
          .map((r) => `- \`${resourcePath(r.path)}\` — ${r.purpose?.trim() || 'read when relevant to the task.'}`)
          .join('\n') + '\n'
      : '',
    // Prose, deliberately, not frontmatter: in RunButter `suggested_tools` is a
    // hint for the picker and never a grant, and a client that read it as a
    // capability list would be reading it as something it has never been.
    tools.length ? `\n## Suggested tools\n\nThis skill tends to use: ${tools.join(', ')}.\n` : '',
  ].join('\n');
}

/**
 * `.claude-plugin/marketplace.json` — what makes a package INSTALLABLE rather
 * than merely well-formed.
 *
 * A conformant Agent Plugin directory is something you unzip and point a client
 * at. A marketplace manifest is what lets someone run
 * `/plugin marketplace add <repo>` and then `/plugin install <name>@<market>`,
 * which is how every widely-used skill collection is actually distributed. It
 * costs one small file and it is the difference between "here is a zip" and
 * "here is a one-line install".
 *
 * Required by the schema: `name` (kebab-case), `owner.name`, and `plugins[]`,
 * each entry needing `name` and `source`. `source: './'` points at the
 * marketplace root, which is the directory containing `.claude-plugin/` — so a
 * single-plugin repository IS its own marketplace with no nesting.
 */
export function marketplaceJson(input: ManifestInput & { ownerName?: string }): string {
  const name = pluginSlug(input.name);
  return JSON.stringify({
    name: `${name}-marketplace`,
    owner: { name: input.ownerName || input.author?.name || name },
    plugins: [{
      name,
      source: './',
      ...(input.description ? { description: input.description } : {}),
      ...(input.version ? { version: input.version } : {}),
      ...(input.author?.name ? { author: { name: input.author.name } } : {}),
    }],
  }, null, 2) + '\n';
}

/** The whole package, as files, ready for a zip or a filesystem write. */
export function buildPlugin(opts: {
  manifest: ManifestInput;
  skills?: SkillSource[];
  mcpUrl?: string;
  extraFiles?: PluginFile[];
  /** Emit `.claude-plugin/marketplace.json` so it installs in one command. */
  marketplace?: boolean;
}): PluginFile[] {
  const files: PluginFile[] = [{ path: 'plugin.json', content: manifestJson(opts.manifest) }];
  if (opts.marketplace) files.push({ path: '.claude-plugin/marketplace.json', content: marketplaceJson(opts.manifest) });
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
    files.push({ path: `skills/${slug}/SKILL.md`, content: skillMd({ ...s, name: slug, title: s.title || s.name }) });

    // Supporting files land beside SKILL.md in the same directory. Paths are
    // sanitised (see resourcePath) and de-duplicated: two entries writing the
    // same path would produce two zip members with one name, and which one an
    // extractor keeps is anyone's guess.
    const seen = new Set<string>(['SKILL.md']);
    for (const r of s.resources || []) {
      const path = resourcePath(r.path);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      files.push({ path: `skills/${slug}/${path}`, content: r.content ?? '' });
    }
  }

  return files.concat(opts.extraFiles || []);
}
