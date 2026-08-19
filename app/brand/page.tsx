import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, FolderTree } from 'lucide-react';
import BrandStudioClient from '@/components/design/BrandStudioClient';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';
import { SITE_URL } from '@/lib/site';

/**
 * The free DESIGN.md builder.
 *
 * ── WHY /brand AND NOT /design ──────────────────────────────────────────────
 * `app/(crm)/design` already renders at /design — the route group contributes
 * nothing to the URL — so a public page there is a hard collision. The same one
 * that pushed the skill builder to /plugins and the agents marketing page to
 * /ai-agents. /brand is also the better search term: nobody types "design" and
 * means this.
 *
 * Outside the (crm) group on purpose, so it gets marketing chrome and no Privy
 * shell. `/brand` is in PUBLIC_PREFIXES for that second half — a route missing
 * from that list merely loads the auth SDK it does not need and costs ~600ms of
 * main-thread work on a page whose whole point is that it needs no account.
 *
 * ── NOTHING IS UPLOADED, AND THAT IS THE PRODUCT ────────────────────────────
 * Unlike /plugins, there is not even one exception: no AI call, no server
 * route. A logo and an unreleased brand book are exactly the material nobody
 * should have to post to a stranger's server to get a zip back, and the whole
 * extraction is a canvas and pdf.js. Same rule as /pdf and /qr.
 *
 * The prose below the tool is not filler. This page has to be the answer when
 * somebody asks what a DESIGN.md is, and that answer has to be in the HTML
 * rather than inside a component that renders after a click — otherwise it is
 * useless to every crawler and every agent reading the page as text.
 */

const TITLE = 'Free DESIGN.md generator — brand tokens from your logo';
const DESCRIPTION =
  'Upload a logo and your brand PDF, get the exact hex codes, fonts, sizes and rules out of them. Live preview, WCAG contrast check, and a DESIGN.md, design.json, tokens.css and Tailwind fragment your AI agents can follow. Free, in your browser, nothing uploaded.';

export const metadata: Metadata = {
  title: `${TITLE} — RunButter`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/brand` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE_URL}/brand`, type: 'website' },
};

const LAYOUT = `acme-brand/
├── DESIGN.md              a person, and an AI agent
├── design.json            scripts and build steps
├── tokens.css             the browser — every value a --brand-* property
├── tailwind.tokens.js     merge into theme.extend
├── README.md              which file goes where
└── assets/
    └── logo.svg`;

const RULES: [string, string][] = [
  ['A brand spec has two layers',
   'Hex codes, font names and a numeric scale are DETERMINISTIC — a model must never guess them and you must never retype them. What each colour is for, how the voice sounds and what you never do is JUDGEMENT. Nearly every hand-written DESIGN.md is only the second, which is why they need tinkering.'],
  ['The exact values go first, as JSON',
   'A fenced JSON block near the top is the part a model lifts verbatim rather than interprets. Prose calling something "a deep indigo" is how #6366F1 becomes #4F46E5 on the third screen.'],
  ['The colours come out exactly',
   'Not a quantised approximation. Buckets are used only to group; each group reports its most common exact pixel, so a flat #0A2540 comes back as #0A2540. An SVG is read as text first — fill="#0A2540" is the value your designer typed, while a rendered pixel has been through anti-aliasing and a colour profile.'],
  ['Pantone and CMYK are named, never converted',
   'Pantone is a licensed system with no free lookup table, and CMYK depends on the paper and the press. A hex derived from either would be an invented number, so this tool tells you it saw them and asks you for the value instead.'],
  ['The never-list does the most work',
   'It is last in the file and blunt on purpose. A constraint buried mid-paragraph is one an agent averages against everything else it read.'],
];

export default function BrandPage() {
  return (
    <div className="min-h-screen bg-canvas text-primary antialiased">
      <MarketingHeader />

      <section className="border-b border-subtle">
        <div className="max-w-6xl mx-auto px-6 pt-24 md:pt-32 pb-20 md:pb-24">
          <div className="max-w-2xl">
            <span className="text-2xs font-mono text-tertiary">DESIGN.md · design tokens</span>
            <h1 className="mt-3 text-4xl md:text-6xl font-medium tracking-[-0.03em] leading-[1.02]">
              Stop your AI<br />
              <span className="text-secondary">guessing at your brand.</span>
            </h1>
            <p className="mt-6 text-base md:text-lg text-secondary leading-relaxed max-w-lg">
              Upload your logo and your brand PDF. The exact hex codes, fonts, sizes and rules come
              out of them — no retyping. See it applied to a real page before you export it.
            </p>
            <p className="mt-3 text-sm text-tertiary">
              Free, no account, and nothing is uploaded — the canvas reads your logo and pdf.js reads
              your document, both in this tab. Your unreleased brand book stays on your machine.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-[1600px] mx-auto px-6 py-14 md:py-20">
        <BrandStudioClient />
      </section>

      {/* ── What you just made ─────────────────────────────────────────────
          Static prose, in the HTML, for the reader who arrived asking "what is
          a DESIGN.md" rather than already knowing. */}
      <section className="border-t border-subtle bg-surface-sunken">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-24 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-12 lg:gap-16">
          <div className="min-w-0">
            <h2 className="text-2xl md:text-3xl font-medium tracking-tight">Four files, four readers</h2>
            <p className="text-secondary mt-3 leading-relaxed">
              A brand has to reach a person, a coding agent, a build step and a stylesheet, and none of
              them wants the same file. All four are generated from one source here, so they cannot drift
              into describing different colours.
            </p>
            <div className="mt-6 rounded-xl overflow-hidden ring-1 ring-subtle">
              <div className="h-9 flex items-center gap-2 px-3.5 bg-inverse/95">
                <FolderTree className="w-3.5 h-3.5 text-inverse-fg/60" />
                <span className="text-2xs font-mono text-inverse-fg/60">what you download</span>
              </div>
              <pre className="bg-inverse text-inverse-fg/90 text-2xs font-mono leading-relaxed p-4 overflow-x-auto">{LAYOUT}</pre>
            </div>
            <p className="mt-6 text-xs text-tertiary leading-relaxed">
              Put <code className="bg-surface-hover rounded px-1">DESIGN.md</code> at the root of your
              repository and Claude Code, Cursor and Copilot pick it up. There is also an{' '}
              <a href="https://agent-plugins.org" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Agent Plugins 1.0</a>
              {' '}export — <code className="bg-surface-hover rounded px-1">skills/design/SKILL.md</code> with{' '}
              <code className="bg-surface-hover rounded px-1">design.json</code> beside it — for clients that
              install skills rather than read files.
            </p>
          </div>

          <div className="min-w-0">
            <h2 className="text-2xl md:text-3xl font-medium tracking-tight">Worth knowing</h2>
            <dl className="mt-6 space-y-5">
              {RULES.map(([h, b]) => (
                <div key={h} className="border-t border-strong pt-4">
                  <dt className="text-sm font-medium text-primary">{h}</dt>
                  <dd className="text-xs text-secondary mt-1.5 leading-relaxed">{b}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ── Why the preview is half the tool ───────────────────────────────── */}
      <section className="border-t border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-2xl md:text-3xl font-medium tracking-tight">Nine swatches in a row always look fine</h2>
            <p className="text-secondary mt-3 leading-relaxed">
              The same nine become a button whose label cannot be read, a surface you cannot tell from the
              page, and a warning colour that reads as decoration — and none of that shows up until
              something real is drawn with them. So the preview draws a marketing page, a product screen,
              a type specimen at real sizes, and a WCAG contrast table using the same arithmetic an
              auditor runs.
            </p>
            <p className="text-secondary mt-3 leading-relaxed">
              A font you have named but have not installed is reported as missing rather than quietly
              rendered as Helvetica. There is no score, either: the tool lists what is still missing in
              the order worth fixing, because a brand is not 78% done.
            </p>
          </div>
        </div>
      </section>

      {/* ── Where this leads ───────────────────────────────────────────────── */}
      <section className="border-t border-subtle bg-surface-sunken">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-2xl md:text-3xl font-medium tracking-tight">A spec your agents actually carry</h2>
            <p className="text-secondary mt-3 leading-relaxed">
              A file is only useful if something reads it. Inside RunButter this same studio saves the spec
              to your workspace and publishes it as a skill every agent carries into its system prompt — so
              &ldquo;write the launch email&rdquo; and &ldquo;draft the invoice note&rdquo; come out in your
              colours and your words without being told each time. Free and MIT, self-hosted or hosted.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/auth/register" className="inline-flex items-center gap-1.5 h-10 px-5 rounded-md bg-inverse text-inverse-fg text-sm font-medium hover:opacity-90 transition-opacity">
                Start free <ArrowRight className="w-4 h-4" />
              </Link>
              <Link href="/plugins" className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md border border-subtle bg-surface text-primary text-sm font-medium hover:bg-surface-hover transition-colors">
                Build an agent skill
              </Link>
              <Link href="/developers/design" className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md border border-subtle bg-surface text-primary text-sm font-medium hover:bg-surface-hover transition-colors">
                Read the docs
              </Link>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
