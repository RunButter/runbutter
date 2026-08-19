/**
 * A brand, in the shape the DESIGN.md specification defines.
 *
 * ── THE FORMAT IS NOT OURS TO INVENT ────────────────────────────────────────
 * `DESIGN.md` is a real specification — google-labs-code/design.md, built
 * inside Stitch and open-sourced in April 2026 — and the whole value of a
 * standard file name is that the agent already knows how to read it. A file
 * that says DESIGN.md at the top and then does something else is worse than one
 * with a different name, because the reader stops looking for what it expects.
 *
 * So the export is: YAML frontmatter carrying typed tokens (`colors`,
 * `typography`, `spacing`, `rounded`, `components`), then the eight canonical
 * `##` sections IN ORDER — Overview, Colors, Typography, Layout, Elevation &
 * Depth, Shapes, Components, Do's and Don'ts. Order matters because the model
 * reads top to bottom and each section is context for the next. Sections that
 * do not apply go in `omitted` with a reason rather than being silently absent,
 * which is the difference between "we have no shadows" and "nobody wrote this
 * down yet".
 *
 * ── WHICH IS ALSO WHY THE TWO LAYERS SURVIVE ────────────────────────────────
 * The values a model must never guess (hex, font, size) live in the
 * frontmatter, to be lifted verbatim. The judgement — what each colour is FOR,
 * how the voice sounds, what we never do — is prose, and the canonical sections
 * have exactly the right slots for it: brand and voice under Overview, the
 * never-list under Do's and Don'ts. Almost every hand-written DESIGN.md is only
 * the prose half, which is why they read well and produce inconsistent work.
 *
 * Zero imports, so a route handler, a client component and a test all read the
 * same code — the rule lib/finance/runway.ts and lib/vault/password.ts follow.
 */

export interface Swatch { name: string; hex: string; use?: string }

/**
 * One typography level, with the spec's own field names.
 *
 * `h1` / `body-md` / `label-caps` rather than `sm`/`lg`: a NAMED ROLE tells an
 * agent where to use it, and a t-shirt size does not. This replaced a plain
 * `{name, px}` scale — that carried a number and nothing about weight, leading
 * or tracking, so every generated heading was 400-weight with default leading
 * and looked nothing like the brand it came from.
 */
export interface TypeLevel {
  name: string;
  /** Omitted means "the body family". Only set it when this level differs. */
  fontFamily?: string;
  fontSize: number;
  fontWeight?: number;
  /** Unitless multiplier, as the spec's examples use. */
  lineHeight?: number;
  /** With its unit: `-0.02em`. */
  letterSpacing?: string;
  /** Not a spec field — ours, and rendered as prose. */
  use?: string;
}

export interface Shadow { name: string; value: string; use?: string }

/**
 * A component in the spec's `components` map: a name and property/token pairs.
 *
 * Values may be literals (`12px`) or token references (`{colors.primary}`).
 * Kept as strings rather than a typed union on purpose — the spec allows any
 * property name, and a whitelist here would silently drop whatever a designer
 * actually needed to say.
 */
export interface ComponentSpec { name: string; props: { key: string; value: string }[] }

export interface DesignTokens {
  brand: {
    name: string;
    tagline?: string;
    /** One line on the feel of it — becomes the spec's `description`. */
    description?: string;
    /** A file name, not a URL: a signed URL expires and an export must not. */
    logo?: string;
    logoDark?: string;
  };
  colors: Swatch[];
  type: {
    heading?: string;
    body?: string;
    mono?: string;
    levels?: TypeLevel[];
  };
  space: { base?: number; scale?: number[] };
  radius: { name: string; px: number }[];
  elevation: Shadow[];
  components: ComponentSpec[];
  /** Prose for each canonical section. Empty means "use the generated line". */
  notes: {
    overview?: string;
    colors?: string;
    typography?: string;
    layout?: string;
    elevation?: string;
    shapes?: string;
    components?: string;
  };
  voice: { tone?: string[]; weSay?: string[]; weNeverSay?: string[] };
  rules: { do: string[]; dont: string[] };
}

export const EMPTY_TOKENS: DesignTokens = {
  brand: { name: '' },
  colors: [],
  type: {},
  space: {},
  radius: [],
  elevation: [],
  components: [],
  notes: {},
  voice: {},
  rules: { do: [], dont: [] },
};

export const SPEC_VERSION = 'alpha';

/** The canonical body sections, in the order the specification requires. */
export const SECTIONS = [
  'Overview', 'Colors', 'Typography', 'Layout',
  'Elevation & Depth', 'Shapes', 'Components', "Do's and Don'ts",
] as const;

const hex = (s: string) => /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(s || '').trim());
const okColors = (t: DesignTokens) => (t.colors || []).filter((c) => c.name && hex(c.hex));

// ── Normalising ─────────────────────────────────────────────────────────────

/**
 * Fills in anything a stored document is missing, so an old shape still loads.
 *
 * It also MIGRATES the pre-spec shape: `type.scale` was `{name, px}` and is
 * lifted into full typography levels here rather than in a migration, because
 * the column is one jsonb document and a SQL rewrite of nested arrays is far
 * more likely to be wrong than a pure function with a test around it.
 */
export function normalizeTokens(raw: any): DesignTokens {
  const d = (raw && typeof raw === 'object') ? raw : {};
  const arr = (x: any) => (Array.isArray(x) ? x : []);
  const str = (x: any) => (x === undefined || x === null ? undefined : String(x));
  const num = (x: any) => (Number.isFinite(+x) ? +x : undefined);

  const levels: TypeLevel[] = arr(d.type?.levels)
    .filter((l: any) => l?.name && Number.isFinite(+l.fontSize))
    .map((l: any) => ({
      name: String(l.name),
      fontFamily: str(l.fontFamily),
      fontSize: +l.fontSize,
      fontWeight: num(l.fontWeight),
      lineHeight: num(l.lineHeight),
      letterSpacing: str(l.letterSpacing),
      use: str(l.use),
    }));

  // The old `{name, px}` scale. Converted, never dropped: somebody spent time
  // on those numbers and losing them on an upgrade is the worst kind of bug.
  if (!levels.length) {
    for (const s of arr(d.type?.scale)) {
      if (!s?.name || !Number.isFinite(+s.px)) continue;
      levels.push({ name: String(s.name), fontSize: +s.px });
    }
  }

  return {
    brand: {
      name: String(d.brand?.name || ''),
      tagline: str(d.brand?.tagline),
      description: str(d.brand?.description),
      logo: str(d.brand?.logo),
      logoDark: str(d.brand?.logoDark),
    },
    colors: arr(d.colors).filter((c: any) => c && c.name && c.hex)
      .map((c: any) => ({ name: String(c.name), hex: String(c.hex), use: str(c.use) })),
    type: {
      heading: str(d.type?.heading),
      body: str(d.type?.body),
      mono: str(d.type?.mono),
      levels,
    },
    space: {
      base: num(d.space?.base),
      scale: arr(d.space?.scale).map((n: any) => +n).filter((n: number) => Number.isFinite(n)),
    },
    radius: arr(d.radius).filter((r: any) => r?.name && Number.isFinite(+r.px))
      .map((r: any) => ({ name: String(r.name), px: +r.px })),
    elevation: arr(d.elevation).filter((e: any) => e?.name && e?.value)
      .map((e: any) => ({ name: String(e.name), value: String(e.value), use: str(e.use) })),
    components: arr(d.components).filter((c: any) => c?.name)
      .map((c: any) => ({
        name: String(c.name),
        props: arr(c.props).filter((p: any) => p?.key).map((p: any) => ({ key: String(p.key), value: String(p.value ?? '') })),
      })),
    notes: {
      overview: str(d.notes?.overview), colors: str(d.notes?.colors),
      typography: str(d.notes?.typography), layout: str(d.notes?.layout),
      elevation: str(d.notes?.elevation), shapes: str(d.notes?.shapes),
      components: str(d.notes?.components),
    },
    voice: {
      tone: arr(d.voice?.tone).map(String),
      weSay: arr(d.voice?.weSay).map(String),
      weNeverSay: arr(d.voice?.weNeverSay).map(String),
    },
    rules: { do: arr(d.rules?.do).map(String), dont: arr(d.rules?.dont).map(String) },
  };
}

// ── YAML ────────────────────────────────────────────────────────────────────

/**
 * Enough YAML for this document, written by hand.
 *
 * A dependency for eleven lines of emitter is the wrong trade, and the same
 * call `lib/markdown.ts` and `lib/plugins/zip.ts` make. The one thing it must
 * get right is QUOTING: `#1A1C1E` unquoted is a comment and the colour
 * vanishes, and a font called `Söhne: Buch` is a parse error whose only symptom
 * is a file the agent skips.
 */
function yamlScalar(v: string | number): string {
  if (typeof v === 'number') return String(v);
  const s = String(v);
  if (s === '') return "''";
  if (/^[A-Za-z0-9][A-Za-z0-9 ._\-/+]*$/.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s)) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const yamlKey = (k: string) => (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(k) ? k : `"${k.replace(/"/g, '\\"')}"`);

// ── The exact values ────────────────────────────────────────────────────────

/**
 * The frontmatter, as the object the spec describes.
 *
 * Empty groups are DROPPED and named in `omitted` instead. A heading with
 * nothing under it reads as "we have no rules about this", and a model treats
 * an empty list as permission — whereas `omitted: [{section: spacing, reason:
 * …}]` is a statement somebody made.
 */
export function toSpecObject(t: DesignTokens): Record<string, any> {
  const out: Record<string, any> = { version: SPEC_VERSION, name: t.brand.name || 'Untitled' };
  if (t.brand.description || t.brand.tagline) out.description = t.brand.description || t.brand.tagline;

  const colors = okColors(t);
  if (colors.length) out.colors = Object.fromEntries(colors.map((c) => [c.name, c.hex.toUpperCase()]));

  const levels = t.type.levels || [];
  if (levels.length) {
    out.typography = Object.fromEntries(levels.map((l) => {
      const v: Record<string, any> = {};
      const fam = l.fontFamily || (/^h[1-6]$|^display|^title/i.test(l.name) ? t.type.heading : t.type.body);
      if (fam) v.fontFamily = fam;
      v.fontSize = `${l.fontSize}px`;
      if (l.fontWeight) v.fontWeight = l.fontWeight;
      if (l.lineHeight) v.lineHeight = l.lineHeight;
      if (l.letterSpacing) v.letterSpacing = l.letterSpacing;
      return [l.name, v];
    }));
  }

  if (t.space.scale?.length) {
    // Named steps, not an array: `{spacing.md}` has to resolve to something.
    const names = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'];
    out.spacing = Object.fromEntries(t.space.scale.map((n, i) => [names[i] || `s${i + 1}`, `${n}px`]));
  }
  if (t.radius?.length) out.rounded = Object.fromEntries(t.radius.map((r) => [r.name, `${r.px}px`]));
  if (t.components?.length) {
    out.components = Object.fromEntries(t.components
      .filter((c) => c.name && c.props.length)
      .map((c) => [c.name, Object.fromEntries(c.props.filter((p) => p.key).map((p) => [p.key, p.value]))]));
  }

  const omitted: { section: string; reason: string }[] = [];
  if (!colors.length) omitted.push({ section: 'colors', reason: 'Not defined yet.' });
  if (!levels.length) omitted.push({ section: 'typography', reason: 'Not defined yet.' });
  if (!t.space.scale?.length) omitted.push({ section: 'spacing', reason: 'Not defined yet.' });
  if (!t.elevation?.length) omitted.push({ section: 'elevation', reason: 'This brand uses no shadows — depth comes from tone and spacing.' });
  if (omitted.length) out.omitted = omitted;
  return out;
}

/** The frontmatter block, between its `---` fences. */
export function toFrontmatter(t: DesignTokens): string {
  const o = toSpecObject(t);
  const L: string[] = ['---'];
  const emit = (obj: Record<string, any>, indent: string) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        L.push(`${indent}${yamlKey(k)}:`);
        for (const item of v) {
          if (item && typeof item === 'object') {
            const entries = Object.entries(item);
            L.push(`${indent}  - ${yamlKey(entries[0][0])}: ${yamlScalar(entries[0][1] as any)}`);
            for (const [ik, iv] of entries.slice(1)) L.push(`${indent}    ${yamlKey(ik)}: ${yamlScalar(iv as any)}`);
          } else {
            L.push(`${indent}  - ${yamlScalar(item)}`);
          }
        }
      } else if (v && typeof v === 'object') {
        L.push(`${indent}${yamlKey(k)}:`);
        emit(v, `${indent}  `);
      } else {
        L.push(`${indent}${yamlKey(k)}: ${yamlScalar(v)}`);
      }
    }
  };
  emit(o, '');
  L.push('---');
  return L.join('\n');
}

/** The same values as JSON, for a build step that would rather not parse YAML. */
export const toDesignJson = (t: DesignTokens) => toSpecObject(t);

// ── The document ────────────────────────────────────────────────────────────

const para = (s?: string) => (s || '').trim();

function overviewProse(t: DesignTokens): string {
  if (para(t.notes.overview)) return para(t.notes.overview)!;
  const bits: string[] = [];
  if (t.brand.tagline) bits.push(t.brand.tagline);
  if (t.brand.description) bits.push(t.brand.description);
  return bits.join(' ') || `The visual identity for ${t.brand.name || 'this brand'}.`;
}

/**
 * DESIGN.md, to spec.
 *
 * The eight canonical sections in their required order, each one carrying both
 * halves: the values (already exact in the frontmatter, restated here as tables
 * a human can read) and the judgement (what it is for, when to reach for it).
 * A section with nothing to say is skipped and declared in `omitted` — never
 * emitted empty.
 */
export function toDesignMd(t: DesignTokens): string {
  const L: string[] = [];
  const name = t.brand.name || 'Untitled';

  L.push(toFrontmatter(t));
  L.push('');
  L.push(`# ${name}`);
  L.push('');

  // 1 ── Overview
  L.push('## Overview');
  L.push('');
  L.push(overviewProse(t));
  L.push('');
  if (t.voice.tone?.length || t.voice.weSay?.length || t.voice.weNeverSay?.length) {
    // Voice has no canonical section and belongs here rather than nowhere: it
    // is the half of a brand that decides whether generated copy sounds like
    // you, and Overview is where an agent builds its idea of the thing.
    if (t.voice.tone?.length) { L.push(`**Voice** — ${t.voice.tone.join(', ')}.`); L.push(''); }
    if (t.voice.weSay?.length) {
      L.push('We say: ' + t.voice.weSay.map((s) => `“${s}”`).join(' · '));
      L.push('');
    }
    if (t.voice.weNeverSay?.length) {
      L.push('We never say: ' + t.voice.weNeverSay.map((s) => `“${s}”`).join(' · '));
      L.push('');
    }
  }

  // 2 ── Colors
  const colors = okColors(t);
  if (colors.length) {
    L.push('## Colors');
    L.push('');
    if (para(t.notes.colors)) { L.push(para(t.notes.colors)!); L.push(''); }
    L.push('| Token | Value | Use it for |');
    L.push('|---|---|---|');
    for (const c of colors) L.push(`| \`${c.name}\` | \`${c.hex.toUpperCase()}\` | ${c.use || '—'} |`);
    L.push('');
  }

  // 3 ── Typography
  const levels = t.type.levels || [];
  if (levels.length || t.type.body) {
    L.push('## Typography');
    L.push('');
    if (para(t.notes.typography)) { L.push(para(t.notes.typography)!); L.push(''); }
    const fams: string[] = [];
    if (t.type.heading) fams.push(`**${t.type.heading}** for headings`);
    if (t.type.body) fams.push(`**${t.type.body}** for body`);
    if (t.type.mono) fams.push(`**${t.type.mono}** for code and numerals`);
    if (fams.length) { L.push(fams.join(', ') + '.'); L.push(''); }
    if (levels.length) {
      L.push('| Level | Size | Weight | Line height | Tracking | Use it for |');
      L.push('|---|---|---|---|---|---|');
      for (const l of levels) {
        L.push(`| \`${l.name}\` | ${l.fontSize}px | ${l.fontWeight ?? '—'} | ${l.lineHeight ?? '—'} | ${l.letterSpacing || '—'} | ${l.use || '—'} |`);
      }
      L.push('');
      L.push('Every size comes from that table. A one-off pixel value is how a scale stops being one.');
      L.push('');
    }
  }

  // 4 ── Layout
  if (t.space.scale?.length || t.space.base || para(t.notes.layout)) {
    L.push('## Layout');
    L.push('');
    if (para(t.notes.layout)) { L.push(para(t.notes.layout)!); L.push(''); }
    if (t.space.base) L.push(`- Every measurement is a multiple of **${t.space.base}px**.`);
    if (t.space.scale?.length) L.push(`- Steps: ${t.space.scale.map((n) => `${n}px`).join(' · ')}`);
    L.push('');
  }

  // 5 ── Elevation & Depth
  if (t.elevation?.length || para(t.notes.elevation)) {
    L.push('## Elevation & Depth');
    L.push('');
    if (para(t.notes.elevation)) { L.push(para(t.notes.elevation)!); L.push(''); }
    if (t.elevation?.length) {
      L.push('| Level | Shadow | Use it for |');
      L.push('|---|---|---|');
      for (const e of t.elevation) L.push(`| \`${e.name}\` | \`${e.value}\` | ${e.use || '—'} |`);
      L.push('');
    }
  }

  // 6 ── Shapes
  if (t.radius?.length || para(t.notes.shapes)) {
    L.push('## Shapes');
    L.push('');
    if (para(t.notes.shapes)) { L.push(para(t.notes.shapes)!); L.push(''); }
    if (t.radius?.length) {
      L.push(`Corner radii: ${t.radius.map((r) => `**${r.name}** ${r.px}px`).join(' · ')}.`);
      L.push('');
    }
  }

  // 7 ── Components
  if (t.components?.length || para(t.notes.components)) {
    L.push('## Components');
    L.push('');
    if (para(t.notes.components)) { L.push(para(t.notes.components)!); L.push(''); }
    for (const c of t.components || []) {
      if (!c.props.length) continue;
      L.push(`- **${c.name}** — ${c.props.map((p) => `${p.key}: \`${p.value}\``).join(', ')}`);
    }
    L.push('');
  }

  // 8 ── Do's and Don'ts. Last, and blunt: a constraint buried mid-document is
  // one an agent averages against everything else it read.
  if (t.rules.do?.length || t.rules.dont?.length) {
    L.push("## Do's and Don'ts");
    L.push('');
    for (const r of t.rules.do || []) L.push(`- **Do** ${lower(r)}`);
    for (const r of t.rules.dont || []) L.push(`- **Don't** ${lower(stripNegation(r))}`);
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('If a value you need is not written above, **ask** — do not invent one. An invented colour or');
  L.push('a one-off font size is how a brand stops being a brand.');
  L.push('');
  return L.join('\n');
}

/** "Never centre a paragraph" → "centre a paragraph", so **Don't** reads right. */
function stripNegation(s: string): string {
  return s.replace(/^\s*(never|don['’]t|do not|avoid)\s+/i, '');
}
const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

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
  if (!t.brand.name?.trim()) out.push('No name — the file has nothing to call this brand.');
  if (!okColors(t).some((c) => c.name === 'primary' || c.name === 'accent')) out.push('No primary or accent colour, which is the value an agent reaches for first.');
  if (!t.type.body) out.push('No body font named, so text is whatever the tool defaults to.');
  if (!(t.type.levels || []).length) out.push('No type levels — every heading size will be invented per screen.');
  if (!(t.type.levels || []).some((l) => l.fontWeight)) out.push('No weights on the type levels, so everything generated comes out at 400.');
  if (!t.rules.dont?.length) out.push('No “don’t” list. It is the section that does the most work.');
  if (!(t.components || []).length) out.push('No components. A button described once is a button that looks the same everywhere.');
  if (!t.brand.logo) out.push('No logo file, so anything generated is unbranded.');
  return out;
}
