'use client';

import { useEffect, useRef } from 'react';

// Interactive ASCII field: a character wave that brightens and ripples toward the
// cursor, coloured with a horizontal gradient across `colors`. Pure canvas.
export default function AsciiField({
  colors = ['99,102,241', '139,92,246', '217,70,239'], // indigo -> violet -> fuchsia
  baseAlpha = 0.05,
  peakAlpha = 0.6,
}: {
  colors?: string[];
  baseAlpha?: number;
  peakAlpha?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const parent = canvas.parentElement;
    if (!ctx || !parent) return;

    const stops = colors.map((c) => c.split(',').map(Number));
    const chars = ' .:-=+*#%@';
    const cell = 15;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cols = 0, rows = 0, t = 0, raf = 0;
    const mouse = { x: -9999, y: -9999 };

    function rgbAt(fx: number) {
      const seg = fx * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(seg));
      const f = seg - i;
      const a = stops[i], b = stops[i + 1];
      return `${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)}`;
    }

    function resize() {
      const w = parent.clientWidth, h = parent.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${cell}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textBaseline = 'top';
      cols = Math.ceil(w / cell); rows = Math.ceil(h / cell);
    }

    function frame() {
      t += 0.035;
      const w = parent.clientWidth, h = parent.clientHeight;
      ctx.clearRect(0, 0, w, h);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const px = x * cell, py = y * cell;
          const wave = Math.sin(x * 0.26 + y * 0.2 - t) * 0.5 + 0.5;
          const dx = px - mouse.x, dy = py - mouse.y;
          const ripple = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 210);
          const v = Math.min(1, wave * 0.5 + ripple * 0.95);
          const ch = chars[Math.floor(v * (chars.length - 1))];
          if (ch === ' ') continue;
          ctx.fillStyle = `rgba(${rgbAt(x / cols)},${(baseAlpha + v * peakAlpha).toFixed(3)})`;
          ctx.fillText(ch, px, py);
        }
      }
      if (!reduced) raf = requestAnimationFrame(frame);
    }

    const onMove = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; };
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
  }, [colors, baseAlpha, peakAlpha]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
