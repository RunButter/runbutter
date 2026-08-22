import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

/**
 * What happens after somebody uses a free tool.
 *
 * ── FOUR OF THE FIVE TOOLS HAD NO NEXT STEP AT ALL ──────────────────────────
 * /pdf, /plugins and /ai-cost carried no link to the product, and /password
 * carried a sign-in link for people who by definition do not have an account.
 * So every visitor arriving from a search — the entire reason those pages were
 * built — used the tool and left, and the traffic was worth exactly nothing.
 * That is not a marketing oversight, it is a missing half of the feature.
 *
 * ── THE PITCH HAS TO FOLLOW FROM WHAT THEY JUST DID ─────────────────────────
 * "Also try our CRM" is an advert and gets ignored. "The PDF engine you just
 * used renders your invoices" is a reason, and it is TRUE — the same code does
 * both. Each tool passes its own sentence; a generic one would convert worse
 * and would also be the kind of claim nobody can check.
 *
 * ── AND IT LINKS THE OTHER TOOLS ────────────────────────────────────────────
 * Somebody who liked one free thing is the likeliest person to use a second.
 * Internal links between them are also what makes them rank as a cluster rather
 * than as five orphans — a page nothing links to is a page search engines treat
 * as unimportant, and until now these only appeared in the footer.
 */

export interface ToolLink { href: string; label: string; blurb: string }

export const TOOLS: ToolLink[] = [
  { href: '/brand', label: 'DESIGN.md builder', blurb: 'Brand tokens out of a logo and a PDF' },
  { href: '/brand/library', label: 'Style library', blurb: 'Complete design systems, free to copy' },
  { href: '/plugins', label: 'Agent skill builder', blurb: 'Write a skill, get an Agent Plugin' },
  { href: '/pdf', label: 'PDF toolkit', blurb: 'Merge, split, convert — in your browser' },
  { href: '/password', label: 'Password generator', blurb: 'Entropy shown, nothing sent anywhere' },
  { href: '/ai-cost', label: 'AI cost calculator', blurb: 'What an agent actually costs to run' },
];

export default function ToolFooter({ current, headline, body }: {
  /** This tool's href, so it is not listed as somewhere else to go. */
  current: string;
  /** One sentence connecting what they just used to what RunButter is. */
  headline: string;
  body: string;
}) {
  const others = TOOLS.filter((t) => t.href !== current);

  return (
    <section className="border-t border-subtle bg-surface-sunken">
      <div className="max-w-6xl mx-auto px-6 py-16 md:py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl md:text-3xl font-medium tracking-tight">{headline}</h2>
          <p className="text-secondary mt-3 leading-relaxed">{body}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/auth/register"
              className="inline-flex items-center gap-1.5 h-11 px-6 rounded-md bg-inverse text-inverse-fg text-sm font-medium hover:opacity-90 transition-opacity">
              Start free <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/#pricing"
              className="inline-flex items-center gap-1.5 h-11 px-5 rounded-md border border-subtle bg-surface text-primary text-sm font-medium hover:bg-surface-hover transition-colors">
              See what it costs
            </Link>
            <span className="text-2xs text-tertiary">Free plan, no card. Or self-host it — MIT.</span>
          </div>
        </div>

        <div className="mt-12">
          <p className="text-2xs font-mono uppercase tracking-widest text-tertiary">More free tools</p>
          <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {others.map((t) => (
              <Link key={t.href} href={t.href}
                className="rounded-xl ring-1 ring-subtle bg-surface px-4 py-3 hover:ring-strong transition-shadow">
                <div className="text-sm font-medium text-primary">{t.label}</div>
                <div className="mt-0.5 text-2xs text-tertiary leading-snug">{t.blurb}</div>
              </Link>
            ))}
          </div>
          <p className="mt-4 text-2xs text-tertiary">
            All of them run in your browser, need no account, and are{' '}
            <a href="https://github.com/RunButter/runbutter" target="_blank" rel="noreferrer" className="text-secondary hover:underline">MIT on GitHub</a>.
          </p>
        </div>
      </div>
    </section>
  );
}
