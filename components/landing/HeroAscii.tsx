'use client';

import { useEffect, useState } from 'react';
import GlyphField from '@/components/landing/GlyphField';

// The hero's living map, in ink that suits the theme.
//
// GlyphField takes a literal RGB string, so one ink cannot serve both: zinc-700
// glyphs that read as texture on the light canvas vanish on the dark one. This
// watches the root's `dark` class (the theme toggle flips it live) and hands
// the field the matching ink.
export default function HeroAscii() {
  // null until the theme is read: drawing a light field first and swapping it
  // a moment later would flash. Nothing draws until the answer is known, and a
  // toggle remounts a fresh canvas (the `key`) rather than re-using the old one.
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
    <GlyphField key={dark ? 'dark' : 'light'} ink={dark ? '161,161,170' : '63,63,70'} base={dark ? 0.42 : 0.34} sea={0.04} cell={12} />
  );
}
