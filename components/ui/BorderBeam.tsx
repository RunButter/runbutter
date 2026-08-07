'use client';

import type { ReactNode } from 'react';

/**
 * An animated gradient border that travels around a card.
 *
 * The published component this follows lives behind a domain the build sandbox
 * cannot reach, so this is a clean-room implementation of the same API rather
 * than a copy — which is the right way round anyway: it uses our own semantic
 * tokens, so it works in both themes instead of carrying a second palette.
 *
 * HOW IT WORKS. A `conic-gradient` is painted on a pseudo-element one pixel
 * larger than the card, and a `mask` with `xor` composition punches the middle
 * out, leaving only the rim. Rotating the gradient's angle then reads as light
 * travelling around the edge. The alternative — four animated edges, or an SVG
 * `stroke-dasharray` — either breaks on rounded corners or forces a repaint per
 * frame.
 *
 * `@property --beam-angle` is what makes it cheap: registering the custom
 * property as an `<angle>` lets the browser interpolate it on the compositor.
 * Without the registration a custom property animates as a STRING, which means
 * a style recalculation every frame on every descendant — the exact thing that
 * made the hero canvas cost 2 seconds of blocked main thread earlier.
 *
 * Degrades to a plain static ring where `@property` is unsupported, and stops
 * entirely under prefers-reduced-motion: a light crawling around a card carries
 * no information, so there is nothing to preserve when someone asks for less.
 */

export type BeamSize = 'pulse-inner' | 'pulse' | 'thin';
export type BeamColor = 'sunset' | 'accent' | 'mono';

export default function BorderBeam({
  children,
  size = 'pulse',
  colorVariant = 'accent',
  className = '',
  /** Off until hovered — for a grid where every card beaming at once is noise. */
  onHoverOnly = false,
}: {
  children: ReactNode;
  size?: BeamSize;
  colorVariant?: BeamColor;
  className?: string;
  onHoverOnly?: boolean;
}) {
  return (
    <div
      className={`beam beam-${size} beam-${colorVariant} ${onHoverOnly ? 'beam-hover' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
