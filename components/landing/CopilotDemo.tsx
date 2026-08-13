'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, ArrowUp, Check, Wrench } from 'lucide-react';
import BorderBeam from '@/components/ui/BorderBeam';

/**
 * The Copilot demo on the landing page.
 *
 * It types a real exchange — a question, the tools it reaches for, the reply,
 * and the two changes waiting for approval. Every string here is something the
 * product actually does with tools that actually exist; a marketing demo that
 * shows an answer the software cannot give is the most expensive kind of lie,
 * because the person who believes it signs up.
 *
 * IT DOES NOT RUN UNTIL IT IS SEEN. An IntersectionObserver starts the script,
 * so the conversation is not already finished by the time somebody scrolls to
 * it — and, more to the point, a page that animates six timers below the fold
 * is a page that spends battery on nobody. Same reasoning as the agents
 * transcript above it, which pauses on `.reveal-in`.
 *
 * IT ALSO DOES NOT RUN IF YOU ASKED IT NOT TO. `prefers-reduced-motion` skips
 * straight to the finished state, which is the whole point of the setting: the
 * content is not the animation, so somebody who cannot tolerate motion should
 * get the content rather than an empty box.
 */

interface Beat {
  kind: 'user' | 'tools' | 'reply' | 'approve';
  text?: string;
  tools?: string[];
  items?: string[];
}

const SCRIPT: Beat[] = [
  { kind: 'user', text: 'Which clients owe us money, and chase the two oldest?' },
  { kind: 'tools', tools: ['list_records(invoices)', 'get_finance_summary', 'get_record(companies)'] },
  {
    kind: 'reply',
    text: 'Three are overdue: Nordwind (£12,400, 41 days), Kirkby (£3,900, 22 days) and Halden (£880, 9 days).\n\nI have drafted a chase note on the two oldest.',
  },
  { kind: 'approve', items: ['Add a note to Nordwind', 'Add a note to Kirkby'] },
];

const TYPE_MS = 26;

export default function CopilotDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [beat, setBeat] = useState(0);
  const [typed, setTyped] = useState('');
  const [done, setDone] = useState(false);

  // Start when it comes into view, once.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setStarted(true); setBeat(SCRIPT.length); setDone(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setStarted(true); io.disconnect(); }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The script. One timer at a time, cleared on unmount — a landing page that
  // leaves four interval handles behind is a landing page that leaks on every
  // client-side navigation.
  useEffect(() => {
    if (!started || done) return;
    const step = SCRIPT[beat];
    if (!step) { setDone(true); return; }

    if (step.kind === 'user' || step.kind === 'reply') {
      const full = step.text || '';
      if (typed.length < full.length) {
        // A few characters per tick rather than one: at one character every
        // 26ms a 130-character reply takes three and a half seconds, which is
        // longer than anybody watches a hero animation.
        const t = setTimeout(() => setTyped(full.slice(0, typed.length + 3)), TYPE_MS);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => { setBeat((b) => b + 1); setTyped(''); }, 700);
      return () => clearTimeout(t);
    }

    const t = setTimeout(() => setBeat((b) => b + 1), step.kind === 'tools' ? 1500 : 1200);
    return () => clearTimeout(t);
  }, [started, beat, typed, done]);

  const shown = (i: number) => beat > i || (beat === i && done);
  const typingNow = (i: number) => beat === i && !done;
  // The beam burns only while it is working, exactly as it does in the product.
  const working = started && !done && SCRIPT[beat]?.kind !== 'user';

  const panel = (
    <div className="w-full rounded-2xl ring-1 ring-subtle bg-surface shadow-card overflow-hidden">
      <div className="h-11 flex items-center gap-2 px-4 border-b border-subtle">
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        <span className="text-sm font-medium text-primary">Copilot</span>
        <span className="ml-auto text-2xs text-tertiary">Suggest</span>
      </div>

      <div className="p-4 space-y-3 min-h-[19rem]">
        {/* 1 — the question */}
        {(shown(0) || typingNow(0)) && (
          <div className="flex justify-end">
            <div className="max-w-[88%] rounded-2xl rounded-br-md bg-inverse text-inverse-fg px-3 py-1.5 text-sm text-left">
              {beat === 0 ? typed : SCRIPT[0].text}
              {typingNow(0) && <Caret />}
            </div>
          </div>
        )}

        {/* 2 — what it reached for */}
        {(shown(1) || beat === 1) && (
          <div className="space-y-1">
            {(SCRIPT[1].tools || []).map((t, i) => (
              <div
                key={t}
                className="flex items-center gap-1.5 text-2xs text-tertiary font-mono"
                style={{ animation: `rb-fade .3s ease both`, animationDelay: `${i * 0.28}s` }}
              >
                <Wrench className="w-3 h-3 shrink-0" /> {t}
              </div>
            ))}
          </div>
        )}

        {/* 3 — the answer */}
        {(shown(2) || typingNow(2)) && (
          <p className="text-sm text-primary leading-relaxed whitespace-pre-wrap">
            {beat === 2 ? typed : SCRIPT[2].text}
            {typingNow(2) && <Caret />}
          </p>
        )}

        {/* 4 — and the part that makes it safe */}
        {(shown(3) || beat === 3) && (
          <div className="rounded-xl ring-1 ring-subtle bg-surface-sunken p-2.5 space-y-2" style={{ animation: 'rb-fade .35s ease both' }}>
            <div className="text-2xs font-medium uppercase tracking-wider text-tertiary">2 changes waiting for you</div>
            <ul className="space-y-1">
              {(SCRIPT[3].items || []).map((it) => (
                <li key={it} className="text-xs text-secondary flex items-start gap-1.5">
                  <span className="text-tertiary mt-px">·</span>{it}
                </li>
              ))}
            </ul>
            <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-semibold bg-inverse text-inverse-fg">
              <Check className="w-3 h-3" /> Apply
            </span>
          </div>
        )}
      </div>

      <div className="px-4 pb-4">
        <div className="rounded-xl ring-1 ring-subtle bg-surface-sunken h-9 flex items-center gap-2 px-3">
          <span className="text-xs text-tertiary flex-1">Ask, or tell it what to do…</span>
          <span className="h-6 w-6 rounded-lg bg-inverse text-inverse-fg inline-flex items-center justify-center">
            <ArrowUp className="w-3 h-3" />
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div ref={ref}>
      <style>{`@keyframes rb-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes rb-caret{0%,49%{opacity:1}50%,100%{opacity:0}}`}</style>
      {working
        ? <BorderBeam // `md` with the strength up: the package offers sm | md | line |
        // pulse-outside | pulse-inner, and there is no `lg`. Strength is the
        // dial that makes it read as "working", not size.
        size="md" colorVariant="colorful" strength={0.95} className="flex w-full">{panel}</BorderBeam>
        : panel}
    </div>
  );
}

function Caret() {
  return <span className="inline-block w-px h-[1em] align-[-0.1em] ml-px bg-current" style={{ animation: 'rb-caret 1s step-end infinite' }} />;
}
