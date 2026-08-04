'use client';

/**
 * Thinking — the one place `thinking-orbs` is imported.
 *
 * Two reasons this wrapper exists rather than calling `<ThinkingOrb>` at 30
 * call sites:
 *
 * 1. **Vocabulary.** The package ships nine hand-tuned states with names from
 *    its own design language (`weaving`, `shaping`, `braid`). Ours are named
 *    after what the app is actually doing. Call sites say `kind="searching"`
 *    and never learn that `breathing` is the idle one — so swapping the
 *    library, or retuning which animation means "working", is one edit here.
 *
 * 2. **Reduced motion.** The package has no `prefers-reduced-motion` handling
 *    of its own — it exposes `paused`, which is the hook we need but not the
 *    policy. A continuously animating canvas is exactly the thing that setting
 *    exists to stop, so the policy lives here and cannot be forgotten at a
 *    call site.
 *
 * WHERE TO USE IT. Only where the wait is genuinely open-ended: an agent turn,
 * a file extraction, an OFAC ingest, a Graph round-trip, a full-text search.
 * A 200 ms save button keeps its `Loader2` — a hand-tuned orb on a keystroke
 * is noise, and swapping every spinner for one would make the app feel slower
 * than it is, not faster.
 *
 * SIZES. The package ships exactly two presets, 64 and 20, and they are
 * separate designs rather than one scaled — dot count, dot size and speed are
 * all retuned. So this exposes exactly two too (`avatar`, `inline`) instead of
 * a number, which would invite a 32 that renders as a blurry 64.
 */

import { useEffect, useState } from 'react';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';

/** What the app is doing — not what the animation looks like. */
export type ThinkingKind =
  | 'searching'    // candidate FTS, search_files, sanctions screening
  | 'composing'    // agent turns, post generation, anything generative
  | 'working'      // imports, Excel sync, file extraction, ingest
  | 'connecting'   // OAuth handshakes, Graph/provider round-trips
  | 'idle';        // waiting on a poll — nothing is running yet

const KIND_TO_STATE: Record<ThinkingKind, OrbState> = {
  searching: 'searching',
  composing: 'composing',
  working: 'working',
  connecting: 'connecting',
  idle: 'breathing',
};

/**
 * Live `prefers-reduced-motion`. Subscribed rather than read once, because
 * someone can flip it in OS settings with the tab already open.
 *
 * Starts `false` and corrects in an effect: on the server there is no
 * matchMedia, and guessing `true` would make the first client frame swap the
 * orb out and back in for everyone who has motion enabled.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduced;
}

export interface ThinkingProps {
  kind?: ThinkingKind;
  /** `avatar` = 64px (a panel or modal), `inline` = 20px (a row or a label). */
  size?: 'avatar' | 'inline';
  /**
   * Announced to screen readers. A spinner with no label is a silent wait, so
   * this defaults to something honest rather than to nothing.
   */
  label?: string;
  className?: string;
}

export function Thinking({ kind = 'working', size = 'inline', label = 'Working…', className }: ThinkingProps) {
  const reduced = useReducedMotion();
  return (
    <ThinkingOrb
      state={KIND_TO_STATE[kind]}
      size={size === 'avatar' ? 64 : 20}
      // `auto` walks up for a `dark` class — which is exactly how our theme is
      // applied (`app/globals.css` `:root` + `.dark`), so this tracks
      // useThemeSync() with nothing wired up.
      theme="auto"
      paused={reduced}
      aria-label={label}
      role="status"
      className={className}
    />
  );
}

/**
 * Orb plus the sentence explaining the wait. The label is the point: "Working…"
 * on its own is what a spinner already says, whereas "Reading 4 files" is the
 * reason a longer wait is tolerable.
 *
 * `aria-live="polite"` so the text is announced when it changes — the orb
 * itself is decorative here, since the same information is in the text.
 */
export function ThinkingLine({
  kind = 'working',
  label,
  hint,
  size = 'inline',
  className = '',
}: ThinkingProps & { label: string; hint?: string }) {
  const reduced = useReducedMotion();
  const stacked = size === 'avatar';
  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'flex text-tertiary',
        stacked ? 'flex-col items-center gap-3 text-center' : 'items-center gap-2',
        className,
      ].join(' ')}
    >
      <ThinkingOrb
        state={KIND_TO_STATE[kind]}
        size={stacked ? 64 : 20}
        theme="auto"
        paused={reduced}
        aria-hidden="true"
        className="shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-sm text-secondary truncate">{label}</span>
        {hint && <span className="block text-2xs text-tertiary truncate">{hint}</span>}
      </span>
    </div>
  );
}

export default Thinking;
