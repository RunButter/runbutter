/**
 * Reading a brand out of the files a designer already has.
 *
 * ── WHY EXTRACTION AND NOT "JUST ASK THE MODEL" ─────────────────────────────
 * The usual advice is to hand a brand PDF to an AI and let it work the brand
 * out. It cannot, repeatably: a PDF is glyph runs and pixels, so the model
 * re-derives the palette on every run and lands somewhere slightly different
 * each time. #0A2540 becomes "a deep navy" becomes #0B2A46.
 *
 * These functions are arithmetic and regular expressions. Given the same logo
 * they return the same hex, every time, and the hex is one that is LITERALLY IN
 * THE FILE rather than near it.
 *
 * ── EVERYTHING HERE IS A PROPOSAL ───────────────────────────────────────────
 * Nothing writes. A logo's most common colour is usually the brand colour and
 * sometimes it is the drop shadow; a "#" in a PDF is usually a swatch and
 * sometimes it is a page reference. So this returns candidates with enough
 * context to judge them, and a person ticks the ones that are right — the same
 * shape as /api/workspace/build, for the same reason.
 *
 * Only imports lib/design/color.ts, which itself imports nothing.
 */

import { distance, lightness, parseHex, saturation, toHex } from '@/lib/design/color';

export interface RawSwatch {
  hex: string;
  /** Fraction of the sampled pixels, 0–1. */
  share: number;
}

/**
 * The colours actually in an image.
 *
 * ── THE MODAL EXACT PIXEL, NOT A BUCKET AVERAGE ─────────────────────────────
 * Quantising to buckets and reporting the bucket is the textbook approach and
 * it is wrong here: it shifts a flat brand colour by up to eight per channel,
 * which is exactly the "approximately your blue" failure this tool exists to
 * prevent. Logos are flat colour, so the brand hex is generally the single most
 * common exact pixel value. Buckets are used only to GROUP, and each group
 * reports its most common exact member.
 *
 * Near-transparent pixels are skipped (a PNG logo is mostly nothing), and the
 * sample is strided so a 4000px asset costs the same as a 400px one.
 */
export function paletteFromPixels(
  px: Uint8ClampedArray,
  opts: { max?: number; minShare?: number; merge?: number } = {},
): RawSwatch[] {
  const { max = 8, minShare = 0.005, merge = 40 } = opts;
  const total = Math.floor(px.length / 4);
  if (!total) return [];

  // ~120k samples is plenty to find a flat colour and cheap on any machine.
  const stride = Math.max(1, Math.floor(total / 120_000));
  const exact = new Map<number, number>();
  let counted = 0;

  for (let i = 0; i < total; i += stride) {
    const o = i * 4;
    if (px[o + 3] < 200) continue;            // transparent, or a soft edge
    const key = (px[o] << 16) | (px[o + 1] << 8) | px[o + 2];
    exact.set(key, (exact.get(key) || 0) + 1);
    counted++;
  }
  if (!counted) return [];

  // Group by a coarse bucket, keeping the most common exact colour in each.
  const groups = new Map<number, { key: number; n: number; total: number }>();
  for (const [key, n] of exact) {
    const b = ((key >> 20) & 0xf) << 8 | ((key >> 12) & 0xf) << 4 | ((key >> 4) & 0xf);
    const g = groups.get(b);
    if (!g) groups.set(b, { key, n, total: n });
    else { g.total += n; if (n > g.n) { g.key = key; g.n = n; } }
  }

  const sorted = [...groups.values()].sort((a, b) => b.total - a.total)
    .map((g) => ({
      hex: toHex({ r: (g.key >> 16) & 0xff, g: (g.key >> 8) & 0xff, b: g.key & 0xff }),
      share: g.total / counted,
    }))
    .filter((s) => s.share >= minShare);

  // Second pass: adjacent buckets split one colour in half. Merge anything
  // perceptually close into the bigger of the pair, keeping ITS exact hex.
  const out: RawSwatch[] = [];
  for (const s of sorted) {
    const near = out.find((o) => distance(o.hex, s.hex) < merge);
    if (near) near.share += s.share;
    else out.push({ ...s });
    if (out.length >= max) break;
  }
  return out;
}

export interface PaletteRoles {
  accent?: string;
  foreground?: string;
  background?: string;
  /** Everything real that did not get a role. */
  extras: string[];
}

/**
 * Which of those colours is the accent.
 *
 * A logo's biggest area is usually its background, its darkest neutral is
 * usually the text, and the brand colour is the most saturated thing with a
 * meaningful share. That heuristic is right most of the time and openly not
 * always, which is why the studio shows every swatch and lets one be reassigned
 * in a click rather than presenting this as the answer.
 */
export function assignRoles(sw: RawSwatch[]): PaletteRoles {
  const roles: PaletteRoles = { extras: [] };
  if (!sw.length) return roles;

  const colourful = sw.filter((s) => saturation(s.hex) >= 0.2 && lightness(s.hex) > 0.12 && lightness(s.hex) < 0.9);
  roles.accent = colourful.sort((a, b) => (saturation(b.hex) * b.share) - (saturation(a.hex) * a.share))[0]?.hex;

  const neutral = sw.filter((s) => saturation(s.hex) < 0.2);
  roles.background = neutral.filter((s) => lightness(s.hex) > 0.85).sort((a, b) => b.share - a.share)[0]?.hex;
  roles.foreground = neutral.filter((s) => lightness(s.hex) < 0.35).sort((a, b) => b.share - a.share)[0]?.hex;

  const taken = new Set([roles.accent, roles.background, roles.foreground].filter(Boolean) as string[]);
  roles.extras = sw.map((s) => s.hex).filter((h) => !taken.has(h));
  return roles;
}

// ─── Brand documents ────────────────────────────────────────────────────────

export interface TextFinding<T> { value: T; context: string }

export interface BrandProposal {
  colors: TextFinding<string>[];
  fonts: string[];
  sizes: number[];
  radii: number[];
  rules: { do: string[]; dont: string[] };
  /** Things seen and deliberately NOT converted. Shown, never silently dropped. */
  notes: string[];
}

/**
 * Font names we will claim to have recognised.
 *
 * A whitelist, not a capture group. "Typeface: our house sans, set in" reads as
 * a font name to any regex that trusts capitalisation, and a brand spec full of
 * invented font names is worse than one with none — the whole file is supposed
 * to be the thing you can trust literally.
 */
const KNOWN_FONTS = [
  'Inter', 'Geist', 'Helvetica Neue', 'Helvetica', 'Arial', 'Roboto', 'Open Sans', 'Lato',
  'Montserrat', 'Poppins', 'Raleway', 'Nunito', 'Work Sans', 'DM Sans', 'Manrope', 'Rubik',
  'Source Sans', 'Source Serif', 'IBM Plex Sans', 'IBM Plex Mono', 'IBM Plex Serif',
  'Playfair Display', 'Merriweather', 'Lora', 'Georgia', 'Garamond', 'Times New Roman',
  'Futura', 'Avenir', 'Gotham', 'Proxima Nova', 'Circular', 'Graphik', 'Söhne', 'Suisse',
  'Neue Haas', 'Univers', 'Frutiger', 'Gill Sans', 'Baskerville', 'Didot', 'Bodoni',
  'JetBrains Mono', 'Fira Code', 'Fira Sans', 'Roboto Mono', 'Space Grotesk', 'Space Mono',
  'Courier New', 'Menlo', 'Monaco', 'Consolas', 'Cabinet Grotesk', 'Satoshi', 'General Sans',
  'Karla', 'Barlow', 'Oswald', 'Quicksand', 'Mulish', 'Outfit', 'Sora', 'Urbanist', 'Figtree',
];

const CUE = /(pantone|pms\s*\d|cmyk|spot colou?r|c\s*\d{1,3}\s*m\s*\d{1,3})/i;

/**
 * Everything machine-readable in a brand document's text.
 *
 * Works on whatever produced the text — `pdfToMarkdown` for a PDF, a paste, a
 * `.md`. Nothing here is PDF-specific, which is what keeps it testable.
 */
export function proposeFromText(raw: string): BrandProposal {
  const text = String(raw || '');
  const out: BrandProposal = { colors: [], fonts: [], sizes: [], radii: [], rules: { do: [], dont: [] }, notes: [] };
  if (!text.trim()) return out;

  const lines = text.split(/\r?\n/);

  // ── Colours. The label is whatever sits before the hex on its line, which is
  // how nearly every brand book writes one: "Primary Blue  #0A2540".
  const seen = new Set<string>();
  for (const line of lines) {
    const re = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const rgb = parseHex(m[0]);
      if (!rgb) continue;
      const hex = toHex(rgb);
      if (seen.has(hex)) continue;
      seen.add(hex);
      const before = line.slice(0, m.index).trim().replace(/[|:—–\-•\t]+$/, '').trim();
      out.colors.push({ value: hex, context: before.slice(-48) || line.trim().slice(0, 48) });
    }
    // rgb(10, 37, 64) — same idea, different notation.
    const rgbRe = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;
    let r: RegExpExecArray | null;
    while ((r = rgbRe.exec(line))) {
      const hex = toHex({ r: +r[1], g: +r[2], b: +r[3] });
      if (seen.has(hex)) continue;
      seen.add(hex);
      const pre = line.slice(0, r.index).trim().replace(/[|:—–\-•\t]+$/, '').trim();
      out.colors.push({ value: hex, context: pre.slice(-48) });
    }
  }

  // Pantone and CMYK are NAMED, never converted. Pantone is a licensed system
  // with no free lookup table, and CMYK→RGB depends on the paper and the press.
  // A confident hex derived from either is a fabricated number, which is the
  // same lie as a made-up sparkline.
  if (CUE.test(text)) {
    out.notes.push('This document mentions Pantone or CMYK values. Those are not converted — Pantone has no free lookup and CMYK depends on the press, so a hex derived from either would be invented. Type the RGB or hex your designer intends.');
  }

  // ── Fonts, from a whitelist.
  for (const f of KNOWN_FONTS) {
    const re = new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(text) && !out.fonts.some((x) => x.toLowerCase() === f.toLowerCase())) out.fonts.push(f);
  }

  // ── Numbers. Sizes as px/pt, radii only when the word is nearby.
  const sizes = new Set<number>();
  const sizeRe = /\b(\d{1,3})(?:\.\d+)?\s*(px|pt)\b/gi;
  let s: RegExpExecArray | null;
  while ((s = sizeRe.exec(text))) { const n = +s[1]; if (n >= 8 && n <= 200) sizes.add(n); }
  out.sizes = [...sizes].sort((a, b) => a - b);

  const radii = new Set<number>();
  const radRe = /(?:radius|corner|rounded)[^.\n]{0,24}?(\d{1,3})\s*(?:px|pt)?/gi;
  let d: RegExpExecArray | null;
  while ((d = radRe.exec(text))) { const n = +d[1]; if (n >= 0 && n <= 100) radii.add(n); }
  out.radii = [...radii].sort((a, b) => a - b);

  // ── Rules. A brand book's most valuable pages are its don'ts, and they are
  // written in a shape a regex can find: "Never stretch the logo."
  const sentences = text.split(/(?<=[.!?])\s+|\n/).map((x) => x.trim()).filter((x) => x.length > 12 && x.length < 220);
  for (const line of sentences) {
    if (/\b(never|do not|don['’]t|avoid|must not|no longer)\b/i.test(line)) {
      if (out.rules.dont.length < 12 && !out.rules.dont.includes(line)) out.rules.dont.push(line);
    } else if (/\b(always|must|should always|make sure)\b/i.test(line)) {
      if (out.rules.do.length < 12 && !out.rules.do.includes(line)) out.rules.do.push(line);
    }
  }

  if (!out.colors.length && !out.fonts.length) {
    out.notes.push('No hex codes or recognisable font names were found. If this is a scanned or image-only PDF there is no text to read — the values will need typing in, and the logo upload can still find the colours.');
  }
  return out;
}

/**
 * A slug that is safe as a file name and stable across exports.
 * Collapses any run of separators to the first, the same fix `pluginSlug` needed.
 */
export const fileSlug = (s: string) =>
  String(s || 'brand').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'brand';
