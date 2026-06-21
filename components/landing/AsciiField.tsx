'use client';

import { useEffect, useRef } from 'react';

// Interactive ASCII field: a subtle character wave that brightens and ripples
// toward the cursor. Pure canvas, ~no DOM cost. Respects reduced-motion.
export default function AsciiField({ color = '79,70,229' }: { color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const parent = canvas.parentElement;
    if (!ctx || !parent) return;

    const chars = ' .:-=+*#%@';
    const cell = 16;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cols = 0, rows = 0, t = 0, raf = 0;
    const mouse = { x: -9999, y: -9999 };

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
          const wave = Math.sin(x * 0.28 + y * 0.22 - t) * 0.5 + 0.5;
          const dx = px - mouse.x, dy = py - mouse.y;
          const ripple = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 200);
          let v = Math.min(1, wave * 0.5 + ripple * 0.9);
          const ch = chars[Math.floor(v * (chars.length - 1))];
          if (ch === ' ') continue;
          ctx.fillStyle = `rgba(${color},${(0.05 + v * 0.45).toFixed(3)})`;
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
  }, [color]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
