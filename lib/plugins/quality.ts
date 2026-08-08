/**
 * The quality score — one number, and eight numbers that explain it.
 *
 * WHY A SCORE AT ALL. A list of findings is a list; a score is a thing someone
 * will actually try to move. The risk of one is that it becomes a number people
 * game without the skill getting better, which is why every category here is
 * derived from a finding that names a concrete missing thing, and why the panel
 * shows the reasons rather than only the total. A score you cannot explain is
 * exactly the fabricated-metric problem this codebase refuses everywhere else.
 *
 * WHAT IT IS NOT. It is not a measure of whether the skill works — nothing has
 * been run. It measures whether the skill is WRITTEN like one that will: does it
 * say when to fire, what to produce, what to do when it cannot, and what good
 * output looks like. That distinction is stated in the UI too, because a number
 * next to the word "quality" invites exactly the wrong reading.
 *
 * HOW THE ARITHMETIC WORKS, since a score nobody can reproduce is a magic
 * number. Each category starts at 100 and loses points per finding: 60 for an
 * error, 40 for a warning, 12 for an idea. A finding attached to one skill is
 * divided by the number of skills, so a five-skill plugin is not marked down as
 * hard for one skill's gap as a one-skill plugin is — while a finding about the
 * package as a whole counts in full. Categories are then combined on the §10
 * weights, which sum to exactly 1.
 *
 * THE PENALTIES ARE LARGE ON PURPOSE. The first version docked 22 for a warning,
 * which put the three shipped templates at 91, 93 and 95 while every one of them
 * was missing an output contract, an example and any way to check itself. A
 * panel that says 93 and then lists three real gaps has taught the reader that
 * the number is decoration. Most of these categories are presence tests — a
 * skill either states what it produces or it does not — so a miss has to move
 * the number enough that fixing it is visibly worth doing.
 */

import type { LintFinding, LintCategory } from '@/lib/plugins/lint';
import { CATEGORY_LABEL, estimateTokens } from '@/lib/plugins/lint';

/** §10's weighting, unchanged. They must sum to 1 — asserted below. */
export const WEIGHTS: Record<LintCategory, number> = {
  specification: 0.15,
  activation: 0.15,
  instructions: 0.15,
  examples: 0.10,
  output: 0.15,
  security: 0.15,
  verification: 0.10,
  efficiency: 0.05,
};

const PENALTY: Record<LintFinding['severity'], number> = { error: 60, warning: 40, idea: 12 };

/** What a clean category means, so a 100 says something rather than nothing. */
const CLEAN: Record<LintCategory, string> = {
  specification: 'Names, descriptions and files are all well-formed.',
  activation: 'Every skill says when to fire and when not to.',
  instructions: 'No contradictions, no repeats, and a path for when it cannot proceed.',
  examples: 'Each skill shows what good output looks like.',
  output: 'Each skill states the shape of what it produces.',
  security: 'No credentials in the package and no surprising pre-approvals.',
  verification: 'Each skill has something to check itself against.',
  efficiency: 'Nothing loading more than it needs to on every run.',
};

export interface CategoryScore {
  category: LintCategory;
  label: string;
  score: number;
  weight: number;
  /** Why it is not 100 — or what being 100 means. */
  reasons: string[];
}

export interface QualityReport {
  overall: number;
  /** One line under the number. Never congratulatory, never scolding. */
  verdict: string;
  categories: CategoryScore[];
  /** Approximate, character-derived — see estimateTokens. */
  tokensPerRun: number;
  tokensOnDemand: number;
}

export function scoreProject(
  findings: LintFinding[],
  opts: { skillCount: number; perRunChars: number; onDemandChars: number },
): QualityReport {
  const n = Math.max(1, opts.skillCount);

  const categories = (Object.keys(WEIGHTS) as LintCategory[]).map((category) => {
    const mine = findings.filter((f) => f.category === category);
    let lost = 0;
    for (const f of mine) lost += PENALTY[f.severity] / (f.skill ? n : 1);
    const score = Math.max(0, Math.min(100, Math.round(100 - lost)));

    // Reasons are the findings themselves, deduplicated by message shape so a
    // five-skill plugin missing the same thing five times reads as one line
    // with a count rather than five identical rows.
    const counted = new Map<string, { n: number; first: string }>();
    for (const f of mine) {
      const key = f.skill ? f.message.replace(/^“[^”]*”/, '·') : f.message;
      const prev = counted.get(key);
      counted.set(key, { n: (prev?.n || 0) + 1, first: prev?.first ?? f.message });
    }
    // The generalised wording is only used when there is something to
    // generalise. One skill saying "Each skill has no example" reads as a
    // template someone forgot to fill in — and it is, so it was.
    const reasons = mine.length
      ? [...counted.entries()].map(([key, { n, first }]) =>
          n > 1 ? `${key.replace(/^·/, 'Each skill')} (${n} skills)` : first)
      : [CLEAN[category]];

    return { category, label: CATEGORY_LABEL[category], score, weight: WEIGHTS[category], reasons };
  });

  const overall = Math.round(categories.reduce((t, c) => t + c.score * c.weight, 0));

  return {
    overall,
    verdict: verdictFor(overall, findings),
    categories,
    tokensPerRun: estimateTokens('x'.repeat(Math.max(0, opts.perRunChars))),
    tokensOnDemand: estimateTokens('x'.repeat(Math.max(0, opts.onDemandChars))),
  };
}

/**
 * The line under the number.
 *
 * It names the biggest single thing to fix rather than grading the author,
 * because "72 — fair" tells nobody what to do next. An error outranks the score:
 * a package with a credential in it is not a 68, it is a package you must not
 * push, whatever the arithmetic says.
 */
function verdictFor(overall: number, findings: LintFinding[]): string {
  const errors = findings.filter((f) => f.severity === 'error');
  if (errors.length) return errors[0].message;

  const warnings = findings.filter((f) => f.severity === 'warning');
  if (warnings.length) {
    return `${warnings.length} thing${warnings.length === 1 ? '' : 's'} worth fixing before you ship this.`;
  }
  if (overall >= 95) return 'Nothing left that can be checked without running it.';
  return 'No problems found — the rest is polish.';
}

// A weighting that does not sum to 1 produces a score out of something other
// than 100 and nobody notices for months. Cheap to assert, and it runs at import
// in dev only.
if (process.env.NODE_ENV !== 'production') {
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 1e-9) {
    throw new Error(`lib/plugins/quality.ts: category weights sum to ${total}, not 1`);
  }
}
