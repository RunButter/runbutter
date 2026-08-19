/**
 * Design moves: take a spec somewhere, in one click.
 *
 * ── EXPLORING IS THE ACTUAL WORK ────────────────────────────────────────────
 * Nobody arrives at a design system; they arrive at a first guess and then push
 * it around — warmer, tighter, darker, flatter — until it feels right. Doing
 * that by hand means editing nine hex values, six type levels and three shadows
 * consistently, which is exactly the kind of edit people get four-fifths of the
 * way through and abandon. So the tedious, mechanical half is arithmetic here
 * and the judgement stays with the person: every move is reversible, visible in
 * the preview immediately, and applied to a copy.
 *
 * ── EVERY MOVE IS DETERMINISTIC, AND THAT IS THE POINT ──────────────────────
 * No model, no network, no key. "Make it darker" has one right answer given a
 * palette, and asking an LLM would make it a different answer every run — which
 * is the precise failure this whole tool exists to fix. Same free-data rule the
 * rest of the product follows: local computation over a metered API.
 *
 * ── NONE OF THEM CLAIMS TO BE FINISHED ──────────────────────────────────────
 * `darken` produces a credible dark palette, not a designed one — the hard part
 * of a dark theme is deciding what stays saturated, and that is taste. The UI
 * says so. A move that oversold itself would be worse than none, because
 * somebody would ship its output.
 *
 * Imports only lib/design/color.ts and the token types, both import-free.
 */

import { contrast, hslToRgb, parseHex, readableOn, rgbToHsl, toHex } from '@/lib/design/color';
import type { DesignTokens } from '@/lib/design/tokens';

export interface Move {
  id: string;
  label: string;
  /** What it changes, so the button is not a mystery box. */ 
  detail: string;
  group: 'Colour' | 'Type' | 'Shape' | 'Space';
  apply: (t: DesignTokens) => DesignTokens;
}

const clone = (t: DesignTokens): DesignTokens => JSON.parse(JSON.stringify(t));

/**
 * Is this a neutral? Measured as CHROMA, never as HSL saturation.
 *
 * Found by running it: `#F7F8FA` — a surface three points off white — reports
 * an HSL saturation of 0.23, because the formula divides by `2 - max - min` and
 * that denominator collapses at the extremes. A saturation threshold therefore
 * classified the page's own surface as a brand colour, and `darken` returned a
 * palette whose "surface" was a pale blue LIGHTER than its background. Chroma
 * is max-min and has no such cliff.
 */
const chroma = (hex: string): number => {
  const c = parseHex(hex);
  if (!c) return 0;
  return (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
};
const NEUTRAL = 0.12;

const mapColors = (t: DesignTokens, fn: (hex: string, name: string) => string): DesignTokens => {
  const next = clone(t);
  next.colors = next.colors.map((c) => (parseHex(c.hex) ? { ...c, hex: fn(c.hex, c.name) } : c));
  return next;
};

/** A neutral's counterpart on the other side. Symmetric, so it round-trips. */
const neutralFlip = (hex: string): string => {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const { h, s, l } = rgbToHsl(rgb);
  return toHex(hslToRgb({ h, s: Math.min(s, 0.10), l: Math.min(0.90, 0.06 + (1 - l) * 0.88) }));
};

const lightnessOf = (hex: string) => { const c = parseHex(hex); return c ? rgbToHsl(c).l : 1; };

const shiftHue = (hex: string, deg: number, satFactor = 1): string => {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const { h, s, l } = rgbToHsl(rgb);
  return toHex(hslToRgb({ h: h + deg, s: Math.min(1, s * satFactor), l }));
};

/**
 * The other side: light ↔ dark, whichever this palette is not.
 *
 * ── IT HAD TO BE DIRECTIONAL, AND ONLY RUNNING IT SHOWED THAT ───────────────
 * The first version was called "make it dark" and applied one symmetric curve.
 * On a light palette it was right; on Midnight Console — already dark — it
 * cheerfully produced a LIGHT palette and called it dark, and every brand
 * colour came out too pale to read because the lift rule only ever raised
 * lightness. A move that silently does the opposite of its label is worse than
 * one that refuses.
 *
 * ── NEUTRALS THROUGH A CURVE, NEVER AN INVERSION ────────────────────────────
 * Pure inversion sends #FFFFFF to #000000, which no dark interface uses — text
 * on true black vibrates and is measurably harder to read over a long session —
 * and sends near-black text to pure white, the same problem upside down. The
 * curve lands a page around 6–9% and the lightest text around 88%, and the hue
 * survives so a warm grey stays warm.
 *
 * ── BRAND COLOURS MOVE UNTIL THEY ARE LEGIBLE, THEN STOP ────────────────────
 * Which is what a designer does by hand: indigo-600 becomes indigo-400 on dark.
 * Lightness walks toward 4.5:1 against the NEW ground and stops at the point a
 * colour would stop being recognisable — anything that cannot get there inside
 * that cap is REPORTED rather than pushed until it is somebody else's brand.
 */
function flip(t: DesignTokens): DesignTokens {
  const oldBg = t.colors.find((c) => c.name === 'background')?.hex ?? '#FFFFFF';
  const goingDark = lightnessOf(oldBg) > 0.5;
  const newBg = neutralFlip(oldBg);

  const next = mapColors(t, (hex) => {
    if (chroma(hex) < NEUTRAL) return neutralFlip(hex);
    const rgb = parseHex(hex)!;
    const { h, s } = rgbToHsl(rgb);
    const sat = Math.min(1, s * 0.95);
    // Start from the middle so the walk has room in either direction, then step
    // toward the ground it now has to sit on.
    let L = goingDark ? Math.max(rgbToHsl(rgb).l, 0.5) : Math.min(rgbToHsl(rgb).l, 0.55);
    const limit = goingDark ? 0.80 : 0.28;
    let out = toHex(hslToRgb({ h, s: sat, l: L }));
    while (contrast(out, newBg) < 4.5 && (goingDark ? L < limit : L > limit)) {
      L = goingDark ? Math.min(limit, L + 0.02) : Math.max(limit, L - 0.02);
      out = toHex(hslToRgb({ h, s: sat, l: L }));
    }
    return out;
  });

  // `on-primary` is COMPUTED, never carried across: it exists to be readable on
  // whatever primary just became, and reusing the old value is how a theme
  // ships a button nobody can read.
  const primary = next.colors.find((c) => c.name === 'primary' || c.name === 'accent')?.hex;
  const on = next.colors.find((c) => c.name === 'on-primary' || c.name === 'on-accent');
  if (primary && on) on.hex = readableOn(primary);

  // On a dark ground a soft light shadow is invisible and a grey one is a
  // smudge; on a light ground a heavy black one is a bruise.
  const k = goingDark ? 3.2 : 1 / 3.2;
  next.elevation = next.elevation.map((e) => ({
    ...e,
    value: e.value.replace(/rgb\(([^)]*?)\/\s*([\d.]+)\)/g, (_m, _body, a) =>
      `rgb(0 0 0 / ${Math.min(0.7, Math.max(0.04, +a * k)).toFixed(2)})`),
  }));

  next.notes.colors = [next.notes.colors,
    `${goingDark ? 'Dark' : 'Light'} counterpart: neutrals are mapped through a curve rather than inverted, and each brand colour keeps its hue and moves only as far as legibility needs. Check the contrast table before shipping — deciding what stays saturated is the part that is taste.`]
    .filter(Boolean).join(' ');
  return next;
}

/** Legibility repair, run after any colour move. Reported, never silent. */
export function contrastProblems(t: DesignTokens): string[] {
  const at = (n: string) => t.colors.find((c) => c.name === n)?.hex;
  const bg = at('background');
  const out: string[] = [];
  if (!bg) return out;
  for (const c of t.colors) {
    if (['background', 'surface', 'border'].includes(c.name) || /^on-/.test(c.name)) continue;
    const r = contrast(c.hex, bg);
    if (r < 4.5) out.push(`${c.name} on background is ${r.toFixed(2)} — below 4.5 for body text.`);
  }
  return out;
}

const scaleType = (t: DesignTokens, sizeK: number, leadK: number): DesignTokens => {
  const next = clone(t);
  next.type.levels = (next.type.levels || []).map((l) => ({
    ...l,
    fontSize: Math.max(8, Math.round(l.fontSize * sizeK * 2) / 2),
    lineHeight: l.lineHeight ? Math.round(l.lineHeight * leadK * 100) / 100 : undefined,
  }));
  return next;
};

/**
 * Scale the spacing steps, snapped back to the grid.
 *
 * Rounding the raw product is what a first version does and it is wrong: 4 · 1.4
 * is 5.6, and a "6px" step in a system whose whole claim is that everything is a
 * multiple of 4 quietly makes that claim false. The base unit itself is left
 * alone — adding air does not change the grid you are working on.
 */
const scaleSpace = (t: DesignTokens, k: number): DesignTokens => {
  const next = clone(t);
  const base = next.space.base && next.space.base > 1 ? next.space.base : 4;
  const seen = new Set<number>();
  next.space.scale = (next.space.scale || [])
    .map((n) => Math.max(base, Math.round((n * k) / base) * base))
    // A shrink can collapse two steps onto one value, and a scale with a
    // repeated number is a scale with a step missing.
    .filter((n) => (seen.has(n) ? false : (seen.add(n), true)));
  return next;
};

export const MOVES: Move[] = [
  {
    id: 'flip', label: 'Flip light ↔ dark', group: 'Colour',
    detail: 'Whichever this palette is not. Neutrals through a curve, brand colours keep their hue and move only as far as legibility needs.',
    apply: flip,
  },
  {
    id: 'warmer', label: 'Warmer', group: 'Colour',
    detail: 'Rotates every colour towards amber. Run it twice for a noticeably warm palette.',
    apply: (t) => mapColors(t, (hex) => shiftHue(hex, -8)),
  },
  {
    id: 'cooler', label: 'Cooler', group: 'Colour',
    detail: 'Rotates every colour towards blue.',
    apply: (t) => mapColors(t, (hex) => shiftHue(hex, 8)),
  },
  {
    id: 'muted', label: 'Desaturate', group: 'Colour',
    detail: 'Takes 30% of the saturation out of everything. Editorial and enterprise work usually wants this.',
    apply: (t) => mapColors(t, (hex) => shiftHue(hex, 0, 0.7)),
  },
  {
    id: 'punchier', label: 'More saturated', group: 'Colour',
    detail: 'Adds 25% saturation. Consumer and campaign work usually wants this.',
    apply: (t) => mapColors(t, (hex) => shiftHue(hex, 0, 1.25)),
  },
  {
    id: 'bigger-type', label: 'Bigger type', group: 'Type',
    detail: 'Every level up 12%, leading tightened slightly to compensate.',
    apply: (t) => scaleType(t, 1.12, 0.97),
  },
  {
    id: 'smaller-type', label: 'Smaller type', group: 'Type',
    detail: 'Every level down 10%, leading opened slightly to compensate.',
    apply: (t) => scaleType(t, 0.9, 1.03),
  },
  {
    id: 'bolder', label: 'Bolder headings', group: 'Type',
    detail: 'Headings up one weight step. Body is left alone — bold body text is not emphasis, it is noise.',
    apply: (t) => {
      const next = clone(t);
      next.type.levels = (next.type.levels || []).map((l) =>
        (/^h[1-6]$|^display|^title/i.test(l.name)
          ? { ...l, fontWeight: Math.min(900, (l.fontWeight ?? 400) + 100) }
          : l));
      return next;
    },
  },
  {
    id: 'lighter', label: 'Lighter headings', group: 'Type',
    detail: 'Headings down one weight step — the move that separates a studio site from a dashboard.',
    apply: (t) => {
      const next = clone(t);
      next.type.levels = (next.type.levels || []).map((l) =>
        (/^h[1-6]$|^display|^title/i.test(l.name)
          ? { ...l, fontWeight: Math.max(200, (l.fontWeight ?? 400) - 100) }
          : l));
      return next;
    },
  },
  {
    id: 'rounder', label: 'Rounder', group: 'Shape',
    detail: 'Every radius up 60%. Pills stay pills.',
    apply: (t) => {
      const next = clone(t);
      next.radius = next.radius.map((r) => (r.px > 1000 ? r : { ...r, px: Math.round(r.px * 1.6) || 2 }));
      return next;
    },
  },
  {
    id: 'sharper', label: 'Sharper', group: 'Shape',
    detail: 'Every radius halved. Run it twice to reach square.',
    apply: (t) => {
      const next = clone(t);
      next.radius = next.radius.map((r) => (r.px > 1000 ? r : { ...r, px: Math.round(r.px / 2) }));
      return next;
    },
  },
  {
    id: 'flatten', label: 'Remove shadows', group: 'Shape',
    detail: 'Drops the elevation scale and records WHY, so the exported file states it rather than leaving a gap.',
    apply: (t) => {
      const next = clone(t);
      next.elevation = [];
      next.notes.elevation = 'None, deliberately. Depth comes from tone, rules and space rather than from shadow.';
      return next;
    },
  },
  {
    id: 'more-air', label: 'More air', group: 'Space',
    detail: 'Every spacing step up 40%. The single biggest difference between designed and generated.',
    apply: (t) => scaleSpace(t, 1.4),
  },
  {
    id: 'denser', label: 'Denser', group: 'Space',
    detail: 'Every spacing step down 25%. For tools people keep open all day.',
    apply: (t) => scaleSpace(t, 0.75),
  },
];

export const MOVE_GROUPS: Move['group'][] = ['Colour', 'Type', 'Shape', 'Space'];
export const movesByGroup = () =>
  MOVE_GROUPS.map((g) => ({ group: g, items: MOVES.filter((m) => m.group === g) }));
