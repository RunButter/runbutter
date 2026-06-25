'use client';

import { useEffect, useRef } from 'react';

// Interactive ASCII terrain. Character density is driven by a fractal-noise
// height field (FBM) and thresholded, so glyphs CLUSTER into organic shapes with
// empty negative space between them — like a contoured landscape — instead of
// regular wave lines. An edge bias pushes the "mountains" toward the left/right
// so the centre stays calm behind the content. Colour flows through a drifting
// gradient; the cursor raises the terrain so shapes bloom toward it. Pure canvas.
export default function AsciiField({
  colors = ['99,102,241', '139,92,246', '217,70,239', '56,189,248'], // indigo · violet · fuchsia · sky
  baseAlpha = 0.22,
  peakAlpha = 1,
  cell = 14,
  edgeBias = 0.7,
}: {
  colors?: string[];
  baseAlpha?: number;
  peakAlpha?: number;
  cell?: number;
  edgeBias?: number;
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
    const mouse = { x: -9999, y: -9999 };

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
    }

    function frame() {
      t += 0.012;
      const w = parent!.clientWidth, h = parent!.clientHeight;
      ctx!.clearRect(0, 0, w, h);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const px = x * cell, py = y * cell;
          // organic height field, slowly drifting
          let n = fbm(px / scale + t, py / scale - t * 0.35);
          // cursor raises the terrain nearby so shapes bloom toward it
          const dx = px - mouse.x, dy = py - mouse.y;
          const ripple = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 190);
          n = Math.min(1, n + ripple * 0.5);
          // calmer centre, denser edges via a position-dependent contour line
          // (vary the threshold, not the amplitude, so shapes stay solid)
          const edge = Math.pow(Math.abs(x / cols - 0.5) * 2, 1.3);
          const thresh = 0.4 + (1 - edge) * 0.26 * edgeBias;
          const level = (n - thresh) / (1 - thresh);
          if (level <= 0) continue;
          const ch = chars[Math.min(chars.length - 1, Math.floor(Math.pow(level, 0.8) * (chars.length - 1)))];
          const p = (x / cols) * 0.5 + (y / rows) * 0.4 + t * 0.05;
          const alpha = Math.min(1, baseAlpha + level * peakAlpha);
          ctx!.fillStyle = `rgba(${rgbAt(p)},${alpha.toFixed(3)})`;
          ctx!.fillText(ch, px, py);
        }
      }
      if (!reduced) raf = requestAnimationFrame(frame);
    }

    const onMove = (e: MouseEvent) => { const r = canvas!.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; };
    const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };

    resize();
    window.addEventListener('resize', resize);
    parent.addEventListener('mousemove', onMove);
    parent.addEventListener('mouseleave', onLeave);
    if (reduced) frame(); else raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      parent.removeEventListener('mousemove', onMove);
      parent.removeEventListener('mouseleave', onLeave);
    };
  }, [colors, baseAlpha, peakAlpha, cell, edgeBias]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
