/**
 * Turn a workspace's brand colour into the semantic tokens the whole UI already
 * uses, so a branded surface is a variable override rather than a rewrite.
 *
 * WHY THIS EXISTS. The careers page was brand-coloured and the apply form and
 * assessment were not, so a candidate crossed from the company's colours into
 * RunButter's halfway through applying. The fix is not to sprinkle
 * `style={{ background: accent }}` around — that is what the careers page did,
 * and it is how it ended up with hardcoded `text-white` on an arbitrary fill.
 *
 * Instead this returns overrides for --accent and its family. Every existing
 * `bg-accent` / `text-accent` / `ring-accent` class then resolves to the brand
 * colour with no other change.
 *
 * THE PART THAT IS NOT COSMETIC. --accent-fg is the label drawn ON the accent
 * fill, and in globals.css it is a MEASURED pair: near-black, because white on
 * emerald-500 is 2.56:1 and fails AA outright. A brand colour is arbitrary, so
 * that pairing cannot be inherited — a company picking pale yellow would get
 * near-black (fine) but one picking navy would get near-black on navy
 * (unreadable). So the foreground is computed per colour, and the tinted-text
 * variant is darkened until it actually clears AA on white.
 */

export interface BrandTheme {
  '--accent': string;
  '--accent-fg': string;
  '--accent-soft': string;
  '--accent-text': string;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** #rgb and #rrggbb, case-insensitive. Anything else is not a colour we'll use. */
export function parseHex(hex: string | null | undefined): [number, number, number] | null {
  if (!hex) return null;
  const s = hex.trim();
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m3) return [parseInt(m3[1] + m3[1], 16), parseInt(m3[2] + m3[2], 16), parseInt(m3[3] + m3[3], 16)];
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
  if (m6) return [parseInt(m6[1], 16), parseInt(m6[2], 16), parseInt(m6[3], 16)];
  return null;
}

/** WCAG 2.1 relative luminance. The 0.03928 branch is the sRGB gamma kink. */
export function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];   // achromatic: hue is meaningless
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
  else if (max === G) h = ((B - R) / d + 2) / 6;
  else h = ((R - G) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** The CSS custom-property value shape the tokens use: "160 84% 39%". */
const parts = (h: number, s: number, l: number) =>
  `${Math.round(h)} ${Math.round(clamp(s, 0, 100))}% ${Math.round(clamp(l, 0, 100))}%`;

/**
 * The readable label for text sitting ON this fill.
 *
 * Not a lightness threshold: a saturated mid-blue and a saturated mid-yellow can
 * share a lightness and need opposite labels, so both directions are measured
 * and the stronger one wins.
 *
 * Then it WALKS toward that extreme until AA is actually met, rather than
 * trusting one tinted candidate. Two fixed guesses looked fine on the obvious
 * brand colours and quietly produced 4.45:1 on a mid teal — passing by eye,
 * failing the standard. Keeping as much of the hue as possible while clearing
 * 4.5 is the point of walking rather than jumping straight to black or white.
 *
 * A terminating case always exists: contrast-against-black × contrast-against-
 * white is always 21, so both cannot be below 4.5 at once.
 */
function foregroundFor(rgb: [number, number, number], h: number, s: number): string {
  const darkS = Math.min(s, 80), lightS = Math.min(s, 30);
  const goDark = contrast(rgb, [0, 0, 0]) >= contrast(rgb, [255, 255, 255]);

  if (goDark) {
    for (let l = 20; l >= 0; l -= 2) {
      if (contrast(rgb, hslToRgb(h, darkS, l)) >= 4.5) return parts(h, darkS, l);
    }
    return parts(h, darkS, 0);
  }
  for (let l = 90; l <= 100; l += 2) {
    if (contrast(rgb, hslToRgb(h, lightS, l)) >= 4.5) return parts(h, lightS, l);
  }
  return parts(h, lightS, 100);
}

/**
 * A version of the hue dark enough to be body text on white.
 *
 * Walks lightness down until it clears AA (4.5:1). A loop rather than a formula
 * because the required lightness depends on hue — pure yellow has to go far
 * darker than pure blue to reach the same ratio.
 */
function textToneFor(h: number, s: number): string {
  const white: [number, number, number] = [255, 255, 255];
  for (let l = 50; l >= 12; l -= 2) {
    if (contrast(hslToRgb(h, s, l), white) >= 4.5) return parts(h, s, l);
  }
  return parts(h, s, 12);
}

/**
 * Token overrides for a brand colour, or null when there is no usable one — in
 * which case callers render the product accent and nothing needs to change.
 */
export function brandTheme(hex: string | null | undefined): BrandTheme | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [h, s, l] = rgbToHsl(rgb);

  // A near-white or near-black brand colour cannot carry a UI accent: every
  // label on it fails, and the tinted surfaces vanish into the page. Falling
  // back beats rendering something unreadable.
  if (l >= 96 || l <= 4) return null;

  return {
    '--accent': parts(h, s, l),
    '--accent-fg': foregroundFor(rgb, h, s),
    // The tint behind chips and callouts. Kept very light so it reads as a
    // surface rather than a second fill competing with the accent itself.
    '--accent-soft': parts(h, Math.min(s, 60), 95),
    '--accent-text': textToneFor(h, s),
  };
}

/** Ready to spread into a `style` prop. Empty object when there's no brand colour. */
export function brandStyle(hex: string | null | undefined): Record<string, string> {
  return (brandTheme(hex) as unknown as Record<string, string>) ?? {};
}
