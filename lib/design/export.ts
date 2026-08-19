/**
 * What a brand ships as: the files, and what each one is for.
 *
 * ── ONE SOURCE, FOUR AUDIENCES ──────────────────────────────────────────────
 * A brand has to reach four different readers and they do not want the same
 * file. Writing four by hand is how a palette ends up right in one of them:
 *
 *   DESIGN.md      a person, and an AI agent — values plus the judgement calls
 *   design.json    a script, a build step, a design-token pipeline
 *   tokens.css     the browser, directly: custom properties you can ship
 *   tailwind…js    a Tailwind config, because that is what most of this is built in
 *
 * All four are GENERATED from one `DesignTokens`, so they cannot disagree —
 * the rule /llms.txt and the sitemap already follow here.
 *
 * ── THE LOGO TRAVELS AS BYTES ───────────────────────────────────────────────
 * `brand.logo` is a path inside the bundle (`assets/logo.png`), never a URL. A
 * signed URL from the files bucket expires within the hour, so a bundle
 * carrying one is broken by the time somebody opens it — and it would persist a
 * read capability into every copy of the zip. Same reasoning as `rb-file:`.
 */

import { toDesignJson, toDesignMd, type DesignTokens } from '@/lib/design/tokens';
import { fileSlug } from '@/lib/design/extract';
import { readableOn } from '@/lib/design/color';

export interface BundleFile { path: string; content: string | Uint8Array }

const cssName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Custom properties, ready to paste into a stylesheet.
 *
 * Named `--brand-*` rather than `--accent` on purpose: this file gets dropped
 * into a codebase that already has its own tokens, and a collision would
 * silently repaint the host app rather than the brand.
 */
export function tokensCss(t: DesignTokens): string {
  const L: string[] = [];
  L.push(`/* ${t.brand.name || 'Brand'} — generated from DESIGN.md. Edit the source, not this file. */`);
  L.push(':root {');
  for (const c of t.colors || []) if (c.name && c.hex) L.push(`  --brand-${cssName(c.name)}: ${c.hex.toUpperCase()};`);
  if (t.type.heading) L.push(`  --brand-font-heading: "${t.type.heading}";`);
  if (t.type.body) L.push(`  --brand-font-body: "${t.type.body}";`);
  if (t.type.mono) L.push(`  --brand-font-mono: "${t.type.mono}";`);
  // One custom property per FIELD of a level, not one per size. A level is a
  // size AND a weight AND a leading AND a tracking, and emitting only the size
  // is how every generated heading came out at 400 with default leading.
  for (const l of t.type.levels || []) {
    const n = cssName(l.name);
    L.push(`  --brand-text-${n}: ${l.fontSize}px;`);
    if (l.fontWeight) L.push(`  --brand-text-${n}-weight: ${l.fontWeight};`);
    if (l.lineHeight) L.push(`  --brand-text-${n}-leading: ${l.lineHeight};`);
    if (l.letterSpacing) L.push(`  --brand-text-${n}-tracking: ${l.letterSpacing};`);
  }
  (t.space.scale || []).forEach((n, i) => L.push(`  --brand-space-${SPACE_NAMES[i] || i + 1}: ${n}px;`));
  for (const r of t.radius || []) L.push(`  --brand-radius-${cssName(r.name)}: ${r.px}px;`);
  for (const e of t.elevation || []) L.push(`  --brand-shadow-${cssName(e.name)}: ${resolveRefs(e.value, t)};`);
  L.push('}');
  L.push('');
  // The levels again as ready-made classes. A variable still leaves four
  // declarations to write per heading, and the point of a level is that it is
  // one decision — so the file ships the decision, not the ingredients.
  for (const l of t.type.levels || []) {
    const n = cssName(l.name);
    const fam = l.fontFamily
      ? `"${l.fontFamily}"`
      : /^h[1-6]$|^display|^title/i.test(l.name) ? 'var(--brand-font-heading, inherit)' : 'var(--brand-font-body, inherit)';
    L.push(`.brand-${n} {`);
    L.push(`  font-family: ${fam};`);
    L.push(`  font-size: var(--brand-text-${n});`);
    if (l.fontWeight) L.push(`  font-weight: var(--brand-text-${n}-weight);`);
    if (l.lineHeight) L.push(`  line-height: var(--brand-text-${n}-leading);`);
    if (l.letterSpacing) L.push(`  letter-spacing: var(--brand-text-${n}-tracking);`);
    L.push('}');
  }
  L.push('');
  return L.join('\n');
}

/** The spec's own step names, so `{spacing.md}` resolves to something real. */
const SPACE_NAMES = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'];

/**
 * `{colors.primary}` → the hex it points at.
 *
 * The spec allows token references anywhere, and a CSS file containing a
 * literal `{colors.primary}` is a broken declaration the browser drops in
 * silence. Unresolvable references are left ALONE rather than blanked: a
 * visible `{colors.tertiary}` in the output is a question somebody can answer,
 * and an empty value is a mystery.
 */
export function resolveRefs(value: string, t: DesignTokens): string {
  return String(value || '').replace(/\{([a-z]+)\.([A-Za-z0-9_-]+)\}/g, (whole, group, key) => {
    if (group === 'colors') return t.colors.find((c) => c.name === key)?.hex.toUpperCase() ?? whole;
    if (group === 'rounded') { const r = t.radius.find((x) => x.name === key); return r ? `${r.px}px` : whole; }
    if (group === 'spacing') {
      const i = SPACE_NAMES.indexOf(key);
      const n = i >= 0 ? t.space.scale?.[i] : undefined;
      return n === undefined ? whole : `${n}px`;
    }
    return whole;
  });
}

/** A `theme.extend` fragment. Not a whole config — merging beats replacing. */
export function tailwindFragment(t: DesignTokens): string {
  const theme: Record<string, any> = {};
  const colors = Object.fromEntries((t.colors || []).filter((c) => c.name && c.hex).map((c) => [cssName(c.name), c.hex.toUpperCase()]));
  if (Object.keys(colors).length) theme.colors = { brand: colors };

  const font: Record<string, string[]> = {};
  if (t.type.heading) font.heading = [t.type.heading, 'sans-serif'];
  if (t.type.body) font.body = [t.type.body, 'sans-serif'];
  if (t.type.mono) font.mono = [t.type.mono, 'monospace'];
  if (Object.keys(font).length) theme.fontFamily = font;

  // Tailwind's tuple form: ['16px', {lineHeight, letterSpacing, fontWeight}].
  // The plain string form carries the size alone, which loses three quarters of
  // what a type level actually is.
  if (t.type.levels?.length) {
    theme.fontSize = Object.fromEntries(t.type.levels.map((l) => {
      const extra: Record<string, string | number> = {};
      if (l.lineHeight) extra.lineHeight = String(l.lineHeight);
      if (l.letterSpacing) extra.letterSpacing = l.letterSpacing;
      if (l.fontWeight) extra.fontWeight = l.fontWeight;
      return [cssName(l.name), Object.keys(extra).length ? [`${l.fontSize}px`, extra] : `${l.fontSize}px`];
    }));
  }
  if (t.radius?.length) theme.borderRadius = Object.fromEntries(t.radius.map((r) => [cssName(r.name), `${r.px}px`]));
  if (t.space.scale?.length) theme.spacing = Object.fromEntries(t.space.scale.map((n, i) => [SPACE_NAMES[i] || String(i + 1), `${n}px`]));
  if (t.elevation?.length) theme.boxShadow = Object.fromEntries(t.elevation.map((e) => [cssName(e.name), resolveRefs(e.value, t)]));

  return `// ${t.brand.name || 'Brand'} — generated from DESIGN.md. Merge into tailwind.config.js.
module.exports = {
  theme: {
    extend: ${JSON.stringify(theme, null, 6).replace(/\n/g, '\n  ')},
  },
};
`;
}

/**
 * The README that stops a bundle becoming four files nobody knows what to do
 * with. Written for the person who received it, not the one who made it.
 */
function bundleReadme(t: DesignTokens, hasLogo: boolean): string {
  const name = t.brand.name || 'This brand';
  return `# ${name} — brand bundle

Four files, four readers. They are all generated from one source, so they cannot
disagree with each other.

| File | Who reads it | What to do with it |
|---|---|---|
| \`DESIGN.md\` | a person, and an AI agent | Put it at the root of the repo or the project folder. Claude Code, Cursor and Copilot pick it up. |
| \`design.json\` | scripts and build steps | The exact values, nothing else. Import it. |
| \`tokens.css\` | the browser | Paste into your stylesheet, or \`@import\` it. Everything is a \`--brand-*\` custom property. |
| \`tailwind.tokens.js\` | Tailwind | Merge into \`theme.extend\`. It is a fragment, not a whole config. |
${hasLogo ? '| `assets/` | everyone | The logo, as supplied. `DESIGN.md` refers to it by this path. |\n' : ''}
## Using it with an AI agent

Drop \`DESIGN.md\` where the agent will read it — the repository root for a
coding agent, or the project folder. The exact values sit in a fenced JSON block
near the top so the model can lift them verbatim; the prose underneath is the
part it cannot work out from a screenshot.

If you use RunButter, the same content is also installable as an agent skill
(\`skills/design/SKILL.md\` in the plugin export), which every agent carries
automatically instead of being told to read a file.

## Keeping it true

Regenerate rather than editing these by hand. A hand-edited \`tokens.css\` is
right until the next export overwrites it, and a hand-edited \`DESIGN.md\` is how
the JSON block and the prose start describing different colours.
`;
}

/**
 * The whole bundle.
 *
 * `logo` is optional bytes; when present, `tokens.brand.logo` should already
 * name the path this writes it to, which the studio sets at upload time.
 */
export function designFiles(
  t: DesignTokens,
  logo?: { name: string; bytes: Uint8Array } | null,
): BundleFile[] {
  const files: BundleFile[] = [
    { path: 'DESIGN.md', content: toDesignMd(t) },
    { path: 'design.json', content: JSON.stringify(toDesignJson(t), null, 2) + '\n' },
    { path: 'tokens.css', content: tokensCss(t) },
    { path: 'tailwind.tokens.js', content: tailwindFragment(t) },
    { path: 'README.md', content: bundleReadme(t, !!logo) },
  ];
  if (logo) files.push({ path: `assets/${logo.name}`, content: logo.bytes });
  return files;
}

export const bundleName = (t: DesignTokens) => `${fileSlug(t.brand.name)}-brand`;

/**
 * The same brand as an agent skill.
 *
 * ── A SKILL, NOT A NEW FILE TYPE ────────────────────────────────────────────
 * Agent Plugins 1.0 defines exactly one place instructions live —
 * `skills/<name>/SKILL.md` — and `npm run check:plugin` is a CI gate on that
 * shape. Inventing a parallel `design/` directory would produce a package no
 * conforming client loads, for no gain: a design spec IS a reusable instruction
 * pack, which is the definition of a skill.
 *
 * `design.json` rides along as a skill RESOURCE. That is the second level of
 * progressive disclosure: the model reads SKILL.md when the skill fires and
 * opens the JSON only when it needs an exact value.
 */
export function designSkill(t: DesignTokens) {
  const name = t.brand.name || 'Our brand';
  return {
    name: 'design',
    title: `${name} design`,
    description: `How to make something that looks like ${name}: the exact colours, typography levels, spacing, shapes, components, voice and the things we never do. Use when designing anything, writing UI copy, building a page or a graphic, or choosing a colour.`,
    instructions: toDesignMd(t),
    resources: [{
      path: 'design.json',
      content: JSON.stringify(toDesignJson(t), null, 2) + '\n',
      purpose: 'The DESIGN.md tokens as JSON — colors, typography levels, spacing, rounded, components. Read it when you need a hex code, a font, a weight or a size and want to be certain rather than close.',
    }],
  };
}

/**
 * A contrast report over the palette, as rows a table can render.
 *
 * Every colour is checked against the background AND against white and black,
 * because "our accent is unreadable on our own background" is the single most
 * common defect in a brand somebody assembled from a logo — and it is invisible
 * until a real button exists.
 */
export function contrastRows(t: DesignTokens): { fg: string; bg: string; label: string }[] {
  const at = (n: string) => t.colors.find((c) => c.name === n)?.hex;
  const bg = at('background') || '#FFFFFF';
  const surface = at('surface');
  const rows: { fg: string; bg: string; label: string }[] = [];
  for (const c of t.colors) {
    if (c.name === 'background' || c.name === 'surface' || /^on-/.test(c.name)) continue;
    rows.push({ fg: c.hex, bg, label: `${c.name} on background` });
    if (surface) rows.push({ fg: c.hex, bg: surface, label: `${c.name} on surface` });
  }
  // The button label, which is the pairing that fails most often and the one
  // nobody checks: a palette can be perfect and still ship a primary button
  // whose text cannot be read on it. `on-primary` is used when the spec names
  // one, so the check tests what will actually be rendered rather than what we
  // would have picked.
  const primary = at('primary') || at('accent');
  if (primary) {
    rows.push({ fg: at('on-primary') || readableOn(primary), bg: primary, label: 'label on primary' });
  }
  return rows;
}
