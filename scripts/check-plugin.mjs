#!/usr/bin/env node
/**
 * Validate `plugin/` against the Agent Plugins 1.0.0 specification.
 *
 *   npm run check:plugin
 *
 * WHY A CHECKER AND NOT A GENERATOR. The plugin's skills are prose — they are
 * the product, and generating them from a template would flatten the thing that
 * makes them worth shipping. So they are written by hand and checked by this,
 * which is the same trade the migrations make: hand-written, verified for real.
 *
 * WHY IT DOES NOT FETCH THE SCHEMAS. The spec is explicit that clients "MUST
 * NOT retrieve a schema while loading a plugin", and a check that fails because
 * agent-plugins.org is having a bad afternoon is a check people start skipping.
 * The rules below are transcribed from the specification with the section
 * numbers attached, so a reader can verify them against the source.
 *
 * TWO SEVERITIES, AND THE DIFFERENCE MATTERS. Errors are SPEC violations — a
 * conforming client is entitled to reject or silently skip the plugin. Warnings
 * are house quality rules (a description that says what but never when; a body
 * with nothing in it) which the specification permits and which a skill
 * exported from someone's workspace may legitimately trip. Mixing the two made
 * this tool report a perfectly valid export as broken.
 *
 * Errors always fail. `--strict` fails on warnings too, which is what the
 * repo's own `plugin/` is held to.
 *
 *   node scripts/check-plugin.mjs [dir] [--strict]
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const ROOT = args.find((a) => !a.startsWith('--')) || 'plugin';
const SPEC = '1.0.0';
const PLUGIN_SCHEMA = `https://agent-plugins.org/schemas/${SPEC}/plugin.schema.json`;
const MCP_SCHEMA = `https://agent-plugins.org/schemas/${SPEC}/mcp.schema.json`;

let errors = 0, warnings = 0;
/** A specification violation. Always fatal. */
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); errors++; };
/** Permitted by the spec, below our bar. Fatal only under --strict. */
const warn = (m) => { console.log(`  \x1b[33m!\x1b[0m ${m}`); warnings++; };
const good = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);

// §5.5 plugin names: 1–64, [a-z0-9-.], alphanumeric at both ends, no `--`/`..`
const validPluginName = (n) =>
  typeof n === 'string' && n.length >= 1 && n.length <= 64 &&
  /^[a-z0-9][a-z0-9.-]*[a-z0-9]$|^[a-z0-9]$/.test(n) && !/--|\.\./.test(n);

// Agent Skills names: as above but hyphens only, and no periods.
const validSkillName = (n) =>
  typeof n === 'string' && n.length >= 1 && n.length <= 64 &&
  /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(n) && !/--/.test(n);

// ── Manifest (§5) ───────────────────────────────────────────────────────────
console.log('manifest');
const manifestPath = join(ROOT, 'plugin.json');
if (!existsSync(manifestPath)) {
  bad(`${manifestPath} is missing — a plugin is defined by its manifest`);
} else {
  let m;
  try { m = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch (e) { bad(`plugin.json is not valid JSON: ${e.message}`); }
  if (m) {
    if (m.$schema !== PLUGIN_SCHEMA) bad(`$schema must be exactly ${PLUGIN_SCHEMA} (got ${JSON.stringify(m.$schema)})`);
    else good('$schema is the canonical 1.0.0 identifier');

    if (!validPluginName(m.name)) bad(`name "${m.name}" breaks §5.5 (1–64 chars, a-z 0-9 - . , alphanumeric at both ends, no -- or ..)`);
    else good(`name "${m.name}"`);

    // §5.4 metadata fields are optional, but a wrong TYPE is a validation
    // failure rather than a missing nicety, so the types are checked.
    for (const [k, t] of [['version', 'string'], ['description', 'string'], ['homepage', 'string'], ['repository', 'string'], ['license', 'string']]) {
      if (k in m && typeof m[k] !== t) bad(`${k} must be a ${t}`);
    }
    if ('keywords' in m && (!Array.isArray(m.keywords) || m.keywords.some((k) => typeof k !== 'string'))) bad('keywords must be an array of strings');
    if ('author' in m && (typeof m.author !== 'object' || Array.isArray(m.author))) bad('author must be an object');
  }
}

// ── MCP configuration (§7.2) ────────────────────────────────────────────────
console.log('\nmcp.json');
const mcpPath = join(ROOT, 'mcp.json');
if (!existsSync(mcpPath)) {
  good('absent — §6.2 says a missing component location is not an error');
} else {
  let c;
  try { c = JSON.parse(readFileSync(mcpPath, 'utf8')); } catch (e) { bad(`mcp.json is not valid JSON: ${e.message}`); }
  if (c) {
    if (c.$schema !== MCP_SCHEMA) bad(`$schema must be exactly ${MCP_SCHEMA}`);
    if (!c.mcpServers || typeof c.mcpServers !== 'object') bad('mcpServers is required');
    for (const [name, s] of Object.entries(c.mcpServers || {})) {
      if (!['stdio', 'streamable-http', 'sse'].includes(s.type)) { bad(`server "${name}": unknown type ${JSON.stringify(s.type)}`); continue; }
      if (s.type === 'stdio' && !s.command) bad(`server "${name}": stdio requires command`);
      if (s.type !== 'stdio') {
        if (!s.url) bad(`server "${name}": ${s.type} requires url`);
        // §7.2: non-loopback endpoints MUST use HTTPS, and the URL must carry
        // no user information and no fragment.
        else {
          try {
            const u = new URL(s.url);
            const loopback = u.hostname === 'localhost' || /^127\./.test(u.hostname) || u.hostname === '[::1]';
            if (u.protocol !== 'https:' && !loopback) bad(`server "${name}": non-loopback url must be https`);
            if (u.username || u.password) bad(`server "${name}": url must not contain user information`);
            if (u.hash) bad(`server "${name}": url must not contain a fragment`);
            else good(`server "${name}" → ${s.type} ${s.url}`);
          } catch { bad(`server "${name}": url is not a valid absolute URL`); }
        }
      }
      // §9.2 / §7.2: headers and env are visible package data. A credential here
      // is committed to git, which is the whole reason the spec forbids it.
      const suspect = /authorization|api[-_]?key|token|secret|bearer|password/i;
      for (const k of Object.keys(s.headers || {})) {
        if (suspect.test(k)) bad(`server "${name}": header "${k}" looks like a credential — §7.2 forbids secrets in headers`);
      }
      for (const k of Object.keys(s.env || {})) {
        if (k === 'PLUGIN_ROOT' || k === 'PLUGIN_DATA') bad(`server "${name}": env must not define the reserved ${k}`);
        if (suspect.test(k)) bad(`server "${name}": env "${k}" looks like a credential — §9.2 forbids secrets in env`);
      }
    }
  }
}

// ── Skills (§7.1 + the Agent Skills specification) ──────────────────────────
console.log('\nskills');
const skillsDir = join(ROOT, 'skills');
if (!existsSync(skillsDir)) {
  good('absent — not an error');
} else if (!statSync(skillsDir).isDirectory()) {
  bad('skills exists but is not a directory (§6.2)');
} else {
  const dirs = readdirSync(skillsDir).filter((d) => statSync(join(skillsDir, d)).isDirectory());
  if (!dirs.length) bad('skills/ has no skill directories');
  for (const dir of dirs) {
    const file = join(skillsDir, dir, 'SKILL.md');
    if (!existsSync(file)) { bad(`skills/${dir} has no SKILL.md — §7.1 requires one per skill directory`); continue; }

    if (!validSkillName(dir)) { bad(`skills/${dir}: directory name is not a valid skill name`); continue; }

    const text = readFileSync(file, 'utf8');
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!fm) { bad(`skills/${dir}: no YAML frontmatter`); continue; }

    const read = (key) => {
      const m = fm[1].match(new RegExp(`^${key}\\s*:\\s*(.*)$`, 'mi'));
      return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
    };
    const name = read('name');
    const description = read('description');

    if (!name) bad(`skills/${dir}: frontmatter is missing the required "name"`);
    // The rule people actually trip over: the frontmatter name MUST equal the
    // directory name, and a mismatch makes the client skip the skill silently.
    else if (name !== dir) bad(`skills/${dir}: frontmatter name "${name}" must equal the directory name "${dir}"`);

    if (!description) bad(`skills/${dir}: frontmatter is missing the required "description"`);
    else if (description.length > 1024) bad(`skills/${dir}: description is ${description.length} chars (max 1024)`);
    // Not a spec rule, a quality one: the description is how a model decides
    // whether the skill applies, and one that only says WHAT it does leaves the
    // model guessing about WHEN.
    else if (!/\buse (when|for|if)\b/i.test(description)) {
      warn(`skills/${dir}: description says what the skill does but not when to use it`);
    }

    const body = text.slice(fm[0].length).trim();
    if (body.length < 40) warn(`skills/${dir}: body is very short — a model has little to act on`);
    if (!errors && !warnings) good(`skills/${dir}`);
  }
  if (dirs.length) console.log(`  ${dirs.length} skill(s) checked`);
}

const parts = [];
if (errors) parts.push(`\x1b[31m${errors} spec violation(s)\x1b[0m`);
if (warnings) parts.push(`\x1b[33m${warnings} warning(s)\x1b[0m${STRICT ? ' (fatal under --strict)' : ''}`);
console.log(parts.length
  ? `\n${parts.join(', ')}`
  : `\n\x1b[32m${ROOT}/ conforms to Agent Plugins ${SPEC}\x1b[0m`);
process.exit(errors || (STRICT && warnings) ? 1 : 0);
