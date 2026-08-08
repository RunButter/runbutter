/**
 * Describe a skill, get a skill — with the linter in the loop.
 *
 * WHAT MAKES THIS DIFFERENT FROM A PROMPT. Anything can ask a model for a
 * SKILL.md. What a model reliably produces on the first attempt is a page of
 * rules with no output contract, no example and no failure path — exactly the
 * four gaps `lint.ts` was written to name. So generation here is a LOOP: write,
 * lint, and hand the findings back as the next instruction. The linter is not a
 * report at the end, it is the signal the generator steers on, and that is only
 * possible because the checks are structural enough to state as a fix.
 *
 * IT RETURNS A DRAFT AND WRITES NOTHING. The result lands in the editor for a
 * person to read, exactly like `/api/workspace/build` returns a plan rather than
 * creating tables. The description is untrusted text and so is anything a model
 * does with it; the reply is only ever parsed as a skill, every field is
 * re-validated here against the same rules the builder enforces, and the output
 * of this whole path is text in a form field. A prompt injection's best outcome
 * is a silly draft somebody deletes.
 *
 * ZERO SERVER IMPORTS — this file is shared by the route and the tests, and it
 * is pure string work, so it stays testable without a database or a key.
 */

import { skillSlug, resourcePath } from '@/lib/plugins/agent-plugin';
import { TEMPLATES } from '@/lib/plugins/templates';
import type { LintFinding } from '@/lib/plugins/lint';

export interface GeneratedSkill {
  name: string;
  description: string;
  instructions: string;
  whenToUse: string;
  resources: { path: string; purpose: string; content: string }[];
}

/** Bounds. A skill is instructions, not a manual — and every one of these is a
 *  cost the user pays on every run of the finished skill. */
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_INSTRUCTIONS = 12_000;
const MAX_RESOURCES = 3;
const MAX_RESOURCE_CHARS = 8_000;

export const SYSTEM = `You write Agent Skills: reusable instruction packs that an AI agent loads when a task matches.

A skill is a directory with SKILL.md in it. SKILL.md has YAML frontmatter (name, description) and a markdown body. Supporting files sit beside it and are read ONLY when the model decides it needs them, which is why long material belongs there and not in the body.

Reply with ONLY a JSON object, no prose and no code fence:
{
  "name": "invoice-reminder-tone",
  "description": "What it is. Use when <trigger>. Not for <the neighbouring case>.",
  "when_to_use": "one line of trigger phrases, or \\"\\"",
  "instructions": "the markdown body of SKILL.md",
  "resources": [{ "path": "examples.md", "purpose": "one line: what is in it and when to read it", "content": "markdown" }]
}

The body MUST contain these sections, as \`##\` headings:
- Rules (or Process) — the actual instructions, as imperatives
- Output — the exact shape of what the skill produces: a table, JSON, three bullets, a subject line and two paragraphs. Name it.
- Examples — at least one worked example, as a blockquote, with one line on why it works
- Verification — a "- [ ]" checklist the model runs before reporting done

The body MUST also say what to do when the skill cannot proceed. "If X cannot be read, say so and stop" — never let it report success having done nothing.

Rules:
- "name" is lowercase letters, digits and single hyphens, 1-64 characters
- "description" is one or two sentences and MUST contain the words "Use when" or "Use for", and MUST say what the skill is NOT for
- write the instructions in the user's own vocabulary — their words for their work, not generic advice
- be specific and short. Rules a person could disagree with beat rules nobody would argue with
- NEVER invent a credential, an API key, a URL or a customer name
- "resources" may be an empty array. Use one only when there is genuinely long material — worked examples, a reference table
- no placeholders like "TODO" or "<your value here>"`;

/** Two real templates, so the model matches their taste rather than inventing
 *  a house style of its own. Truncated: the full three would crowd the prompt. */
export function fewShot(): string {
  return TEMPLATES.slice(0, 2).map((t) => JSON.stringify({
    name: skillSlug(t.skill.name),
    description: t.skill.description,
    when_to_use: t.skill.whenToUse,
    instructions: t.skill.instructions,
    resources: t.skill.resources,
  })).join('\n\n');
}

/**
 * Pull the JSON out of a reply.
 *
 * Models wrap JSON in fences and add a sentence before it however firmly they
 * are told not to, so first `{` to last `}` is the reliable read — the same
 * approach `/api/workspace/build` settled on.
 */
export function extractJson(reply: string): any | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(reply.slice(start, end + 1)); } catch { /* fall through */ }
  // One salvage attempt: models occasionally emit a trailing comma before a
  // closing brace or bracket, which is the single most common way an otherwise
  // perfect reply fails to parse.
  try { return JSON.parse(reply.slice(start, end + 1).replace(/,(\s*[}\]])/g, '$1')); } catch { return null; }
}

/**
 * Coerce a model's reply into a skill, dropping anything unusable.
 *
 * Fails closed on shape the way `coerce_custom_value` does in SQL: undeclared
 * keys are ignored, everything is length-capped, and a resource path is put
 * through the same sanitiser the packager uses so a generated `../../etc` can
 * never become a zip entry. Returns null only when there is nothing left worth
 * showing.
 */
export function normalizeGenerated(raw: any): GeneratedSkill | null {
  if (!raw || typeof raw !== 'object') return null;
  const str = (v: any, cap: number) => (typeof v === 'string' ? v : '').replace(/\r\n/g, '\n').trim().slice(0, cap);

  // The RAW name is tested before slugging. `skillSlug` falls back to "skill"
  // for an empty input — right for a person halfway through typing, wrong here,
  // because it turns "the model did not name this" into a skill called `skill`
  // and hides the failure behind a plausible-looking draft.
  const rawName = str(raw.name, MAX_NAME);
  const name = skillSlug(rawName);
  const instructions = str(raw.instructions, MAX_INSTRUCTIONS);
  // A skill with no body is not a draft, it is a title. Better to say the
  // generation failed than to drop someone into an empty editor.
  if (!rawName || !name || !instructions) return null;

  const seen = new Set<string>(['SKILL.md']);
  const resources = (Array.isArray(raw.resources) ? raw.resources : [])
    .map((r: any) => ({
      path: resourcePath(str(r?.path, 120)),
      purpose: str(r?.purpose, 200),
      content: str(r?.content, MAX_RESOURCE_CHARS),
    }))
    .filter((r: any) => {
      if (!r.path || !r.content || seen.has(r.path)) return false;
      seen.add(r.path);
      return true;
    })
    .slice(0, MAX_RESOURCES);

  return {
    name,
    description: str(raw.description, MAX_DESCRIPTION),
    instructions,
    whenToUse: str(raw.when_to_use ?? raw.whenToUse, 400),
    resources,
  };
}

/**
 * Turn lint findings into the next instruction, or null when there is nothing
 * left worth another call.
 *
 * IDEAS ARE DELIBERATELY EXCLUDED. They are the findings that are fine to
 * ignore, and spending a second model call — the user's own money — chasing "it
 * never says what it is NOT for" is how a repair loop turns into a token sink.
 * Errors and warnings only, and the fix text is included because it is already
 * written as an instruction.
 */
/**
 * How bad a draft is, for picking between two of them.
 *
 * A repair can make things worse — the usual way is rewriting the body to
 * satisfy one finding and losing a section it was not asked about — so the loop
 * keeps the best draft rather than the last one. Errors are worth ten warnings
 * because an error means the package is broken and a warning means it is
 * improvable. Ideas are not counted: they are not what the loop is chasing.
 */
export function draftWeight(findings: LintFinding[]): number {
  let n = 0;
  for (const f of findings) {
    if (f.severity === 'error') n += 10;
    else if (f.severity === 'warning') n += 1;
  }
  return n;
}

export function repairPrompt(findings: LintFinding[]): string | null {
  const actionable = findings.filter((f) => f.severity === 'error' || f.severity === 'warning');
  if (!actionable.length) return null;
  const lines = actionable.map((f) => `- ${f.message}${f.fix ? ` ${f.fix}` : ''}`);
  return `That draft has problems. Fix ALL of these and reply with the corrected JSON object, same shape, nothing else:

${lines.join('\n')}

Keep everything that was already right. Do not shorten the instructions to make the list go away.`;
}
