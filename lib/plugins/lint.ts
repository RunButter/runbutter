/**
 * The skill linter — every check that can be made without running anything.
 *
 * WHAT THIS IS FOR. A skill that is *valid* and a skill that *works* are two
 * different things, and only the first one has a specification behind it. A
 * client will happily load a skill whose description never says when to use it,
 * whose instructions contradict themselves on line 30, and which never states
 * what its output should look like — and the author's only signal that anything
 * is wrong is that the model quietly ignores it. This is the file that says so
 * out loud.
 *
 * TWO RULES THIS FILE HOLDS ITSELF TO.
 *
 * 1. EVERY CHECK IS STRUCTURAL, NEVER SEMANTIC. "Is this instruction good?" has
 *    no test; "does this skill state an output format anywhere?" does. Nothing
 *    here tries to judge whether prose is *correct*, because a linter that
 *    guesses is a linter people learn to click past — and once they do, it costs
 *    them the findings that were real. The same reasoning keeps prompt-injection
 *    detection out of `scan.ts`.
 *
 * 2. A MISSED FINDING BEATS A FALSE ONE. Where a rule could go either way it is
 *    written to fire less. The contradiction detector below is the clearest
 *    case: it compares content-word SETS rather than trying to understand a
 *    sentence, so it catches "Always include the invoice number" against "Never
 *    include invoice numbers" and stays silent on everything it is unsure about.
 *
 * Severities are three because two was not enough. An `error` breaks the spec or
 * makes the skill inert; a `warning` is a thing that will cost the author later;
 * an `idea` is worth doing and fine to ignore. Only the first two should ever
 * feel urgent, and the score weights them accordingly.
 */

import { skillSlug, pluginSlug, isValidSkillName, type SkillSource } from '@/lib/plugins/agent-plugin';
import type { BuildInput } from '@/lib/plugins/platforms';
import { scanFiles, type Finding as SecretFinding } from '@/lib/plugins/scan';

export type LintSeverity = 'error' | 'warning' | 'idea';

/**
 * The eight things a skill is scored on. These are the §10 categories with one
 * rename: what the brief calls "test coverage" is called `verification` here,
 * because no test has been run and a number labelled coverage when nothing was
 * covered is the same fabrication as an invented star rating.
 */
export type LintCategory =
  | 'specification' | 'activation' | 'instructions' | 'examples'
  | 'output' | 'security' | 'verification' | 'efficiency';

export interface LintFinding {
  severity: LintSeverity;
  category: LintCategory;
  /** The skill this is about, or null when it is about the package. */
  skill: string | null;
  message: string;
  /** What to do instead. Omitted when the message already says it. */
  fix?: string;
}

export const CATEGORY_LABEL: Record<LintCategory, string> = {
  specification: 'Specification',
  activation: 'Activation',
  instructions: 'Instructions',
  examples: 'Examples',
  output: 'Output contract',
  security: 'Security',
  verification: 'Verification',
  efficiency: 'Efficiency',
};

// ── Text helpers ────────────────────────────────────────────────────────────

/** Roughly what a tokenizer would say. Four characters per token is the usual
 *  English approximation; it is an estimate and is labelled as one everywhere
 *  it surfaces, because the real number depends on a tokenizer we do not ship. */
export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

/**
 * Which files are read on EVERY run, and which only when the model asks.
 *
 * Lives here rather than in the component because the two figures are only
 * meaningful against each other: a predicate that quietly misses the supporting
 * files reports "0 tokens on demand" and makes the whole point of them
 * invisible. It matches every layout the platform adapters emit — `skills/…`
 * for a plugin, `.claude/skills/…` for a project.
 */
export const isPerRunFile = (path: string): boolean => /(?:^|\/)SKILL\.md$/.test(path);
export const isSkillFile = (path: string): boolean =>
  /(?:^|\/)skills\//.test(path) || path.startsWith('.claude/skills/');

/** `{ perRunChars, onDemandChars }` for a built package. */
export function measureFiles(files: { path: string; content: string }[]) {
  let perRunChars = 0, onDemandChars = 0;
  for (const f of files) {
    if (isPerRunFile(f.path)) perRunChars += f.content.length;
    else if (isSkillFile(f.path)) onDemandChars += f.content.length;
  }
  return { perRunChars, onDemandChars };
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or',
  'is', 'are', 'be', 'it', 'its', 'this', 'that', 'these', 'those', 'your',
  'you', 'we', 'our', 'their', 'they', 'any', 'all', 'every', 'each', 'when',
]);

/** Content words, singularised crudely. Used only for comparing two lines to
 *  each other — never shown to anyone, so a wrong stem costs nothing. */
function contentWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/** Instruction-shaped lines: bullets and sentences, headings and fences dropped. */
function directiveLines(body: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const raw of (body || '').split('\n')) {
    const line = raw.trim();
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence || !line || /^#{1,6}\s/.test(line) || /^[-–—]{3,}$/.test(line)) continue;
    out.push(line.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '').trim());
  }
  return out.filter(Boolean);
}

/**
 * Split a directive into polarity and predicate, or return null.
 *
 * Deliberately narrow. It matches the handful of openers that unambiguously
 * state a rule — always/never/must/do not/avoid — and gives up on everything
 * else. A sentence that merely describes behaviour is not a directive, and
 * treating it as one is how a contradiction detector starts inventing conflicts.
 */
function polarity(line: string): { sign: 1 | -1; predicate: string[] } | null {
  const s = line.toLowerCase().replace(/^(?:you\s+(?:should|must)\s+)/, '');
  const neg = s.match(/^(?:never|do not|don't|must not|mustn't|avoid|no longer|do NOT)\s+(.{4,})$/i);
  if (neg) return { sign: -1, predicate: contentWords(neg[1]) };
  const pos = s.match(/^(?:always|must|make sure (?:to|you)|be sure to)\s+(.{4,})$/i);
  if (pos) return { sign: 1, predicate: contentWords(pos[1]) };
  return null;
}

// ── Presence tests ──────────────────────────────────────────────────────────
// Each of these answers "does the skill contain X anywhere", where X has a
// recognisable shape. False negatives are safe (we stay quiet); the patterns are
// broad for that reason.

const HAS_EXAMPLE = /^#{1,6}\s.*\bexamples?\b|^>\s|^```/im;
const HAS_OUTPUT_CONTRACT =
  /^#{1,6}\s.*\b(output|format|response|deliverable|schema|template|report)\b|```|\b(respond|reply|return|output|answer|produce)\s+(?:with|in|as)\s+(?:a\s+|an\s+|the\s+)?(json|yaml|markdown|table|list|csv|bullet|paragraph|sentence|xml|format|object|array)/im;
const HAS_VERIFICATION =
  /^#{1,6}\s.*\b(verif|check|validate|red flags?|before you (?:finish|report|ship))\b|- \[ \]|\bbefore reporting\b/im;
// Broad on purpose. The first version anchored on "if you cannot", which missed
// "If a number cannot be computed, say the number is missing" — a textbook
// failure path, in one of our own templates. A false negative here means telling
// an author to add something they already wrote, which is the one outcome that
// makes a linter feel stupid.
const HAS_FAILURE_PATH =
  /\b(?:if\b[^.\n]{0,48}\b(?:cannot|can't|fails?|failed|missing|unavailable|unknown|empty|do not know|don't know|unsure)|on failure|when (?:this|it) fails|otherwise say|say so\b|report it as missing|do not (?:guess|estimate|invent))/i;
const HAS_NEGATIVE_TRIGGER =
  /\b(not for|do not use (?:this|it) (?:for|when)|don't use (?:this|it) (?:for|when)|instead of|rather than|this is not)\b/i;

/** The description heuristic CI already applies, kept identical on purpose so
 *  the builder tells you exactly what `npm run check:plugin` would. */
const SAYS_WHEN = /\buse (when|for|if)\b/i;

// ── Rules ───────────────────────────────────────────────────────────────────

function lintSkill(s: SkillSource, out: LintFinding[]) {
  const name = s.name?.trim() || 'Untitled skill';
  const add = (severity: LintSeverity, category: LintCategory, message: string, fix?: string) =>
    out.push({ severity, category, skill: name, message, fix });

  const slug = skillSlug(s.name || '');
  const description = (s.description || '').trim();
  const body = (s.instructions || '').trim();
  const whenToUse = (s.when_to_use || '').trim();
  const resources = (s.resources || []).filter((r) => (r.path || '').trim());
  // Activation and examples can be satisfied from anywhere the model will read,
  // so the tests run over the whole skill rather than the body alone.
  const everything = [description, whenToUse, body, ...resources.map((r) => r.content || '')].join('\n');

  // — specification —
  if (!isValidSkillName(slug)) {
    add('error', 'specification', `“${name}” cannot be turned into a valid directory name.`,
      'Skill names are lowercase letters, digits and single hyphens.');
  } else if (slug !== (s.name || '').trim().toLowerCase().replace(/\s+/g, '-')) {
    add('idea', 'specification', `“${name}” becomes skills/${slug}/ — the rest of the name is dropped.`);
  }

  if (!description) {
    add('error', 'specification', `“${name}” has no description.`,
      'That one line is what a model reads to decide whether the skill applies. Without it the skill is effectively invisible.');
  } else if (description.length > 1024) {
    add('error', 'specification', `“${name}” description is ${description.length} characters; the limit is 1024.`);
  }

  // — activation —
  if (description && !SAYS_WHEN.test(description) && !whenToUse) {
    add('warning', 'activation', `“${name}” says what it does but not when to use it.`,
      'Add “Use when…” to the description — that phrase is what makes a model reach for it at the right moment.');
  }
  if (!HAS_NEGATIVE_TRIGGER.test(everything)) {
    add('idea', 'activation', `“${name}” never says what it is NOT for.`,
      'One “Not for: …” line stops a skill firing on the neighbouring task it half-matches.');
  }

  // — instructions —
  if (!body) {
    add('error', 'instructions', `“${name}” has no instructions.`);
  } else if (body.length < 40) {
    add('warning', 'instructions', `“${name}” has very little for a model to act on.`);
  } else {
    const lines = directiveLines(body);

    // Contradictions. Compared as content-word SETS, so a rule stated once
    // positively and once negatively is caught however it was phrased, and two
    // rules that merely share vocabulary are not.
    const seen = new Map<string, { sign: 1 | -1; line: string }>();
    for (const line of lines) {
      const p = polarity(line);
      if (!p || p.predicate.length < 2) continue;
      const key = [...new Set(p.predicate)].sort().join(' ');
      const prev = seen.get(key);
      if (prev && prev.sign !== p.sign) {
        add('warning', 'instructions', `“${name}” contradicts itself: “${clip(prev.line)}” against “${clip(line)}”.`,
          'A model given both will follow one of them and you cannot predict which.');
      } else if (!prev) {
        seen.set(key, { sign: p.sign, line });
      }
    }

    // Duplicates. Common after a generation pass, and every repeat is tokens
    // spent on every single run of the skill.
    const norm = new Map<string, number>();
    for (const line of lines) {
      if (line.length < 25) continue;              // short lines legitimately repeat
      const key = contentWords(line).join(' ');
      norm.set(key, (norm.get(key) || 0) + 1);
    }
    const repeats = [...norm.values()].filter((n) => n > 1).length;
    if (repeats) {
      add('idea', 'instructions', `“${name}” says the same thing twice in ${repeats} place${repeats === 1 ? '' : 's'}.`);
    }

    if (body.length > 800 && !/^#{1,6}\s/m.test(body)) {
      add('idea', 'instructions', `“${name}” is ${Math.round(body.length / 100) / 10}k characters with no headings.`,
        'Sections give a model somewhere to look; a wall of text gets skimmed.');
    }

    // A warning rather than an idea: this is the gap that produces the worst
    // failure mode a skill has, which is reporting success having done nothing.
    if (!HAS_FAILURE_PATH.test(everything)) {
      add('warning', 'instructions', `“${name}” never says what to do when it cannot proceed.`,
        'Without a failure path a model invents one — usually by reporting success.');
    }
  }

  // — examples —
  if (body && !HAS_EXAMPLE.test(everything)) {
    add('warning', 'examples', `“${name}” has no example of the output it wants.`,
      'One worked example moves a skill further than another paragraph of rules. Add examples.md.');
  }

  // — output contract —
  if (body && !HAS_OUTPUT_CONTRACT.test(everything)) {
    add('warning', 'output', `“${name}” never states what its output should look like.`,
      'Name the shape — a table, JSON, three bullets, a subject line and two paragraphs — or every run answers differently.');
  }

  // — verification —
  if (body && !HAS_VERIFICATION.test(everything)) {
    add('warning', 'verification', `“${name}” has nothing to check itself against.`,
      'A short checklist is what stops a model reporting done having done nothing.');
  }

  // — security —
  // `allowed-tools` is a REAL pre-approval, unlike the suggested list: whatever
  // is named here runs during the skill's turn without asking. Naming a tool
  // that can write or execute is a legitimate choice and a big one.
  const risky = (s.allowed_tools || []).filter((t) => /^(bash|shell|write|edit|execute|run|terminal|multiedit|notebookedit)$/i.test(t.trim()));
  if (risky.length) {
    add('warning', 'security', `“${name}” pre-approves ${risky.join(', ')}.`,
      'Pre-approved means it runs without asking. Fine if you meant it; leave the field empty and every tool still prompts.');
  }

  // — efficiency —
  // SKILL.md is read in full on every run. Supporting files are not — that is
  // the entire point of them, and the reason this is a rule about placement
  // rather than about length.
  const bodyTokens = estimateTokens(body);
  if (bodyTokens > 1200 && !resources.length) {
    add('idea', 'efficiency', `“${name}” loads about ${bodyTokens.toLocaleString('en-US')} tokens on every run.`,
      'Move the reference material into a supporting file — those are read only when the model decides it needs them.');
  }

  // A resource nobody described is a file nobody opens. SKILL.md lists them
  // automatically, but the line it writes comes from this field.
  for (const r of resources) {
    if (!(r.purpose || '').trim()) {
      add('idea', 'specification', `“${name}” does not say what ${r.path} is for.`,
        'That one line is what tells the model whether this is the moment to open it.');
    }
    if (!(r.content || '').trim()) {
      add('warning', 'specification', `“${name}” references ${r.path}, which is empty.`,
        'An empty file still gets listed in SKILL.md, so the model is told to open something with nothing in it.');
    }
  }
}

function clip(s: string, n = 48): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
}

/**
 * Lint a whole project.
 *
 * `files` is the package as it will actually be written, and it is what the
 * credential scan runs over — so anything reaching the zip is covered without
 * this needing to know which form fields exist.
 */
export function lintProject(
  input: BuildInput,
  files: { path: string; content: string }[],
): { findings: LintFinding[]; secrets: SecretFinding[] } {
  const findings: LintFinding[] = [];
  const named = (input.skills || []).filter((s) => (s.name || '').trim());

  if (!named.length) {
    findings.push({
      severity: 'error', category: 'specification', skill: null,
      message: 'No skills yet — a plugin with none installs and does nothing.',
    });
  }

  for (const s of named) lintSkill(s, findings);

  // Two skills can slug to one directory. `buildPlugin` numbers the duplicates
  // rather than dropping one, but silently, and a numbered directory is not what
  // the author will look for.
  const slugs = named.map((s) => skillSlug(s.name));
  if (new Set(slugs).size !== slugs.length) {
    findings.push({
      severity: 'warning', category: 'specification', skill: null,
      message: 'Two skills produce the same directory name.',
      fix: 'The duplicates are numbered so nothing is lost, but rename one.',
    });
  }

  const rawName = (input.manifest.name || '').trim();
  if (rawName && pluginSlug(rawName) !== rawName.toLowerCase().replace(/\s+/g, '-')) {
    findings.push({
      severity: 'idea', category: 'specification', skill: null,
      message: `The plugin is named ${pluginSlug(rawName)} in the manifest.`,
    });
  }

  // §7.2, and the one URL rule worth enforcing here: a non-loopback endpoint
  // over http sends whatever the client sends in clear.
  if (input.mcpUrl) {
    try {
      const u = new URL(input.mcpUrl);
      const loopback = u.hostname === 'localhost' || /^127\./.test(u.hostname) || u.hostname === '[::1]';
      if (u.protocol !== 'https:' && !loopback) {
        findings.push({ severity: 'error', category: 'security', skill: null, message: 'The MCP server URL is not https.' });
      }
      if (u.username || u.password) {
        findings.push({
          severity: 'error', category: 'security', skill: null,
          message: 'The MCP server URL carries credentials in the host part.',
          fix: 'Spec §7.2 forbids it, and this file gets committed.',
        });
      }
    } catch {
      findings.push({ severity: 'error', category: 'security', skill: null, message: 'The MCP server URL is not a valid absolute URL.' });
    }
  }

  const secrets = scanFiles(files);
  for (const f of secrets) {
    findings.push({
      severity: 'error', category: 'security', skill: null,
      message: `${f.label} found in ${f.where}.`,
      fix: 'A plugin is a folder people commit. Remove it and rotate anything real.',
    });
  }

  return { findings, secrets };
}
