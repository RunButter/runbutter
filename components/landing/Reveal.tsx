'use client';

import { useEffect, useRef } from 'react';

// Fade-and-rise a block into view the first time it scrolls on screen.
// Server children pass straight through; styles live in globals.css (.reveal).
export default function Reveal({ children, delay = 0, className = '', variant = 'up' }: {
  children: React.ReactNode; delay?: number; className?: string;
  /** Direction the block arrives from. 'up' is the previous behaviour. */
  variant?: 'up' | 'left' | 'right' | 'zoom' | 'fade';
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { el.classList.add('reveal-in'); return; }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { el.classList.add('reveal-in'); io.disconnect(); } }),
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`reveal reveal-${variant} ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}
