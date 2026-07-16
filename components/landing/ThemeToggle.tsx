'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

// Light/dark switch. The no-flash script in layout.tsx sets the initial class
// from localStorage or the OS preference; this just reflects and flips it.
export default function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => { setDark(document.documentElement.classList.contains('dark')); }, []);

  const toggle = () => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('hb-theme', next ? 'dark' : 'light'); } catch {}
    setDark(next);
  };

  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 ring-1 ring-slate-200 hover:text-slate-900 hover:bg-slate-50 transition dark:text-slate-400 dark:ring-slate-700 dark:hover:text-white dark:hover:bg-slate-800"
    >
      {/* Render nothing until mounted so SSR markup matches either theme. */}
      {dark === null ? null : dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
