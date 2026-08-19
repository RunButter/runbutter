/**
 * A brand, in a shape a machine can apply exactly.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The common advice is "feed the AI your brand PDF and it will figure it out".
 * It does not, reliably — a PDF is pixels and loose text, so the model
 * RE-DERIVES the brand on every run and lands somewhere slightly different each
 * time. The accent is #6366F1 today and "indigo-ish" tomorrow. That is what
 * people mean when they say a DESIGN.md "needs tinkering".
 *
 * So a brand spec has to be TWO layers, and almost every hand-written DESIGN.md
 * is only the second:
 *
 *   1. DETERMINISTIC — hex codes, font names, a numeric scale, file names.
 *      A model must never guess these, and a human must never retype them.
 *      They live in `design.json` and are quoted verbatim in the markdown.
 *   2. JUDGEMENT — when to use which, tone, what we never do. Prose is the
 *      right tool for exactly this and the wrong tool for a hex code.
 *
 * `DESIGN.md` carries both: the exact values in a fenced JSON block a model can
 * lift without interpreting, and the prose underneath for the calls that need a
 * person's taste written down.
 *
 * Zero imports, so a route handler, a client component and a test all read the
 * same code — the rule lib/finance/runway.ts and lib/vault/password.ts follow.
 */

export interface Swatch { name: string; hex: string; use?: string }

export interface DesignTokens {
  brand: {
    name: string;
    tagline?: string;
    /** A file name, not a URL: a signed URL expires and an export must not. */
    logo?: string;
    logoDark?: string;
  };
  colors: Swatch[];
  type: {
    heading?: string;
    body?: string;
    mono?: string;
    /** Named steps, px. A scale beats "make it bigger". */
    scale?: { name: string; px: number }[];
    weights?: { name: string; value: number }[];
  };
  space: { base?: number; scale?: number[] };
  radius: { name: string; px: number }[];
  voice: {
    tone?: string[];
    weSay?: string[];
    weNeverSay?: string[];
  };
  rules: { do: string[]; dont: string[] };
}

export const EMPTY_TOKENS: DesignTokens = {
  brand: { name: '' },
  colors: [],
  type: {},
  space: {},
  radius: [],
  voice: {},
  rules: { do: [], dont: [] },
};

/**
 * A starting point that is already correct rather than already empty.
 *
 * The in-app skills editor used to open a blank box, which is the hardest
 * version of every writing task. These are real defaults a designer edits down,
 * with the accent left to whatever the workspace already branded itself.
 */
export function starterTokens(name: string, accent: string): DesignTokens {
  return {
    brand: { name: name || 'Our brand' },
    colors: [
      { name: 'accent', hex: accent || '#6366F1', use: 'Primary actions, links, the one thing on a screen you want clicked' },
      { name: 'foreground', hex: '#111114', use: 'Body text' },
      { name: 'muted', hex: '#6B7280', use: 'Secondary text, captions, timestamps' },
      { name: 'background', hex: '#FFFFFF', use: 'Page' },
      { name: 'surface', hex: '#F7F7F8', use: 'Cards, panels, anything raised off the page' },
      { name: 'border', hex: '#E5E7EB', use: 'Hairlines and dividers' },
      { name: 'success', hex: '#16A34A', use: 'Confirmed, paid, done' },
      { name: 'warning', hex: '#D97706', use: 'Needs attention, not yet wrong' },
      { name: 'danger', hex: '#DC2626', use: 'Destructive actions and real errors' },
    ],
    type: {
      heading: 'Inter',
      body: 'Inter',
      mono: 'JetBrains Mono',
      scale: [
        { name: 'xs', px: 12 }, { name: 'sm', px: 14 }, { name: 'base', px: 16 },
        { name: 'lg', px: 20 }, { name: 'xl', px: 24 }, { name: '2xl', px: 32 },
        { name: '3xl', px: 44 },
      ],
      weights: [{ name: 'regular', value: 400 }, { name: 'medium', value: 500 }, { name: 'semibold', value: 600 }],
    },
    space: { base: 4, scale: [4, 8, 12, 16, 24, 32, 48, 64] },
    radius: [{ name: 'sm', px: 6 }, { name: 'md', px: 10 }, { name: 'lg', px: 16 }, { name: 'full', px: 9999 }],
    voice: {
      tone: ['plain', 'direct', 'warm', 'never breathless'],
      weSay: ['Get started', 'Something went wrong', 'Save'],
      weNeverSay: ['Simply', 'Just', 'Effortlessly', 'Revolutionary', 'Unlock'],
    },
    rules: {
      do: [
        'Use one accent colour per screen. If two things are both primary, neither is.',
        'Make hierarchy from size and colour before reaching for weight.',
        'Leave more space than feels necessary.',
      ],
      dont: [
        'Never invent a colour that is not in the palette above.',
        'Never use pure black (#000) for text.',
        'Never centre a paragraph of more than two lines.',
      ],
    },
  };
}

const hex = (s: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(s || '').trim());

/**
 * Only what is actually set, in a stable order.
 *
 * Empty sections are DROPPED rather than emitted blank. A heading with nothing
 * under it reads as "we have no rules about this", and a model treats an empty
 * list as permission.
 */
export function toDesignJson(t: DesignTokens): Record<string, any> {
  const out: Record<string, any> = { brand: { name: t.brand.name } };
  if (t.brand.tagline) out.brand.tagline = t.brand.tagline;
  if (t.brand.logo) out.brand.logo = t.brand.logo;
  if (t.brand.logoDark) out.brand.logoDark = t.brand.logoDark;

  const colors = (t.colors || []).filter((c) => c.name && hex(c.hex));
  if (colors.length) out.colors = Object.fromEntries(colors.map((c) => [c.name, c.hex.toUpperCase()]));

  const type: Record<string, any> = {};
  if (t.type.heading) type.heading = t.type.heading;
  if (t.type.body) type.body = t.type.body;
  if (t.type.mono) type.mono = t.type.mono;
  if (t.type.scale?.length) type.scale = Object.fromEntries(t.type.scale.map((s) => [s.name, `${s.px}px`]));
  if (t.type.weights?.length) type.weights = Object.fromEntries(t.type.weights.map((w) => [w.name, w.value]));
  if (Object.keys(type).length) out.type = type;

  if (t.space.base || t.space.scale?.length) {
    out.space = {};
    if (t.space.base) out.space.base = `${t.space.base}px`;
    if (t.space.scale?.length) out.space.scale = t.space.scale.map((n) => `${n}px`);
  }
  if (t.radius?.length) out.radius = Object.fromEntries(t.radius.map((r) => [r.name, `${r.px}px`]));
  return out;
}

/**
 * DESIGN.md — the deliverable.
 *
 * ── THE EXACT VALUES COME FIRST, AS JSON ────────────────────────────────────
 * A fenced ```json block near the top, because that is the one part a model
 * must lift verbatim rather than interpret. Prose describing a colour as
 * "a deep indigo" is how #6366F1 becomes #4F46E5 on the third screen.
 *
 * ── THE PROSE IS THE PART A PDF CANNOT CARRY ────────────────────────────────
 * Everything after it is judgement: what each colour is FOR, how the voice
 * sounds, and the explicit never-do list. That list is last and blunt on
 * purpose — a rule buried in a paragraph is a rule that gets averaged away.
 */
export function toDesignMd(t: DesignTokens): string {
  const L: string[] = [];
  const name = t.brand.name || 'Our brand';

  L.push(`# ${name} — design`);
  L.push('');
  if (t.brand.tagline) { L.push(`> ${t.brand.tagline}`); L.push(''); }
  L.push('This file tells a person **and an AI agent** how to make something that looks like us.');
  L.push('The JSON block is exact — copy those values, never approximate them. Everything after it is');
  L.push('judgement, which is what prose is for.');
  L.push('');

  L.push('## Exact values');
  L.push('');
  L.push('```json');
  L.push(JSON.stringify(toDesignJson(t), null, 2));
  L.push('```');
  L.push('');

  const colors = (t.colors || []).filter((c) => c.name && hex(c.hex));
  if (colors.length) {
    L.push('## Colour, and what each one is for');
    L.push('');
    L.push('| Token | Hex | Use it for |');
    L.push('|---|---|---|');
    for (const c of colors) L.push(`| \`${c.name}\` | \`${c.hex.toUpperCase()}\` | ${c.use || '—'} |`);
    L.push('');
  }

  if (t.type.heading || t.type.body || t.type.scale?.length) {
    L.push('## Type');
    L.push('');
    if (t.type.heading) L.push(`- **Headings** — ${t.type.heading}`);
    if (t.type.body) L.push(`- **Body** — ${t.type.body}`);
    if (t.type.mono) L.push(`- **Code** — ${t.type.mono}`);
    if (t.type.scale?.length) {
      L.push(`- **Sizes** — ${t.type.scale.map((s) => `${s.name} ${s.px}px`).join(' · ')}`);
      L.push('- Sizes come from that scale. A one-off pixel value is how a scale stops being one.');
    }
    L.push('');
  }

  if (t.space.scale?.length || t.radius?.length) {
    L.push('## Space and shape');
    L.push('');
    if (t.space.base) L.push(`- Everything is a multiple of **${t.space.base}px**.`);
    if (t.space.scale?.length) L.push(`- Steps: ${t.space.scale.map((n) => `${n}px`).join(' · ')}`);
    if (t.radius?.length) L.push(`- Corners: ${t.radius.map((r) => `${r.name} ${r.px}px`).join(' · ')}`);
    L.push('');
  }

  if (t.voice.tone?.length || t.voice.weSay?.length || t.voice.weNeverSay?.length) {
    L.push('## Voice');
    L.push('');
    if (t.voice.tone?.length) L.push(`We sound **${t.voice.tone.join(', ')}**.`);
    L.push('');
    if (t.voice.weSay?.length) {
      L.push('We say:');
      for (const s of t.voice.weSay) L.push(`- ${s}`);
      L.push('');
    }
    if (t.voice.weNeverSay?.length) {
      L.push('We never say:');
      for (const s of t.voice.weNeverSay) L.push(`- ${s}`);
      L.push('');
    }
  }

  if (t.rules.do?.length) {
    L.push('## How to use it');
    L.push('');
    for (const r of t.rules.do) L.push(`- ${r}`);
    L.push('');
  }

  // LAST, and blunt. A constraint buried mid-document is a constraint an agent
  // averages against everything else it read.
  if (t.rules.dont?.length) {
    L.push('## Never');
    L.push('');
    for (const r of t.rules.dont) L.push(`- ${r}`);
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('If a value you need is not written above, **ask** — do not invent one. An invented colour');
  L.push('or a one-off font size is how a brand stops being a brand.');
  L.push('');
  return L.join('\n');
}

/**
 * The same content as a SKILL.md body, for the agent-plugin format.
 *
 * Deliberately the SAME renderer: a design skill and a DESIGN.md that disagree
 * would be two brands. The frontmatter is added by lib/plugins/agent-plugin.ts,
 * which is the one builder — this returns the body only.
 */
export const toSkillBody = (t: DesignTokens) => toDesignMd(t);

/** What is missing, in the order it is worth fixing. Never a score. */
export function gaps(t: DesignTokens): string[] {
  const out: string[] = [];
  if (!t.brand.name?.trim()) out.push('No brand name — every heading in the file falls back to a placeholder.');
  if (!(t.colors || []).some((c) => c.name === 'accent' && hex(c.hex))) out.push('No accent colour, which is the one value an agent reaches for first.');
  if (!t.type.body) out.push('No body font named, so text is whatever the tool defaults to.');
  if (!t.type.scale?.length) out.push('No type scale — sizes will be invented per screen.');
  if (!t.rules.dont?.length) out.push('No “never” list. It is the section that does the most work.');
  if (!t.brand.logo) out.push('No logo file, so anything generated is unbranded.');
  return out;
}
