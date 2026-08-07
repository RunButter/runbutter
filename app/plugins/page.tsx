import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, FolderTree } from 'lucide-react';
import PluginBuilder from '@/components/plugins/PluginBuilder';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';
import { SPEC_VERSION } from '@/lib/plugins/agent-plugin';
import { SITE_URL } from '@/lib/site';

/**
 * The free Agent Plugin / skill builder.
 *
 * NOT at /skills — `app/(crm)/skills` already owns that path, and a second
 * route with the same name is the collision that already cost us once with
 * /agents. /plugins is also the more accurate name: the output is an Agent
 * Plugin, of which skills are one part.
 *
 * Outside the (crm) route group on purpose, so it gets the marketing chrome
 * and no Privy shell. It is a public tool with no account and no server call —
 * the whole builder is client-side — which is what makes it worth linking to
 * from anywhere.
 *
 * The explanatory prose below the tool is not filler. This page's job is to be
 * the answer when somebody asks what a SKILL.md is, and that answer has to be
 * in the HTML rather than inside a React component that only renders after a
 * click, or it is useless to every crawler and every agent that reads the page
 * as text.
 */

const TITLE = 'Free Agent Plugin & Skill builder';
const DESCRIPTION =
  'Build an Agent Plugin in your browser — write skills, get a spec-conformant plugin.json, SKILL.md files and mcp.json, and download the zip. No account, nothing uploaded, MIT.';

export const metadata: Metadata = {
  title: `${TITLE} — RunButter`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/plugins` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE_URL}/plugins`, type: 'website' },
};

const LAYOUT = `my-team-skills/
├── plugin.json              the manifest — $schema and name are the only required keys
├── mcp.json                 optional: MCP servers the plugin brings with it
└── skills/
    ├── invoice-reminder-tone/
    │   └── SKILL.md
    └── house-writing-style/
        └── SKILL.md`;

const RULES: [string, string][] = [
  ['A skill is a file, not code',
   'YAML frontmatter with a name and a description, then Markdown. Nothing to compile, nothing to run.'],
  ['The description is the important line',
   'It is what a model reads to decide whether the skill applies right now. "How this company chases an unpaid invoice" gets picked up; "invoice stuff" does not.'],
  ['The name must match the directory',
   'A mismatch is reported as "invalid skill" with no clue which half was wrong, so the builder derives both from one field.'],
  ['A plugin cannot carry your API key',
   `The spec treats header values as visible package data and forbids embedded credentials. Whoever installs supplies their own key — anything offering a shortcut is writing a secret into a file people commit.`],
];

export default function PluginsPage() {
  return (
    <div className="min-h-screen bg-canvas text-primary antialiased">
      <MarketingHeader />

      <section className="border-b border-subtle">
        <div className="max-w-6xl mx-auto px-6 pt-24 md:pt-32 pb-20 md:pb-24">
          <div className="max-w-2xl">
            <span className="text-2xs font-mono text-tertiary">Agent Plugins {SPEC_VERSION}</span>
            <h1 className="mt-3 text-4xl md:text-6xl font-medium tracking-[-0.03em] leading-[1.02]">
              Build an agent skill.<br />
              <span className="text-secondary">Free, in your browser.</span>
            </h1>
            <p className="mt-6 text-base md:text-lg text-secondary leading-relaxed max-w-lg">
              Write down how your team does something. Get a package that installs into Claude Code,
              Cursor and anything else reading the standard.
            </p>
            <p className="mt-3 text-sm text-tertiary">No account. Nothing uploaded. The zip is made in this tab.</p>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-14 md:py-20">
        <PluginBuilder />
      </section>

      {/* ── What you just made ─────────────────────────────────────────────
          Static prose, in the HTML, for the reader who arrived asking "what is
          a SKILL.md" rather than already knowing. */}
      <section className="border-t border-subtle bg-surface-sunken">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-24 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-12 lg:gap-16">
          <div className="min-w-0">
            <h2 className="text-2xl md:text-3xl font-medium tracking-tight">What a plugin actually is</h2>
            <p className="text-secondary mt-3 leading-relaxed">
              A directory of text files. Agent Plugins is a vendor-neutral standard — its technical steering
              committee is Amazon, Cursor, Microsoft, OpenAI and Vercel — so the same folder installs into any
              client that supports it, and you are not writing to one vendor&apos;s format.
            </p>
            <div className="mt-6 rounded-xl overflow-hidden ring-1 ring-subtle">
              <div className="h-9 flex items-center gap-2 px-3.5 bg-inverse/95">
                <FolderTree className="w-3.5 h-3.5 text-inverse-fg/60" />
                <span className="text-2xs font-mono text-inverse-fg/60">the layout</span>
              </div>
              <pre className="bg-inverse text-inverse-fg/90 text-2xs font-mono leading-relaxed p-4 overflow-x-auto">{LAYOUT}</pre>
            </div>
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
            <p className="mt-6 text-xs text-tertiary leading-relaxed">
              The full rules live at{' '}
              <a href="https://agent-plugins.org" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">agent-plugins.org</a>
              {' '}and{' '}
              <a href="https://code.claude.com/docs/en/skills" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">code.claude.com/docs/en/skills</a>.
            </p>
          </div>
        </div>
      </section>

      {/* ── Where this leads ───────────────────────────────────────────────── */}
      <section className="border-t border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-2xl md:text-3xl font-medium tracking-tight">Skills your agents can actually use</h2>
            <p className="text-secondary mt-3 leading-relaxed">
              A skill on its own is knowledge with nowhere to apply it. In RunButter the same skills attach to
              agents that read and write your workspace — sales, invoicing, files, hiring — through a scoped
              set of tools, on your own AI key. You can import skills straight from a public GitHub repository,
              and export any workspace&apos;s skills back out as a plugin like the one above.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/ai-agents" className="inline-flex items-center gap-1.5 h-10 px-5 rounded-md bg-inverse text-inverse-fg text-sm font-medium hover:opacity-90 transition-opacity">
                See how agents work <ArrowRight className="w-4 h-4" />
              </Link>
              <Link href="/developers/agents" className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md border border-subtle bg-surface text-primary text-sm font-medium hover:bg-surface-hover transition-colors">
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
