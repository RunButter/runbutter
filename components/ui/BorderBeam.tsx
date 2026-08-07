'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { BorderBeam as Beam, type BorderBeamProps } from 'border-beam';

/**
 * `border-beam` (MIT, Jakub Antalik), wrapped for one reason.
 *
 * THE PACKAGE'S `theme` PROP DEFAULTS TO 'dark', AND ITS 'auto' READS
 * `prefers-color-scheme`. Ours does not work that way: the toggle writes
 * `hb-theme` to localStorage and puts a `.dark` class on <html>, precisely so a
 * visitor can override their OS. Passing 'auto' would therefore light the beam
 * for the wrong background every time someone on a dark laptop chooses light
 * mode — a bug that only shows up for people who touched the toggle, which is
 * the bug you never catch by looking at your own screen.
 *
 * So the theme is resolved from the class the rest of the app already uses, and
 * re-resolved when it changes. A MutationObserver rather than a state
 * subscription because the class is set by an inline script before React boots
 * (the no-flash snippet in layout.tsx), so there is no provider to read at
 * first paint.
 *
 * Everything else is the package's own API — size, colorVariant, strength,
 * duration, brightness. This adds no styling of its own.
 */

export default function BorderBeam({
  children,
  ...props
}: Omit<BorderBeamProps, 'children' | 'theme'> & { children: ReactNode }) {
  // Start 'light': it matches the server render, so the first paint agrees with
  // the markup and there is no hydration mismatch. The observer corrects it
  // immediately if the page is actually dark.
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const read = () => setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    read();
    setMounted(true);
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  // ── Why the beam only appears after mount ────────────────────────────────
  // The package injects a <style> block declaring @property custom properties
  // whose NAMES carry a useId suffix, and its text content differs between the
  // server render and the client's. React reports that as a hydration mismatch
  // (#425 -> #418 -> #423) and throws away the server tree for this subtree.
  //
  // The fix is NOT to render the whole thing client-only: `children` here is
  // the hero product window, the pricing table and two bento tiles, all of
  // which must stay in the server HTML for crawlers and for anything reading
  // the page as text. So the CHILDREN render on the server exactly as before,
  // and only the decorative wrapper is added once mounted. With JS off the
  // result is no beam and all of the content, which is the right way round.
  if (!mounted) return <div className={props.className}>{children}</div>;

  return <Beam theme={theme} {...props}>{children}</Beam>;
}
