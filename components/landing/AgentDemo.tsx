'use client';

import { useState } from 'react';
import { Bot, ChevronRight, ShieldCheck, Terminal, User } from 'lucide-react';

/**
 * "Ask your workspace" — the second interactive window on the landing page.
 *
 * The bento tile claims agents read and write your workspace on your own key
 * and ask before they write. That is the hardest claim on the page to believe
 * from one sentence, and a screenshot cannot show it, because the interesting
 * part is the SEQUENCE: a question, the tools it chose, and a write that stops
 * for approval instead of happening.
 *
 * THE WHOLE TRANSCRIPT IS IN THE HTML. The "playing" effect is CSS
 * animation-delay per line — a from-state of opacity 0, never `hidden`, never a
 * conditional render — so anything reading the page as text (an AI agent
 * fetching the URL, a crawler that does not run JS, reader mode) gets the
 * complete exchange. There is no timer and no IntersectionObserver here at all;
 * the animation is paused until an ancestor Reveal marks the block on-screen,
 * which is the same machinery every other section already uses.
 *
 * Every tool named below is a REAL tool from lib/agents/catalog.ts. Inventing a
 * plausible-sounding one would be a fabricated capability on a marketing page,
 * which is the same rule as not fabricating a chart.
 */

type Line =
  | { kind: 'tool'; tool: string; note: string }
  | { kind: 'say'; text: string }
  | { kind: 'approve'; text: string };

const CONVERSATIONS: { q: string; short: string; lines: Line[] }[] = [
  {
    short: 'Renewals vs. debt',
    q: 'Which contracts auto-renew in the next 60 days, for clients who owe us money?',
    lines: [
      { kind: 'tool', tool: 'search_files', note: '“auto-renew” across 214 indexed documents' },
      { kind: 'tool', tool: 'get_ledger', note: 'unpaid invoices, past due date' },
      { kind: 'tool', tool: 'get_record', note: 'the 3 companies on both sides' },
      { kind: 'say', text: 'Three. Northwind renews 12 Mar and owes $24,000 across two invoices, the older one 41 days late. Vertex renews 3 Apr with $8,400 outstanding. Cobalt renews 19 Apr and is 6 days late on $3,100 — probably just a slow month.' },
      { kind: 'say', text: 'The Northwind contract needs 30 days’ notice, so the decision is due 10 Feb.' },
    ],
  },
  {
    short: 'Chase the late ones',
    q: 'Draft a reminder for everyone more than 30 days late, in our usual tone.',
    lines: [
      { kind: 'tool', tool: 'get_finance_summary', note: '7 invoices over 30 days late' },
      { kind: 'tool', tool: 'get_record_notes', note: 'what was agreed with each of them' },
      { kind: 'say', text: 'Seven drafts written, using your “Invoice reminder tone” skill: friendly, assumes an oversight, names the invoice and the original due date, never offers a payment plan.' },
      { kind: 'say', text: 'Two are worth reading first — Vertex asked for a 60-day term in writing on 4 Jan, and Lumen already paid $6,000 of $18,200.' },
      { kind: 'approve', text: 'Send 7 emails and mark the invoices as chased' },
    ],
  },
  {
    short: 'Hiring, honestly',
    q: 'Who is furthest along for the sales role, and how did they actually score?',
    lines: [
      { kind: 'tool', tool: 'get_hiring_pipeline', note: 'Sales Lead — 34 applicants, 5 past screening' },
      { kind: 'tool', tool: 'get_candidate', note: 'skills and Big-5 results for those 5' },
      { kind: 'say', text: 'David Reyes is at offer, 88 overall — highest on the skills half, mid-range on conscientiousness. Anna Kowalski is one stage behind at 92 and the strongest fit against the team profile you saved.' },
      { kind: 'say', text: 'No cognitive score exists for either of them: RunButter does not run one, so that column is empty rather than guessed.' },
    ],
  },
];

function Row({ line, i }: { line: Line; i: number }) {
  // Staggered by index. 260ms is fast enough that reading is not gated on it
  // and slow enough that the ORDER is legible, which is the entire point.
  const style = { animationDelay: `${180 + i * 260}ms` };

  if (line.kind === 'tool') {
    return (
      <div className="agent-line flex items-center gap-2 py-1" style={style}>
        <Terminal className="w-3 h-3 text-tertiary shrink-0" />
        <code className="text-2xs font-mono text-primary">{line.tool}</code>
        <span className="text-2xs text-tertiary truncate">{line.note}</span>
      </div>
    );
  }

  if (line.kind === 'approve') {
    return (
      <div className="agent-line mt-3 rounded-lg border border-strong bg-surface-sunken p-3" style={style}>
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-2xs font-medium text-primary">Waiting for your approval</span>
        </div>
        <p className="mt-1.5 text-xs text-secondary leading-relaxed">{line.text}</p>
        <div className="mt-2.5 flex items-center gap-2">
          {/* Not real buttons: this is a picture of the app, and a control that
              looks live but does nothing is worse than one that reads as part
              of the illustration. */}
          <span className="h-6 px-2.5 rounded-md bg-inverse text-inverse-fg text-2xs font-medium inline-flex items-center">Approve</span>
          <span className="h-6 px-2.5 rounded-md border border-subtle text-secondary text-2xs font-medium inline-flex items-center">Edit first</span>
        </div>
      </div>
    );
  }

  return <p className="agent-line text-xs sm:text-sm text-secondary leading-relaxed mt-2.5" style={style}>{line.text}</p>;
}

export default function AgentDemo() {
  const [pick, setPick] = useState(0);
  // Bumped on every pick so the chosen transcript gets a fresh React key and
  // remounts, which restarts its CSS animation-delays. That is the entire
  // replay mechanism — no timer, no state per line.
  const [plays, setPlays] = useState(0);
  const choose = (i: number) => { setPick(i); setPlays((n) => n + 1); };

  return (
    <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-popover overflow-hidden">
      <div className="h-10 flex items-center gap-3 px-3.5 border-b border-subtle bg-surface-sunken">
        <div className="hidden sm:flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-strong" />
          <span className="w-2.5 h-2.5 rounded-full bg-strong" />
          <span className="w-2.5 h-2.5 rounded-full bg-strong" />
        </div>
        <span className="text-2xs font-medium text-secondary flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5" /> Operations agent
        </span>
        <span className="ml-auto text-3xs font-mono text-tertiary">your own API key</span>
      </div>

      <div className="grid md:grid-cols-[220px_1fr] divide-y md:divide-y-0 md:divide-x divide-subtle">
        {/* Ask something else. Radio semantics, not tabs: these pick which
            question was asked, they do not switch between views of one thing. */}
        <div role="radiogroup" aria-label="Example questions" className="p-3 bg-surface-sunken/50">
          <p className="text-3xs font-medium uppercase tracking-wide text-tertiary px-1.5 mb-2">Ask</p>
          {CONVERSATIONS.map((c, i) => (
            <button key={c.short} role="radio" aria-checked={i === pick} aria-controls={`agent-convo-${i}`}
              onClick={() => choose(i)}
              className={`w-full text-left rounded-lg px-2 py-2 mb-1 flex items-center gap-1.5 transition-colors ${
                i === pick ? 'bg-surface ring-1 ring-subtle shadow-sm text-primary' : 'text-secondary hover:bg-surface-hover'}`}>
              <ChevronRight className={`w-3 h-3 shrink-0 transition-transform ${i === pick ? 'translate-x-0.5 text-primary' : 'text-tertiary'}`} />
              <span className="text-2xs font-medium">{c.short}</span>
            </button>
          ))}
        </div>

        {/* ALL THREE transcripts are rendered; the inactive ones carry `hidden`.
            The first version of this rendered only the chosen one — the same
            mistake ProductPreview had, on the same page, where two thirds of
            the strongest copy would have existed only after a click and never
            in the HTML an agent or a crawler reads. */}
        {/* Sized to the TALLEST transcript at each breakpoint (measured: 373px
            desktop, 430px on a 390px-wide phone), so switching question never
            moves the rest of the page. The dead space under the shorter two is
            the price, and it is much cheaper than the content below jumping
            110px every time someone clicks. */}
        <div className="min-h-[440px] sm:min-h-[380px]">
          {CONVERSATIONS.map((c, i) => (
            <div
              // A changed key remounts the subtree, restarting the animations.
              // Only the active one needs it; the others keep a stable key.
              key={i === pick ? `${i}:${plays}` : `${i}`}
              id={`agent-convo-${i}`} hidden={i !== pick} className="p-4 sm:p-5">
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-surface-sunken ring-1 ring-subtle flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-3 h-3 text-tertiary" />
                </span>
                <p className="text-sm text-primary font-medium leading-relaxed">{c.q}</p>
              </div>

              <div className="mt-4 pl-1 sm:pl-7">
                <div className="border-l border-subtle pl-3.5">
                  {c.lines.map((l, n) => <Row key={n} line={l} i={n} />)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
