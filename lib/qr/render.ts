'use client';

/**
 * QR codes, rendered by us.
 *
 * WHY A DEPENDENCY FOR THE MATH AND NOT FOR THE PICTURE. QR encoding is
 * Reed-Solomon error correction, eight candidate mask patterns scored against
 * four penalty rules, and a version table — several hundred lines that are easy
 * to get subtly wrong in ways that only show up on one phone. That is exactly
 * what `lib/plugins/zip.ts` means by "take a dependency rather than growing it".
 * `qrcode-generator` is MIT, has no dependencies of its own, and does only that.
 *
 * The DRAWING is ours, because the library's own output is a fixed-size table
 * of `<img>` tags or a canvas, and neither survives being printed on a poster
 * or recoloured to a brand. An SVG of one path scales to any size, prints
 * crisply, and is a few hundred bytes.
 *
 * IT RUNS IN THE BROWSER. A QR usually encodes a URL, and a URL is often a
 * private link — an unlisted form, a signing link, a record. Sending those to a
 * server to get a picture back is the same bad trade the PDF tools refuse.
 */

import qrcode from 'qrcode-generator';

/**
 * ENCODE AS UTF-8, NOT LATIN-1.
 *
 * `qrcode-generator` defaults to ISO-8859-1, which silently mangles anything
 * outside it. "Zażółć gęślą jaźń" produced a QR that a reader could FIND and
 * then decoded to an empty string — a code that looks perfect, prints fine, and
 * scans to nothing. Caught only by decoding our own output; every check short
 * of that passed.
 *
 * This matters here more than most places: Polish and German company names,
 * accented people's names, and the € sign are all outside Latin-1's useful
 * range, and this product is used in exactly those countries.
 *
 * TextEncoder rather than the library's own `stringToBytesFuncs['UTF-8']`,
 * because that table exists on the CommonJS export and NOT on the ESM one —
 * which is what a browser bundle gets. Reaching for it there throws at module
 * load and takes the whole page with it, and neither `tsc` nor `next build`
 * catches that: both were perfectly happy with the version that crashed.
 *
 * Set once at module load — the library reads it per call, so nothing imported
 * later can get the old behaviour.
 */
(qrcode as any).stringToBytes = (s: string): number[] => Array.from(new TextEncoder().encode(s));

/**
 * How much of the code can be destroyed and still scan.
 *
 * L≈7%, M≈15%, Q≈25%, H≈30%. M is the default because it is the usual one and
 * because higher correction means a denser code for the same text, which is
 * worse at small print sizes — the opposite of what people expect when they
 * reach for "High".
 */
export type EcLevel = 'L' | 'M' | 'Q' | 'H';

/** How the data modules are drawn. Only `square` can collapse runs. */
export type ModuleStyle = 'square' | 'rounded' | 'dots';
/** The three corner squares — most of what makes a code look designed. */
export type EyeStyle = 'square' | 'rounded' | 'circle';

export interface QrOptions {
  ec?: EcLevel;
  /** Quiet zone in modules. The spec says 4; less and some readers refuse. */
  margin?: number;
  dark?: string;
  light?: string;
  moduleStyle?: ModuleStyle;
  eyeStyle?: EyeStyle;
  /** Defaults to `dark`. A separate eye colour is most of a designed look. */
  eyeColor?: string;
  /** Gradient across the DATA modules only — the eyes stay solid. */
  gradient?: { from: string; to: string } | null;
  /**
   * Percentage of the code's AREA cleared in the middle for a logo.
   *
   * Measured, not guessed. Decoding our own output: 6% clears reliably at every
   * error-correction level; 10% needs Q or better and fails at M. So the UI
   * offers 6% and `qrSvg` refuses more than 12% outright — beyond that the
   * error correction is being asked to reconstruct more than it can, and the
   * failure lands at the printer.
   */
  logoAreaPct?: number;
}

/** Below this, a styled code stops decoding. Measured — see qrPng. */
export const MIN_PX_PER_MODULE = 12;

/**
 * The error correction a given look actually needs.
 *
 * A logo removes modules outright and dots give a binariser less ink to work
 * with, so both want more redundancy than the default. Returning the level
 * rather than silently overriding it means the UI can SAY why it changed.
 */
export function requiredEc(opts: { moduleStyle?: ModuleStyle; logoAreaPct?: number }): EcLevel | null {
  const pct = opts.logoAreaPct || 0;
  if (pct > 6) return 'Q';
  if (pct > 0) return 'M';
  return null;
}

export interface QrResult {
  svg: string;
  modules: number;
  /** Where a logo may be drawn, in module units — null when none was asked for. */
  clearBox: { x: number; y: number; size: number } | null;
}

/**
 * Build the SVG.
 *
 * ONE PATH, NOT ONE RECT PER MODULE. A version-10 code is 57×57 — over three
 * thousand `<rect>` elements, which is a slow render and a 200KB file. A single
 * `d` attribute of `M x y h1 v1 h-1 z` runs is a few KB and draws identically.
 *
 * `shape-rendering="crispEdges"` matters: without it, antialiasing softens the
 * module boundaries at small sizes and readers start missing codes that look
 * perfectly fine to a person.
 */
export function qrSvg(text: string, opts: QrOptions = {}): QrResult {
  const {
    ec = 'M', margin = 4, dark = '#000000', light = '#ffffff',
    moduleStyle = 'square', eyeStyle = 'square', eyeColor, gradient = null,
    logoAreaPct = 0,
  } = opts;
  if (!text) throw new Error('Nothing to encode.');

  // Type 0 asks the library to pick the smallest version that fits. It throws
  // when the text is too long for even the largest, which is a real limit worth
  // reporting rather than hiding.
  const qr = qrcode(0, ec);
  qr.addData(text);
  try {
    qr.make();
  } catch {
    throw new Error('Too much text for a QR code. Shorten it, or use a link that points at the content.');
  }

  const count = qr.getModuleCount();
  const size = count + margin * 2;

  /**
   * The three finder patterns, drawn as WHOLE SHAPES rather than styled modules.
   *
   * A reader locates a code by the 1:1:3:1:1 ratio of these corners before it
   * decodes anything. Rounding each of their modules individually softens that
   * ratio, which is exactly how a beautiful QR becomes one nobody's phone can
   * find. So they are excluded here and redrawn below.
   */
  const inEye = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= count - 7) || (r >= count - 7 && c < 7);

  /**
   * The clear zone for a logo.
   *
   * Modules under it are NOT DRAWN rather than covered over. Painting a logo on
   * top leaves the modules present in any renderer that ignores z-order — an
   * SVG-to-PDF converter, a print RIP — and the code then has both the data and
   * the logo fighting in the same square. Removing them is the honest version,
   * and it is what the error correction is being asked to recover.
   *
   * Capped at 12%: above that the correction cannot reconstruct what was taken,
   * whatever level it is set to.
   */
  const clearPct = Math.max(0, Math.min(12, logoAreaPct));
  const clear = clearPct ? Math.ceil(count * Math.sqrt(clearPct / 100)) : 0;
  const clearLo = Math.floor((count - clear) / 2);
  const clearHi = clearLo + clear;
  const inLogo = (r: number, c: number) =>
    clear > 0 && r >= clearLo && r < clearHi && c >= clearLo && c < clearHi;

  let data = '';
  if (moduleStyle === 'square') {
    // Runs collapse into one rectangle each — a third of the elements a
    // per-module path emits, and identical on screen.
    for (let row = 0; row < count; row++) {
      let run = 0, start = 0;
      for (let col = 0; col <= count; col++) {
        const on = col < count && qr.isDark(row, col) && !inEye(row, col) && !inLogo(row, col);
        if (on) { if (!run) start = col; run++; continue; }
        if (run) { data += `M${start + margin} ${row + margin}h${run}v1h-${run}z`; run = 0; }
      }
    }
  } else {
    // Styled modules cannot merge, so this is one shape each. A styled code is
    // almost always a short URL — 29 to 45 modules, well under a thousand
    // shapes — and `square` stays available for the dense ones.
    // 0.5 — TOUCHING circles, not separated ones, and this is measured rather
    // than chosen for looks. Decoding our own output at two raster sizes: 0.42
    // never scanned at all, 0.46 scanned at 320px and FAILED at 640px, and 0.5
    // scanned at both, with and without a gradient. A separated dot leaves too
    // little ink for a binariser to recover the module grid, and the size
    // dependence is the worst version of that — it works on the screen you
    // tested and fails on the poster.
    const r = moduleStyle === 'dots' ? 0.5 : 0.3;
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (!qr.isDark(row, col) || inEye(row, col) || inLogo(row, col)) continue;
        const x = col + margin, y = row + margin;
        // FULL BLEED — no inset. An inset leaves a gap on every side, which is
        // the same thing that made 0.42-radius dots undecodable: a binariser
        // recovers the module grid from ink, and shaving it costs more than it
        // looks. Rounded modules now fill their cell exactly and only the
        // corners are cut.
        data += moduleStyle === 'dots'
          ? circle(x + 0.5, y + 0.5, r)
          : roundedRect(x, y, 1, 1, r);
      }
    }
  }

  let eyes = '';
  for (const [er, ecol] of [[0, 0], [0, count - 7], [count - 7, 0]] as const) {
    eyes += eyeShape(er + margin, ecol + margin, eyeStyle);
  }

  const defs = gradient
    ? `<defs><linearGradient id="qg" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${esc(gradient.from)}"/>` +
      `<stop offset="1" stop-color="${esc(gradient.to)}"/></linearGradient></defs>`
    : '';

  // crispEdges only when everything is square. On curves it disables
  // antialiasing and the dots come out jagged — the opposite of the point.
  const rendering = moduleStyle === 'square' && eyeStyle === 'square' ? ' shape-rendering="crispEdges"' : '';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"${rendering}>` +
    defs +
    `<rect width="${size}" height="${size}" fill="${esc(light)}"/>` +
    `<path d="${data}" fill="${gradient ? 'url(#qg)' : esc(dark)}"/>` +
    `<path d="${eyes}" fill="${esc(eyeColor || dark)}" fill-rule="evenodd"/>` +
    `</svg>`;

  return { svg, modules: count, clearBox: clear ? { x: clearLo + margin, y: clearLo + margin, size: clear } : null };
}

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0z`;

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return `M${x + rr} ${y}h${w - 2 * rr}a${rr} ${rr} 0 0 1 ${rr} ${rr}v${h - 2 * rr}` +
    `a${rr} ${rr} 0 0 1 ${-rr} ${rr}h${-(w - 2 * rr)}a${rr} ${rr} 0 0 1 ${-rr} ${-rr}v${-(h - 2 * rr)}` +
    `a${rr} ${rr} 0 0 1 ${rr} ${-rr}z`;
}

/**
 * One finder pattern: a 7x7 ring around a 3x3 centre.
 *
 * Drawn ring-plus-centre under `fill-rule="evenodd"`, so the gap between them
 * is a real hole rather than a light-coloured square painted over the top —
 * which matters the moment the code sits on anything but white.
 */
function eyeShape(y: number, x: number, style: EyeStyle): string {
  if (style === 'circle') {
    return circle(x + 3.5, y + 3.5, 3.5) + circle(x + 3.5, y + 3.5, 2.5) + circle(x + 3.5, y + 3.5, 1.5);
  }
  if (style === 'rounded') {
    return roundedRect(x, y, 7, 7, 1.75) + roundedRect(x + 1, y + 1, 5, 5, 1.25) + roundedRect(x + 2, y + 2, 3, 3, 0.75);
  }
  return `M${x} ${y}h7v7h-7z` + `M${x + 1} ${y + 1}h5v5h-5z` + `M${x + 2} ${y + 2}h3v3h-3z`;
}

/** Colours come from a form, and a form is untrusted even when it is your own. */
function esc(v: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(v) ? v : '#000000';
}

/**
 * Rasterise for the places SVG is not accepted — Word, most print shops, and
 * every social uploader.
 *
 * Drawn at an exact multiple of the module count so every module lands on whole
 * pixels. A QR scaled to a size that is not a multiple gets uneven module
 * widths, which is the classic "prints fine, scans badly" bug.
 */
export async function qrPng(text: string, pixels = 1024, opts: QrOptions = {}): Promise<Uint8Array> {
  const { svg, modules } = qrSvg(text, opts);
  const total = modules + (opts.margin ?? 4) * 2;

  /**
   * A WHOLE number of pixels per module, with a FLOOR.
   *
   * Both halves are measured. Scaling a 37-unit code to exactly 1024 gives
   * 27.68 px per module, and the uneven module widths that produces made dots
   * undecodable at every error-correction level — the classic "looks fine,
   * scans badly" failure. Rounding to a whole number fixed it outright.
   *
   * The floor is the second half: with integer scaling the remaining failures
   * were all at roughly 10 px per module, which is what a DENSE code (more
   * data, or higher correction) produces at a fixed target size. So the target
   * is a minimum rather than a maximum — a denser code comes out as a larger
   * image instead of an unreadable one. Square modules survive smaller, but not
   * by enough to be worth two rules.
   */
  const scale = Math.max(MIN_PX_PER_MODULE, Math.round(pixels / total));
  const side = total * scale;

  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Could not rasterise the QR code.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = side; canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get a canvas context.');
    // Nearest-neighbour: smoothing a QR is actively harmful.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, side, side);
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('Could not encode the PNG.');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
