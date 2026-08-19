'use client';

import { useState } from 'react';
import { AlertTriangle, Shuffle, Undo2 } from 'lucide-react';
import { MOVES, contrastProblems, movesByGroup, type Move } from '@/lib/design/remix';
import type { DesignTokens } from '@/lib/design/tokens';

/**
 * Push the spec around without editing forty fields.
 *
 * ── EXPLORING IS THE WORK, AND IT IS THE PART PEOPLE ABANDON ────────────────
 * "Warmer" by hand means editing nine hex values consistently; "denser" means
 * eight spacing steps; "flip to dark" means all of that plus deciding what each
 * brand colour becomes on a ground it has never sat on. That is where people
 * get four-fifths of the way and stop. The mechanical half is arithmetic
 * (lib/design/remix.ts) — no model, no network, no key, and one right answer
 * every time, which is exactly what asking an LLM would take away.
 *
 * ── ONE STEP OF UNDO, AND IT IS ENOUGH ──────────────────────────────────────
 * These are experiments: press, look, keep or take it back. A full history
 * stack would be a nicer feature and a worse button, because the only question
 * anybody has after a move is "no, put it back".
 *
 * ── A COLOUR MOVE REPORTS WHAT IT BROKE ─────────────────────────────────────
 * Desaturating twice produces a muted grey that no longer passes 4.5:1, and
 * nothing on screen would say so until somebody shipped it. The same arithmetic
 * the contrast pane runs, surfaced at the moment the damage is done.
 */

export default function RemixBar({ t, onApply }: {
  t: DesignTokens;
  onApply: (next: DesignTokens) => void;
}) {
  const [undo, setUndo] = useState<{ tokens: DesignTokens; label: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const run = (m: Move) => {
    setUndo({ tokens: t, label: m.label });
    const next = m.apply(t);
    onApply(next);
    setProblems(m.group === 'Colour' ? contrastProblems(next) : []);
  };

  const back = () => {
    if (!undo) return;
    onApply(undo.tokens);
    setUndo(null); setProblems([]);
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-primary inline-flex items-center gap-1.5">
          <Shuffle className="w-3.5 h-3.5 text-tertiary" /> Move it
        </h3>
        <span className="flex-1" />
        {undo && (
          <button onClick={back}
            className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md text-2xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-hover">
            <Undo2 className="w-3 h-3" /> Undo “{undo.label}”
          </button>
        )}
      </div>
      <p className="mt-0.5 text-2xs text-tertiary">
        Every one is arithmetic, not a model — same input, same result, no key and nothing sent
        anywhere. Press a few, keep what works.
      </p>

      <div className="mt-2.5 flex flex-col gap-2">
        {movesByGroup().map((g) => (
          <div key={g.group} className="flex items-start gap-2">
            <span className="w-12 shrink-0 pt-1.5 text-3xs font-semibold uppercase tracking-wide text-tertiary">{g.group}</span>
            <div className="flex flex-wrap gap-1">
              {g.items.map((m) => (
                <button key={m.id} onClick={() => run(m)} title={m.detail}
                  className="h-7 px-2.5 rounded-md text-2xs font-medium text-secondary bg-surface-sunken ring-1 ring-subtle hover:bg-surface-hover hover:text-primary">
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!!problems.length && (
        <div className="mt-2.5 rounded-lg bg-warning/10 ring-1 ring-warning/30 p-2.5">
          <p className="text-2xs text-secondary inline-flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-px" />
            <span>
              That move left {problems.length === 1 ? 'a colour' : `${problems.length} colours`} below
              the readable threshold. Nudge {problems.length === 1 ? 'it' : 'them'} by hand, or undo.
            </span>
          </p>
          <ul className="mt-1 ml-5 flex flex-col gap-0.5">
            {problems.map((x, i) => <li key={i} className="text-3xs text-tertiary">{x}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
