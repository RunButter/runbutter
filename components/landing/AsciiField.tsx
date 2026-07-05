'use client';

import { useEffect, useRef } from 'react';

// Interactive ASCII terrain v2.
// Base: a fractal-noise (FBM) height field thresholded into organic glyph
// clusters, calmer in the centre (edge bias), coloured by a drifting gradient.
// Interaction: the cursor carries a soft glow AND leaves a wake — every few px
// of movement drops a ripple that expands outward as a ring through the
// characters and fades; clicking fires a stronger shockwave. Pure canvas.
export default function AsciiField({
  colors = ['99,102,241', '139,92,246', '217,70,239', '56,189,248'], // indigo · violet · fuchsia · sky
  baseAlpha = 0.22,
  peakAlpha = 1,
  cell = 14,
  edgeBias = 0.7,
  text,
}: {
  colors?: string[];
  baseAlpha?: number;
  peakAlpha?: number;
  cell?: number;
  edgeBias?: number;
  text?: string;   // when set, dense glyphs form this word over a faint field
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const parent = canvas.parentElement;
    if (!ctx || !parent) return;

    const stops = colors.map((c) => c.split(',').map(Number));
    const chars = '.:-=+*#%@';                 // no space: thresholding makes the gaps
    const scale = 96;                          // px per noise unit → blob size
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cols = 0, rows = 0, t = 0, raf = 0;
    let mask: Uint8ClampedArray | null = null, maskW = 0, maskH = 0;   // optional text mask
    const mouse = { x: -9999, y: -9999, lastX: -9999, lastY: -9999 };

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

    function resize() {
      const w = parent!.clientWidth, h = parent!.clientHeight;
      canvas!.width = w * dpr; canvas!.height = h * dpr;
      canvas!.style.width = w + 'px'; canvas!.style.height = h + 'px';
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.font = `${cell}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx!.textBaseline = 'top';
      cols = Math.ceil(w / cell); rows = Math.ceil(h / cell);

      // Build a text mask (once per resize): render the word big + bold to an
      // offscreen canvas and sample its alpha per cell in frame() so the ASCII
      // glyphs cluster into the word, with a faint field around it.
      if (text && w > 0 && h > 0) {
        const mc = document.createElement('canvas');
        mc.width = w; mc.height = h;
        const mx = mc.getContext('2d');
        if (mx) {
          mx.textAlign = 'center'; mx.textBaseline = 'middle';
          mx.font = '900 100px ui-monospace, SFMono-Regular, Menlo, monospace';
          const base = mx.measureText(text).width || 1;
          const fs = Math.min((w * 0.84) / base * 100, h * 0.66);
          mx.font = `900 ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          mx.fillStyle = '#fff';
          mx.fillText(text, w / 2, h / 2 + fs * 0.02);
          mask = mx.getImageData(0, 0, w, h).data;
          maskW = w; maskH = h;
        }
      } else {
        mask = null;
      }
    }

    function frame() {
      t += 0.012;
      const now = performance.now();
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

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const px = x * cell, py = y * cell;
          // organic height field, slowly drifting
          let n = fbm(px / scale + t, py / scale - t * 0.35);
          // cursor glow — instant, local
          const dx = px - mouse.x, dy = py - mouse.y;
          n = Math.min(1.4, n + Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 170) * 0.45);
          // wake — expanding rings from recent movement / clicks
          for (let k = 0; k < rings.length; k++) {
            const rg = rings[k];
            const rdx = px - rg.x, rdy = py - rg.y;
            const d = Math.sqrt(rdx * rdx + rdy * rdy) - rg.radius;
            if (d > -rg.width && d < rg.width) {
              const band = 1 - Math.abs(d) / rg.width;         // 1 at ring centre → 0 at edges
              n = Math.min(1.4, n + band * band * rg.boost);
            }
          }
          // text mask: boost density inside the word, fade the field outside
          if (mask) {
            const sx = Math.min(maskW - 1, (px + cell / 2) | 0);
            const sy = Math.min(maskH - 1, (py + cell / 2) | 0);
            const a = mask[((sy * maskW + sx) << 2) + 3] / 255;
            n = a > 0.35 ? Math.min(1.4, n * 0.5 + 0.9) : n * 0.5;
          }
          // calmer centre, denser edges via a position-dependent contour line
          const edge = Math.pow(Math.abs(x / cols - 0.5) * 2, 1.3);
          const thresh = mask ? 0.46 : 0.4 + (1 - edge) * 0.26 * edgeBias;
          const level = (n - thresh) / (1 - thresh);
          if (level <= 0) continue;
          const ch = chars[Math.min(chars.length - 1, Math.floor(Math.pow(Math.min(1, level), 0.8) * (chars.length - 1)))];
          const p = (x / cols) * 0.5 + (y / rows) * 0.4 + t * 0.05;
          const alpha = Math.min(1, baseAlpha + level * peakAlpha);
          ctx!.fillStyle = `rgba(${rgbAt(p)},${alpha.toFixed(3)})`;
          ctx!.fillText(ch, px, py);
        }
      }
      if (!reduced) raf = requestAnimationFrame(frame);
    }

    // Window-level listeners + rect bounds check: the canvas sits BEHIND the
    // page content, so element-level events would never fire over text/cards.
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

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('click', onClick, { passive: true });
    if (reduced) frame(); else raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('click', onClick);
    };
  }, [colors, baseAlpha, peakAlpha, cell, edgeBias, text]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
