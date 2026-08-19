/**
 * Colour maths, exactly.
 *
 * Every function here is deterministic and has one right answer, which is the
 * whole reason the design tool has a file for it: a contrast ratio judged by
 * eye is a guess, and a shade ramp mixed by hand drifts. Both are arithmetic.
 *
 * Zero imports — a route handler, a client component and a test all read the
 * same code, the rule lib/finance/runway.ts and lib/vault/password.ts follow.
 */

export interface RGB { r: number; g: number; b: number }
export interface HSL { h: number; s: number; l: number }

const clamp = (n: number, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, n));

/** `#abc`, `#aabbcc`, with or without the hash. Null when it is not a colour. */
export function parseHex(input: string): RGB | null {
  const s = String(input || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) {
    return { r: parseInt(s[0] + s[0], 16), g: parseInt(s[1] + s[1], 16), b: parseInt(s[2] + s[2], 16) };
  }
  if (/^[0-9a-f]{6}$/i.test(s)) {
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
  }
  return null;
}

export function toHex({ r, g, b }: RGB): string {
  const h = (n: number) => clamp(Math.round(n)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0));
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const H = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    let T = t; if (T < 0) T += 1; if (T > 1) T -= 1;
    if (T < 1 / 6) return p + (q - p) * 6 * T;
    if (T < 1 / 2) return q;
    if (T < 2 / 3) return p + (q - p) * (2 / 3 - T) * 6;
    return p;
  };
  return { r: Math.round(ch(H + 1 / 3) * 255), g: Math.round(ch(H) * 255), b: Math.round(ch(H - 1 / 3) * 255) };
}

/** WCAG 2.x relative luminance. Not the same as HSL lightness — don't swap them. */
export function luminance(c: RGB): number {
  const f = (n: number) => { const v = n / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** WCAG contrast ratio, 1–21. Order of arguments does not matter. */
export function contrast(a: string, b: string): number {
  const A = parseHex(a), B = parseHex(b);
  if (!A || !B) return 0;
  const l1 = luminance(A), l2 = luminance(B);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The grade, said plainly.
 *
 * `large` means 18.66px bold or 24px regular and above, where the thresholds
 * genuinely are lower — reporting a headline as failing when the spec says it
 * passes teaches people to ignore the check.
 */
export function contrastGrade(ratio: number, large = false): 'AAA' | 'AA' | 'Fail' {
  if (large) return ratio >= 4.5 ? 'AAA' : ratio >= 3 ? 'AA' : 'Fail';
  return ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'Fail';
}

/** Whichever of black/white is more readable on this background. */
export function readableOn(bg: string): '#FFFFFF' | '#111114' {
  return contrast(bg, '#FFFFFF') >= contrast(bg, '#111114') ? '#FFFFFF' : '#111114';
}

export function mix(a: string, b: string, t: number): string {
  const A = parseHex(a), B = parseHex(b);
  if (!A || !B) return a;
  return toHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}

const RAMP: { name: string; l: number }[] = [
  { name: '50', l: 0.97 }, { name: '100', l: 0.94 }, { name: '200', l: 0.86 },
  { name: '300', l: 0.76 }, { name: '400', l: 0.65 }, { name: '500', l: 0.55 },
  { name: '600', l: 0.46 }, { name: '700', l: 0.38 }, { name: '800', l: 0.29 },
  { name: '900', l: 0.20 },
];

/**
 * A tint/shade ramp from one brand colour.
 *
 * ── THE SOURCE COLOUR SURVIVES EXACTLY ──────────────────────────────────────
 * The step nearest the input's own lightness is REPLACED with the input, not
 * approximated to the ramp's ideal. A generated ramp that quietly moves the
 * brand hex by three points per channel is the precise failure this whole tool
 * exists to prevent, and it is invisible until somebody holds a print-out
 * against a screen.
 *
 * Saturation is eased towards the ends because a fully saturated 50 looks like
 * a highlighter and a fully saturated 900 turns to mud — that part is taste,
 * and it is why this returns a suggestion a person edits rather than a rule.
 */
export function shades(hex: string): { name: string; hex: string }[] {
  const rgb = parseHex(hex);
  if (!rgb) return [];
  const { h, s, l } = rgbToHsl(rgb);
  let nearest = 0, best = Infinity;
  RAMP.forEach((step, i) => { const d = Math.abs(step.l - l); if (d < best) { best = d; nearest = i; } });
  return RAMP.map((step, i) => {
    if (i === nearest) return { name: step.name, hex: toHex(rgb) };
    const distance = Math.abs(step.l - l);
    const sat = s * (1 - Math.min(0.45, distance * 0.6));
    return { name: step.name, hex: toHex(hslToRgb({ h, s: sat, l: step.l })) };
  });
}

/** How colourful, 0–1. Used to tell a brand colour from a grey. */
export const saturation = (hex: string) => { const c = parseHex(hex); return c ? rgbToHsl(c).s : 0; };
/** HSL lightness, 0–1. */
export const lightness = (hex: string) => { const c = parseHex(hex); return c ? rgbToHsl(c).l : 0; };

/**
 * Perceptual-ish distance, 0–~764.
 *
 * Weighted RGB ("redmean"), not plain Euclidean: plain RGB distance calls two
 * blues far apart and two greens identical, so a palette deduped with it keeps
 * three shades of one colour and drops a second brand colour.
 */
export function distance(a: string, b: string): number {
  const A = parseHex(a), B = parseHex(b);
  if (!A || !B) return Infinity;
  const rm = (A.r + B.r) / 2;
  const dr = A.r - B.r, dg = A.g - B.g, db = A.b - B.b;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
