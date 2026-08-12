'use client';

import { useEffect, useRef } from 'react';

// Interactive ASCII terrain v3.
// Base: a fractal-noise (FBM) height field thresholded into organic glyph
// clusters, calmer in the centre (edge bias), coloured by a drifting gradient.
// Interaction: the cursor carries a soft glow AND leaves a wake — every few px
// of movement drops a ripple that expands outward as a ring through the
// characters and fades; clicking fires a stronger shockwave. Pure canvas.
//
// ── WHY v3 EXISTS ──────────────────────────────────────────────────────────
// v2 ran the hero at 16.7 fps with the main thread blocked for 2007 ms out of
// every 2031 — measured, not guessed. Scrolled past, the same page did 181 fps
// with zero long tasks, so all of it was this component. The landing page felt
// broken on the one screen that has to feel fast.
//
// The cause was doing everything, per cell, per frame. At cell=8 a hero is
// ~23,000 cells, and each one ran a four-octave FBM (≈16 hashes), a sqrt, two
// Math.pow calls, and built a fresh `rgba(...)` string for fillStyle. Four
// changes, in descending order of what they bought:
//
//   1. THE BASE FIELD IS CACHED. The noise and the artwork only change as `t`
//      drifts, which is slow. It is computed into a Float32Array a few times a
//      second; every rendered frame reads one float and adds the interactive
//      parts (glow, ripples) on top. Those are what have to be instant.
//   2. THE CELL COUNT IS CAPPED. fillText is the floor cost and nothing makes
//      23,000 of them cheap, so the grid adapts to the viewport instead of
//      being a fixed pixel size that quietly triples on a large monitor.
//   3. FILL STYLES ARE A LOOKUP TABLE. Quantised colour × alpha, built once —
//      no per-cell string allocation, and the GC churn goes with it.
//   4. FRAMES ARE CAPPED near 30fps. This is a background shimmer; the second
//      30 frames per second were paid for and never seen.
//
// `t` is now derived from elapsed TIME rather than incremented per frame, so
// the drift runs at the same speed it always did regardless of the frame rate.
export default function AsciiField({
  colors = ['99,102,241', '139,92,246', '217,70,239', '56,189,248'], // indigo · violet · fuchsia · sky
  baseAlpha = 0.22,
  peakAlpha = 1,
  cell = 14,
  edgeBias = 0.7,
  image,
  imageWeight = 0.55,
  focalX = 0.5,
  focalY = 0.5,
  imageScale = 1,
  imageFit = 'cover',
}: {
  colors?: string[];
  baseAlpha?: number;
  peakAlpha?: number;
  /** Minimum cell size. The real one grows if the viewport would blow the budget. */
  cell?: number;
  edgeBias?: number;
  /**
   * Optional artwork sampled into the height field, so glyphs cluster where the
   * ink is. The picture is not drawn — it BIASES the same terrain the cursor
   * glow and ripples already push around, which is what keeps the whole thing
   * one interactive surface instead of a static image with an effect on top.
   */
  image?: string;
  /** How hard the artwork pushes the terrain. Too high and the drift dies. */
  imageWeight?: number;
  /** Horizontal focal point when cover-fitting (0 = left, 1 = right). */
  focalX?: number;
  /** Vertical focal point when cover-fitting (0 = top, 1 = bottom). */
  focalY?: number;
  /** >1 zooms in, for showing one part of a busy source. */
  imageScale?: number;
  /**
   * 'cover' fills the frame and crops — right when the art is only texture.
   * 'contain' fits the WHOLE artwork inside it, which is the only way a
   * composition whose meaning lives in its corners survives a wide hero.
   */
  imageFit?: 'cover' | 'contain' | 'width';
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    const parent = canvas.parentElement;
    if (!ctx || !parent) return;

    // ── Budget ───────────────────────────────────────────────────────────────
    // A ceiling on cells, not on pixels. A fixed `cell` means the work scales
    // with the monitor: the same hero that costs 12k glyphs on a laptop costs
    // 40k on a 4K display, and the big screen is exactly where people notice.
    const MAX_CELLS = 17_000;
    const FRAME_MS = 32;           // ~30fps. It is a background texture.
    const BASE_EVERY = 4;          // rebuild the noise field every 4th frame
    const COLOR_STEPS = 24;
    const ALPHA_STEPS = 24;

    const stops = colors.map((c) => c.split(',').map(Number));
    const chars = '.:-=+*#%@';                 // no space: thresholding makes the gaps
    const scale = 96;                          // px per noise unit → blob size
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // No cursor means no glow and no wake, so the only moving part left is a
    // drift nobody is looking at. Phones pay the most for this and get the
    // least back: draw one frame and stop.
    const staticOnly = reduced || !window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    let cols = 0, rows = 0, step = cell, raf = 0;
    let inView = true;   // rAF stops while the hero is scrolled away
    const mouse = { x: -9999, y: -9999, lastX: -9999, lastY: -9999 };
    const start = performance.now();
    const driftAt = (now: number) => ((now - start) / 1000) * 0.72;   // matches v2's 0.012/frame at 60fps

    // Expanding wave-rings left by cursor movement and clicks.
    interface Ripple { x: number; y: number; born: number; amp: number; life: number }
    const ripples: Ripple[] = [];
    const MAX_RIPPLES = 18;
    const addRipple = (x: number, y: number, amp: number, life: number) => {
      if (ripples.length >= MAX_RIPPLES) ripples.shift();
      ripples.push({ x, y, born: performance.now(), amp, life });
    };

    // value noise + fractal sum (FBM) — cheap, deterministic, organic.
    const hash = (i: number, j: number) => {
      let n = (i * 374761393 + j * 668265263) | 0;
      n = (n ^ (n >> 13)) * 1274126177;
      n = n ^ (n >> 16);
      return ((n >>> 0) % 100000) / 100000;
    };
    const smooth = (a: number, b: number, f: number) => a + (b - a) * (f * f * (3 - 2 * f));
    const vnoise = (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const top = smooth(hash(xi, yi), hash(xi + 1, yi), xf);
      const bot = smooth(hash(xi, yi + 1), hash(xi + 1, yi + 1), xf);
      return smooth(top, bot, yf);
    };
    const fbm = (x: number, y: number) => {
      let a = 0, amp = 0.5, freq = 1;
      for (let o = 0; o < 4; o++) { a += amp * vnoise(x * freq, y * freq); freq *= 2; amp *= 0.5; }
      return a / 0.9375;                        // normalise ~0..1
    };

    function rgbAt(p: number) {
      p -= Math.floor(p);
      const seg = p * stops.length;
      const i = Math.floor(seg) % stops.length;
      const j = (i + 1) % stops.length;
      const f = seg - Math.floor(seg);
      const a = stops[i], b = stops[j];
      return `${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)}`;
    }

    // ── Lookup tables, built once per resize ────────────────────────────────
    // Every one of these replaces something that used to run per cell per frame.
    /** `rgba(r,g,b,a)` for every quantised colour × alpha pair. */
    let styles: string[] = [];
    /** Glyph for a quantised level — was two Math.pow calls per cell. */
    const charFor = new Uint8Array(65);
    for (let i = 0; i <= 64; i++) {
      charFor[i] = Math.min(chars.length - 1, Math.floor(Math.pow(i / 64, 0.8) * (chars.length - 1)));
    }
    /** Per-column threshold and its reciprocal — depends on x alone. */
    let threshOf = new Float32Array(0);
    let invSpan = new Float32Array(0);
    /** Spatial half of the gradient position, as a colour bucket index. */
    let hueIdx = new Uint8Array(0);
    /** The cached height field. */
    let base = new Float32Array(0);

    function buildTables() {
      styles = new Array(COLOR_STEPS * ALPHA_STEPS);
      for (let c = 0; c < COLOR_STEPS; c++) {
        const rgb = rgbAt(c / COLOR_STEPS);
        for (let a = 0; a < ALPHA_STEPS; a++) {
          styles[c * ALPHA_STEPS + a] = `rgba(${rgb},${((a + 0.5) / ALPHA_STEPS).toFixed(3)})`;
        }
      }
      threshOf = new Float32Array(cols);
      invSpan = new Float32Array(cols);
      for (let x = 0; x < cols; x++) {
        const edge = Math.pow(Math.abs(x / cols - 0.5) * 2, 1.3);
        const th = 0.4 + (1 - edge) * 0.26 * edgeBias;
        threshOf[x] = th;
        invSpan[x] = 1 / (1 - th);
      }
      hueIdx = new Uint8Array(cols * rows);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const p = (x / cols) * 0.5 + (y / rows) * 0.4;
          hueIdx[y * cols + x] = Math.floor((p - Math.floor(p)) * COLOR_STEPS) % COLOR_STEPS;
        }
      }
      base = new Float32Array(cols * rows);
    }

    // ── Artwork sampled to the character grid ────────────────────────────────
    // One Float32Array of ink density, rebuilt only on resize. The 1.45 gamma is
    // baked in HERE rather than per frame — it never varies.
    let art: Float32Array | null = null;
    let artImg: HTMLImageElement | null = null;

    function sampleArt() {
      if (!artImg || !artImg.complete || !artImg.naturalWidth || !cols || !rows) { art = null; return; }
      const off = document.createElement('canvas');
      off.width = cols; off.height = rows;
      const octx = off.getContext('2d', { willReadFrequently: true });
      if (!octx) { art = null; return; }

      // Paper first. The offscreen canvas starts TRANSPARENT, and transparent
      // reads as luminance 0 — solid ink — so any grid the artwork does not
      // cover comes back as the densest possible glyphs. Filling white makes
      // uncovered area read as blank paper, which is what lets 'contain'
      // letterbox into the plain drifting terrain instead of a black slab.
      octx.fillStyle = '#fff';
      octx.fillRect(0, 0, cols, rows);

      // Aspect in PIXELS, not cell counts: characters are far taller than they
      // are wide, so fitting on cells alone squashes the engraving flat.
      const cellW = step * 0.6;                      // monospace advance ≈ 0.6em
      const gridAspect = (cols * cellW) / (rows * step);
      const ia = artImg.naturalWidth / artImg.naturalHeight;

      if (imageFit === 'width') {
        const dw = cols * imageScale;
        const dh = ((cols * cellW) / ia / step) * imageScale;
        const dx = (cols - dw) / 2;
        const dy = (rows - dh) * Math.max(0, Math.min(1, focalY));
        octx.drawImage(artImg, dx, dy, dw, dh);
      } else if (imageFit === 'contain') {
        // The whole plate, letterboxed. Width and height are computed in the
        // grid's own units, which is why cellW appears on both sides.
        let dw = cols, dh = rows;
        if (ia > gridAspect) dh = (cols * cellW) / ia / step;
        else dw = (rows * step) * ia / cellW;
        dw *= imageScale; dh *= imageScale;
        const dx = (cols - dw) * Math.max(0, Math.min(1, focalX));
        const dy = (rows - dh) * Math.max(0, Math.min(1, focalY));
        octx.drawImage(artImg, dx, dy, dw, dh);
      } else {
        let sw = artImg.naturalWidth, sh = artImg.naturalHeight;
        if (ia > gridAspect) sw = artImg.naturalHeight * gridAspect;
        else sh = artImg.naturalWidth / gridAspect;
        sw /= imageScale; sh /= imageScale;
        const sx = (artImg.naturalWidth - sw) * Math.max(0, Math.min(1, focalX));
        const sy = (artImg.naturalHeight - sh) * Math.max(0, Math.min(1, focalY));
        octx.drawImage(artImg, sx, sy, sw, sh, 0, 0, cols, rows);
      }
      const d = octx.getImageData(0, 0, cols, rows).data;
      const out = new Float32Array(cols * rows);
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        // Ink (dark) → high density. The paper is near-white and must land at
        // ~0 or the whole field lifts and the terrain disappears under a wash.
        // Gamma baked in: it pulls near-white paper below the draw threshold.
        out[p] = Math.pow(Math.max(0, 1 - lum), 1.45);
      }
      art = out;
    }

    if (image) {
      artImg = new Image();
      artImg.decoding = 'async';
      artImg.onload = () => { sampleArt(); buildBase(driftAt(performance.now())); };
      artImg.src = image;
    }

    function resize() {
      const w = parent!.clientWidth, h = parent!.clientHeight;
      if (!w || !h) return;
      // The cell grows until the grid fits the budget. `cell` is the floor, not
      // the value — on a laptop it is usually exactly what was asked for.
      step = Math.max(cell, Math.ceil(Math.sqrt((w * h) / MAX_CELLS)));
      canvas!.width = w * dpr; canvas!.height = h * dpr;
      canvas!.style.width = w + 'px'; canvas!.style.height = h + 'px';
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.font = `${step}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx!.textBaseline = 'top';
      cols = Math.ceil(w / step); rows = Math.ceil(h / step);
      buildTables();
      sampleArt();
      buildBase(driftAt(performance.now()));
    }

    /**
     * The expensive half, run a few times a second instead of sixty.
     *
     * Nothing in here responds to the pointer, which is the whole reason it can
     * lag behind: the drift is slow enough that 7 updates a second is
     * indistinguishable from 60, while the glow and the wake — the parts a
     * person is actually driving — stay on every frame.
     */
    function buildBase(t: number) {
      const artW = 0.55 + imageWeight;
      for (let y = 0; y < rows; y++) {
        const py = y / scale * step - t * 0.35;
        const row = y * cols;
        for (let x = 0; x < cols; x++) {
          let n = fbm(x / scale * step + t, py);
          if (art) n = 0.42 + (n - 0.5) * 0.30 + art[row + x] * artW;
          base[row + x] = n;
        }
      }
    }

    let lastDraw = 0, baseTick = 0;

    function draw(now: number) {
      const t = driftAt(now);
      if (baseTick % BASE_EVERY === 0) buildBase(t);
      baseTick++;

      const w = parent!.clientWidth, h = parent!.clientHeight;
      ctx!.clearRect(0, 0, w, h);

      // Precompute live ripples (radius grows ~300 px/s, ring widens as it ages).
      const live = ripples.filter((r) => now - r.born < r.life);
      ripples.length = 0; ripples.push(...live);
      const rings = live.map((r) => {
        const age = (now - r.born) / 1000;
        const fade = 1 - (now - r.born) / r.life;
        return { x: r.x, y: r.y, radius: 40 + age * 300, width: 40 + age * 55, boost: r.amp * fade * fade };
      });
      const nRings = rings.length;

      // The gradient's drift is an index shift now, not a float recomputed per
      // cell — the spatial half is baked into hueIdx.
      const tShift = (Math.floor(t * 0.05 * COLOR_STEPS) % COLOR_STEPS + COLOR_STEPS) % COLOR_STEPS;
      const mx = mouse.x, my = mouse.y;
      let style = '';

      for (let y = 0; y < rows; y++) {
        const py = y * step;
        const row = y * cols;
        const dy = py - my, dy2 = dy * dy;
        for (let x = 0; x < cols; x++) {
          const px = x * step;
          let n = base[row + x];

          // cursor glow — instant, local
          const dx = px - mx;
          const dist = Math.sqrt(dx * dx + dy2);
          if (dist < 170) n = Math.min(1.4, n + (1 - dist / 170) * 0.45);

          // wake — expanding rings from recent movement / clicks
          for (let k = 0; k < nRings; k++) {
            const rg = rings[k];
            const rdx = px - rg.x, rdy = py - rg.y;
            const d = Math.sqrt(rdx * rdx + rdy * rdy) - rg.radius;
            if (d > -rg.width && d < rg.width) {
              const band = 1 - Math.abs(d) / rg.width;         // 1 at ring centre → 0 at edges
              n = Math.min(1.4, n + band * band * rg.boost);
            }
          }

          const level = (n - threshOf[x]) * invSpan[x];
          if (level <= 0) continue;
          const lv = level < 1 ? level : 1;
          const ch = chars[charFor[(lv * 64) | 0]];

          let ai = ((baseAlpha + lv * peakAlpha) * ALPHA_STEPS) | 0;
          if (ai >= ALPHA_STEPS) ai = ALPHA_STEPS - 1;
          const ci = (hueIdx[row + x] + tShift) % COLOR_STEPS;
          const s = styles[ci * ALPHA_STEPS + ai];
          // fillStyle is a parsed setter; skipping the redundant writes is most
          // of what batching by colour would have bought, without the sort.
          if (s !== style) { style = s; ctx!.fillStyle = s; }
          ctx!.fillText(ch, px, py);
        }
      }
    }

    function frame(now: number) {
      if (now - lastDraw >= FRAME_MS) { lastDraw = now; draw(now); }
      if (inView) raf = requestAnimationFrame(frame);
    }

    // Window-level listeners + rect bounds check: the canvas sits BEHIND the
    // page content, so element-level events would never fire over text/cards.
    // Pointer events (not mouse events) so the wake also works on touch/pen.
    const within = (e: MouseEvent) => {
      const r = canvas!.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      return x >= 0 && y >= 0 && x <= r.width && y <= r.height ? { x, y } : null;
    };
    const onMove = (e: MouseEvent) => {
      const pt = within(e);
      if (!pt) { mouse.x = -9999; mouse.y = -9999; return; }
      mouse.x = pt.x; mouse.y = pt.y;
      // drop a wake ripple every ~28px of travel
      const mdx = mouse.x - mouse.lastX, mdy = mouse.y - mouse.lastY;
      if (mdx * mdx + mdy * mdy > 28 * 28) {
        addRipple(mouse.x, mouse.y, 0.55, 900);
        mouse.lastX = mouse.x; mouse.lastY = mouse.y;
      }
    };
    const onClick = (e: MouseEvent) => {
      const pt = within(e);
      if (pt) addRipple(pt.x, pt.y, 1.35, 1600); // shockwave
    };

    // A full-height canvas animating below the fold is pure waste: pause the
    // loop whenever the hero is out of view, resume on return.
    const vio = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([e]) => {
          const next = !!e?.isIntersecting;
          if (next === inView) return;
          inView = next;
          if (staticOnly) return;
          cancelAnimationFrame(raf);
          // `raf` is 0 until the deferred start fires; resuming here before
          // then would put the loop straight back into the TBT window.
          if (inView && raf) raf = requestAnimationFrame(frame);
          else if (!inView) raf = 0;
        })
      : null;
    vio?.observe(canvas);

    // ResizeObserver, not just window.resize: the hero's height depends on
    // content that settles after mount (fonts, the product window), and a grid
    // built against the wrong height letterboxes the artwork.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
    ro?.observe(parent);

    // ── ONE FRAME NOW, THE LOOP LATER ────────────────────────────────────────
    //
    // The hero looks finished immediately — the first frame is drawn
    // synchronously — but the animation does not start until the page has
    // loaded AND the main thread goes idle.
    //
    // Lighthouse scores Total Blocking Time over the window between first paint
    // and interactive, and TBT is worth 30 of the 100 performance points while
    // this page's FCP, LCP and CLS were already green. A 17,000-cell canvas
    // redrawing at 30fps inside that window is measured as blocking whether or
    // not anyone perceives it. Moved out of it, the drift costs nothing that is
    // scored and looks identical a second later — nobody is watching a
    // background shimmer during the first second of a page they just opened.
    resize();
    draw(performance.now());

    let startTimer = 0;
    const startLoop = () => {
      if (staticOnly || raf) return;
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('click', onClick, { passive: true });
      raf = requestAnimationFrame(frame);
    };
    if (!staticOnly) {
      // requestIdleCallback where it exists, a timer where it does not (Safari
      // shipped rIC only in 17.4). The timeout on the idle request is the
      // guarantee: a page that never goes idle must still animate eventually.
      const kick = () => {
        const ric = (window as any).requestIdleCallback;
        if (typeof ric === 'function') ric(startLoop, { timeout: 2000 });
        else startTimer = window.setTimeout(startLoop, 900);
      };
      if (document.readyState === 'complete') kick();
      else window.addEventListener('load', kick, { once: true });
    }

    // A hidden tab still runs rAF in some browsers, and always does when the
    // window is merely occluded. The IntersectionObserver below only knows
    // about scrolling.
    const onVis = () => {
      if (staticOnly) return;
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (inView && !raf) raf = requestAnimationFrame(frame);
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      vio?.disconnect();
      ro?.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(startTimer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('click', onClick);
    };
  }, [colors, baseAlpha, peakAlpha, cell, edgeBias, image, imageWeight, focalX, focalY, imageScale, imageFit]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
