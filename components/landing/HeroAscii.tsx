'use client';

import { useEffect, useState } from 'react';
import AsciiField from '@/components/landing/AsciiField';

// The hero's ASCII terrain, in ink that suits the theme.
//
// AsciiField takes literal RGB strings, so one palette cannot serve both:
// zinc-700 glyphs that read as texture on the light canvas vanish on the dark
// one. This watches the root's `dark` class (the theme toggle flips it live)
// and hands the field the matching palette. The two arrays are module
// constants because the field restarts its loop when `colors` changes
// identity — a fresh literal per render would restart it on every render.
const LIGHT = ['63,63,70', '82,82,91', '113,113,122'];
const DARK = ['161,161,170', '212,212,216', '113,113,122'];

export default function HeroAscii() {
  // null until the theme is read: drawing a light field first and swapping it
  // a moment later restarted the loop on the same canvas, which came back
  // blank. Nothing draws until the answer is known, and a toggle remounts a
  // fresh canvas (the `key`) rather than re-using the old one.
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setDark(el.classList.contains('dark'));
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  if (dark === null) return null;
  return (
    <AsciiField key={dark ? 'dark' : 'light'} colors={dark ? DARK : LIGHT} baseAlpha={dark ? 0.26 : 0.34} peakAlpha={0.95} edgeBias={0.5} cell={10} />
  );
}
