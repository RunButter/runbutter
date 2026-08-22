import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';
import { TOOLS } from '@/components/landing/ToolFooter';
import { SITE_URL } from '@/lib/site';

/**
 * One page that lists all of them.
 *
 * ── SIX ORPHANS ARE NOT A CLUSTER ───────────────────────────────────────────
 * Until now the free tools appeared only in the site footer and in one bento
 * tile. Nothing linked them to each other, which is the difference between six
 * pages a search engine treats as unimportant and a group it treats as a
 * subject somebody covers. It is also the difference for a HUMAN: whoever came
 * for the PDF merger had no way to discover the rest.
 *
 * The list lives in `ToolFooter` and is imported here, so adding a tool adds it
 * to this page and to the footer of every other tool at once. A hand-kept
 * second copy is how one of them ends up missing for a year.
 */

const TITLE = 'Free tools — no account, nothing uploaded';
const DESCRIPTION =
  'Six free tools that run entirely in your browser: a DESIGN.md builder, a design system library, an agent skill builder, a PDF toolkit, a password generator and an AI cost calculator. No sign-up, no upload, MIT licensed.';

export const metadata: Metadata = {
  title: `${TITLE} — RunButter`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/tools` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE_URL}/tools`, type: 'website' },
};

const WHY: [string, string][] = [
  ['They run in your tab',
   'Your logo, your contracts, your brand book and your passwords never reach a server. That is not a promise about our retention policy, it is an absence of an upload — the code is on GitHub and you can read it.'],
  ['No account, no email wall',
   'Every one of them works the moment the page loads. Nothing is gated behind a sign-up you have to undo later.'],
  ['They are the same code as the product',
   'The PDF engine renders our invoices, the design studio writes the skill our agents carry, the vault crypto is the vault. They are not marketing demos — they are the parts, given away.'],
];

export default function ToolsPage() {
  return (
    <div className="min-h-screen bg-canvas text-primary antialiased">
      <MarketingHeader />

      <section className="border-b border-subtle">
        <div className="max-w-6xl mx-auto px-6 pt-24 md:pt-32 pb-16 md:pb-20">
          <div className="max-w-2xl">
            <span className="text-2xs font-mono text-tertiary">FREE · MIT · NOTHING UPLOADED</span>
            <h1 className="mt-3 text-4xl md:text-6xl font-medium tracking-[-0.03em] leading-[1.02]">
              Six tools.<br /><span className="text-secondary">No account, no upload.</span>
            </h1>
            <p className="mt-6 text-base md:text-lg text-secondary leading-relaxed max-w-lg">
              Built as parts of RunButter and given away whole. Each one works in the tab you have
              open, and none of them asks who you are.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-14 md:py-20">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {TOOLS.map((t) => (
            <Link key={t.href} href={t.href}
              className="group rounded-2xl ring-1 ring-subtle bg-surface p-5 hover:ring-strong transition-shadow">
              <div className="text-base font-medium text-primary">{t.label}</div>
              <div className="mt-1.5 text-sm text-secondary leading-snug">{t.blurb}</div>
              <div className="mt-4 text-2xs font-medium text-tertiary inline-flex items-center gap-1 group-hover:text-primary">
                Open <ArrowRight className="w-3 h-3" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-t border-subtle bg-surface-sunken">
        <div className="max-w-6xl mx-auto px-6 py-16 md:py-20 grid md:grid-cols-3 gap-8 md:gap-12">
          {WHY.map(([h, b]) => (
            <div key={h}>
              <h2 className="text-sm font-medium text-primary">{h}</h2>
              <p className="mt-2 text-sm text-secondary leading-relaxed">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-16 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-2xl md:text-3xl font-medium tracking-tight">And the thing they came out of</h2>
            <p className="text-secondary mt-3 leading-relaxed">
              RunButter is one workspace where a company, a person, a deal, an invoice, a campaign and
              a candidate are connected records in one Postgres database — with AI agents that work on
              the same records your team does, on your own API key. Free plan, no card. Or run the
              whole thing yourself; it is MIT.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/auth/register"
                className="inline-flex items-center gap-1.5 h-11 px-6 rounded-md bg-inverse text-inverse-fg text-sm font-medium hover:opacity-90 transition-opacity">
                Start free <ArrowRight className="w-4 h-4" />
              </Link>
              <a href="https://github.com/RunButter/runbutter" target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 h-11 px-5 rounded-md border border-subtle bg-surface text-primary text-sm font-medium hover:bg-surface-hover transition-colors">
                Star it on GitHub
              </a>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
