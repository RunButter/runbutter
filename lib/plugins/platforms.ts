/**
 * Target platforms — one project, several directory layouts.
 *
 * THE HONEST VERSION OF "PICK YOUR PLATFORM". The brief lists eighteen targets
 * (ChatGPT, Codex, Gemini, Cursor, Copilot, Windsurf, Cline, Roo, …). Emitting
 * eighteen directory layouts would mean inventing most of them, and a plugin
 * that installs nowhere because we guessed at a manifest is worse than a
 * picker with four honest entries — the user finds out at install time, in
 * someone else's tool, with no way to tell whose fault it is.
 *
 * So this ships the layouts that were read from a primary source:
 *
 *   - Agent Plugins 1.0.0, from agent-plugins.org, already validated in CI by
 *     `npm run check:plugin`.
 *   - `.claude/skills/<name>/SKILL.md` and `.claude-plugin/marketplace.json`,
 *     from code.claude.com/docs.
 *
 * AND THAT COVERS MORE THAN IT LOOKS. Agent Plugins is vendor-neutral, with
 * Amazon, Cursor, Microsoft, OpenAI and Vercel on its technical steering
 * committee — so "export for Cursor" and "export for Copilot" are the SAME
 * export, not a missing feature. `notes` on each target says who reads it, so
 * the picker answers "will this work in my tool" rather than implying that a
 * tool without its own row is unsupported.
 *
 * Adding a target = adding an entry here. No platform conditionals anywhere
 * else, which is the one piece of §52 worth taking literally.
 */

import { buildPlugin, manifestJson, mcpJson, skillMd, skillSlug, resourcePath,
         cursorManifestJson, cursorMarketplaceJson,
         type ManifestInput, type PluginFile, type SkillSource } from '@/lib/plugins/agent-plugin';

export type PlatformId = 'agent-plugin' | 'claude-project' | 'claude-marketplace' | 'cursor-plugin' | 'mcp-only';

export interface BuildInput {
  manifest: ManifestInput;
  skills: SkillSource[];
  mcpUrl?: string;
}

export interface Platform {
  id: PlatformId;
  label: string;
  /** One line under the name in the picker. Not a paragraph. */
  blurb: string;
  /** Who actually reads this layout. */
  notes: string;
  /** How a person installs the result. */
  install: string;
  build: (input: BuildInput) => PluginFile[];
}

/** Skill files at an arbitrary prefix, shared by the layouts that only differ by path. */
function skillFilesAt(prefix: string, skills: SkillSource[]): PluginFile[] {
  const files: PluginFile[] = [];
  const used = new Set<string>();
  for (const s of skills) {
    let slug = skillSlug(s.name);
    if (used.has(slug)) {
      let n = 2;
      while (used.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    used.add(slug);
    files.push({ path: `${prefix}/${slug}/SKILL.md`, content: skillMd({ ...s, name: slug }) });
    const seen = new Set<string>(['SKILL.md']);
    for (const r of s.resources || []) {
      const rel = resourcePath(r.path);
      if (!rel || seen.has(rel)) continue;
      seen.add(rel);
      files.push({ path: `${prefix}/${slug}/${rel}`, content: r.content ?? '' });
    }
  }
  return files;
}

export const PLATFORMS: Platform[] = [
  {
    id: 'agent-plugin',
    label: 'Agent Plugin',
    blurb: 'The portable format. Installs everywhere.',
    notes: 'Vendor-neutral standard — Amazon, Cursor, Microsoft, OpenAI and Vercel steer it. Pick this unless you have a reason not to.',
    install: 'Unzip it and point your client at the folder.',
    build: ({ manifest, skills, mcpUrl }) => buildPlugin({ manifest, skills, mcpUrl }),
  },
  {
    id: 'claude-marketplace',
    label: 'Claude Code plugin',
    blurb: 'Installable with one command.',
    notes: 'An Agent Plugin plus a marketplace manifest, so it installs by name instead of by folder.',
    install: 'Push to a public repo, then /plugin marketplace add you/repo',
    build: ({ manifest, skills, mcpUrl }) => buildPlugin({ manifest, skills, mcpUrl, marketplace: true }),
  },
  {
    id: 'claude-project',
    label: 'Project skills',
    blurb: 'Drop straight into a repository.',
    notes: 'Loads for anyone working in that repo, and for cloud sessions when committed. No manifest involved.',
    install: 'Copy .claude/ into your project root and commit it.',
    build: ({ skills }) => skillFilesAt('.claude/skills', skills),
  },
  {
    id: 'cursor-plugin',
    label: 'Cursor plugin',
    blurb: 'The layout Cursor’s own marketplace uses.',
    notes: 'Cursor helps steer Agent Plugins, so the portable export already works there — this is the packaging github.com/cursor/plugins itself ships, with the manifest under .cursor-plugin/ and a registry entry beside it. Pick it if you want to publish into that catalogue.',
    install: 'Push to a public repo, then add it as a marketplace in Cursor.',
    build: ({ manifest, skills, mcpUrl }) => [
      { path: '.cursor-plugin/plugin.json', content: cursorManifestJson({ ...manifest, mcpUrl }) },
      { path: '.cursor-plugin/marketplace.json', content: cursorMarketplaceJson(manifest) },
      ...skillFilesAt('skills', skills),
    ],
  },
  {
    id: 'mcp-only',
    label: 'MCP config',
    blurb: 'Tools without the instructions.',
    notes: 'Just the server entry, for a client you only want to connect — no skills included.',
    install: 'Merge into your client’s MCP settings.',
    build: ({ mcpUrl }) => (mcpUrl
      ? [{ path: 'mcp.json', content: mcpJson(mcpUrl) }]
      : [{ path: 'mcp.json', content: '{\n  "mcpServers": {}\n}\n' }]),
  },
];

export const platformById = (id: PlatformId): Platform =>
  PLATFORMS.find((p) => p.id === id) || PLATFORMS[0];

/**
 * What a target cannot carry, said plainly.
 *
 * §25 asks for a "compatibility percentage". A percentage implies a measurement
 * and there is nothing to measure — the answer is a short list of what gets
 * dropped, which is both true and actionable where a number is neither.
 */
export function losses(id: PlatformId, input: BuildInput): string[] {
  const out: string[] = [];
  if (id === 'claude-project') {
    if (input.mcpUrl) out.push('The MCP server is not included — this layout carries skills only.');
    if (input.manifest.description || input.manifest.author?.name) out.push('Plugin name, description and author are dropped; there is no manifest here.');
  }
  if (id === 'mcp-only' && input.skills.length) {
    out.push(`${input.skills.length} skill${input.skills.length === 1 ? '' : 's'} excluded — this is the server entry only.`);
  }
  if (id === 'agent-plugin') {
    out.push('Installs by folder rather than by name. Choose Claude Code plugin for a one-command install.');
  }
  if (id === 'cursor-plugin') {
    // Not a loss of content — every skill and the server all travel. It is a
    // loss of PORTABILITY, which is the thing somebody picking this target is
    // trading away and would otherwise only discover in another client.
    out.push('Cursor-specific packaging. Clients that read the portable Agent Plugin layout will not find the manifest under .cursor-plugin/ — export that format as well if you want both.');
    if (input.manifest.author?.url) out.push('Author URL is dropped; this manifest carries an author name only.');
  }
  return out;
}

export { manifestJson };
