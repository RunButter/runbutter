'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

// Light/dark switch. The no-flash script in layout.tsx sets the initial class
// from localStorage or the OS preference; this just reflects and flips it.
export default function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => { setDark(document.documentElement.classList.contains('dark')); }, []);

  const toggle = () => {
    const root = document.documentElement;
    const next = !root.classList.contains('dark');

    // Swap themes with transitions off for one frame. Our colors resolve from
    // CSS vars, and an in-flight color transition against a var change leaves
    // elements pinned to their old value (cards stayed white in dark mode).
    root.classList.add('theme-switching');
    root.classList.toggle('dark', next);
    void root.offsetHeight; // force the style recalc while transitions are off
    requestAnimationFrame(() => root.classList.remove('theme-switching'));

    try { localStorage.setItem('hb-theme', next ? 'dark' : 'light'); } catch {}
    setDark(next);
  };

  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-secondary border border-subtle hover:text-primary hover:bg-surface-sunken transition"
    >
      {/* Render nothing until mounted so SSR markup matches either theme. */}
      {dark === null ? null : dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
