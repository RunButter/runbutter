import Link from 'next/link';
import Script from 'next/script';
import { ArrowRight, Check, Target, Wallet, FolderKanban, Heart, Megaphone, FileText, Building2, Table, CheckCheck, ShieldCheck, Zap, Plug, Sparkles, Github } from 'lucide-react';

// Self-tracking (dogfooding our own web analytics). Production only, so dev
// and preview visits never pollute the stats. Site ids are public by nature —
// they appear in any tracked page's HTML.
const ANALYTICS_SITE_ID = process.env.NEXT_PUBLIC_ANALYTICS_SITE_ID || 'a0f643e7-6b67-4290-8a8d-72f65cf7e341';
const TRACK = process.env.NODE_ENV === 'production';
import Logo from '@/components/Logo';
import AsciiField from '@/components/landing/AsciiField';
import ProductPreview from '@/components/landing/ProductPreview';
import Showcase from '@/components/landing/Showcase';
import Reveal from '@/components/landing/Reveal';
import ThemeToggle from '@/components/landing/ThemeToggle';
import CopyCommand from '@/components/landing/CopyCommand';

const REPO_URL = 'https://github.com/CasperCrypto/hirebtr';

const FEATURES = [
  'Drag-and-drop boards', 'Spreadsheet-style tables', 'CSV / Google Sheets import',
  'One-click export', 'Bulk select & actions', 'Bank reconciliation',
  'Branded PDF invoices', 'First-party web analytics', 'Automations',
  'REST API & signed webhooks', 'MCP for AI agents', 'Zero AI token cost',
];

// Five pillars over one relational core.
const PILLARS = [
  { icon: Target, name: 'Sales CRM', body: 'Companies, people, and a drag-and-drop deal pipeline.' },
  { icon: Wallet, name: 'Finance', body: 'Invoices, expenses, a bank ledger, and live revenue KPIs.' },
  { icon: Megaphone, name: 'Marketing', body: 'Campaigns, a social post studio, and web analytics.' },
  { icon: FolderKanban, name: 'Projects', body: 'Projects and issues on a clean board.' },
  { icon: Heart, name: 'Recruiting & HR', body: 'Skills + personality hiring, onboarding, and your team.' },
];

const CAPS = [
  { icon: Zap, name: 'Automations', body: 'When something happens, do something: fire webhooks, send emails, create records. Templates included.' },
  { icon: Plug, name: 'Open integrations', body: 'REST API, signed webhooks, Zapier and Make, plus MCP so AI agents can work inside your workspace.' },
  { icon: Sparkles, name: 'AI docs with your key', body: 'Draft and edit documents with Claude, GPT, or Gemini using your own API key. No token markup.' },
  { icon: FolderKanban, name: 'Projects & roadmap', body: 'An issue board plus a Gantt-lite roadmap across every project.' },
  { icon: FileText, name: 'e-Invoicing (KSeF)', body: 'Export compliant FA(3) e-invoices for Poland, straight from your documents.' },
  { icon: Building2, name: 'Company lookup', body: 'Autofill a client from its VAT or NIP number, via MF Biała lista and EU VIES.' },
  { icon: Table, name: 'Import & export', body: 'Bring data in from CSV or a Google Sheet; export any list back with one click.' },
  { icon: CheckCheck, name: 'Bulk actions', body: 'Select, categorize, export, and delete in bulk on every object list.' },
  { icon: ShieldCheck, name: 'GDPR & privacy', body: 'Consent logging, data anonymization, and cookieless first-party analytics.' },
];

const PLANS = [
  { name: 'Free', price: '$0', sub: 'for trying it out', features: ['1 workspace · 1 seat', 'Up to 25 records / object', 'Sales · Finance · Marketing · Projects · HR', 'CSV & Google Sheets import'], cta: 'Start free', href: '/auth/register?plan=free', highlight: false },
  { name: 'Starter', price: '$99', sub: 'per month', features: ['Everything in Free', '3 seats · 250 records / object', 'Custom branding & PDF invoices', 'Resume search & Talent Treasury'], cta: 'Start free', href: '/auth/register?plan=starter', highlight: true },
  { name: 'Professional', price: '$299', sub: 'per month', features: ['Everything in Starter', '10 seats · 2,500 records / object', 'Interviews & My Team', 'Advanced analytics & GDPR controls'], cta: 'Start free', href: '/auth/register?plan=professional', highlight: false },
  { name: 'Enterprise', price: 'Custom', sub: 'for organizations', features: ['Everything in Professional', 'Unlimited seats & records', 'HRIS export & SSO', 'Dedicated support & SLA'], cta: 'Contact sales', href: '/contact', highlight: false },
];

const FAQ = [
  { q: 'Is it really one workspace for everything?', a: 'Yes. Sales, finance, marketing, projects, and recruiting share one relational core. A company, a person, a deal, a campaign, and an invoice are all connected records, not separate apps you have to glue together.' },
  { q: 'Is it open source?', a: 'Yes, MIT licensed. Clone the repo, run it against your own Supabase and Privy, and self-host for free. Or use the hosted version and skip the setup.' },
  { q: 'Do I pay per AI token?', a: 'Never. The core is built on native Postgres: search, matching, reconciliation, and reporting run in the database. AI writing assist runs on your own API key, so there is no per-token markup from us.' },
  { q: 'Does it handle invoicing and taxes?', a: 'Create branded PDF invoices and offers, convert an accepted quote to an invoice in one click, and export KSeF FA(3) e-invoices for Poland. A bank-transaction ledger then reconciles incoming payments to the right invoice automatically.' },
  { q: 'Can I bring my existing data?', a: 'Import from CSV or a published Google Sheet in seconds, with automatic column matching. Export any list back to CSV with one click. Your data is always yours.' },
  { q: 'Is my data private and secure?', a: 'Every workspace is isolated, access runs through audited server-side functions that verify your session token, and GDPR controls are built in on higher plans. Our web analytics are first-party and cookieless.' },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-canvas text-primary antialiased">
      {/* Dogfood our own web analytics (production only). */}
      {TRACK && <Script defer src="/t.js" data-site={ANALYTICS_SITE_ID} strategy="afterInteractive" />}

      <header className="sticky top-0 z-50 border-b border-subtle bg-canvas/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/"><Logo /></Link>
          <nav className="flex items-center gap-2 md:gap-6 text-sm text-secondary">
            <Link href="#product" className="hidden md:inline hover:text-primary transition-colors">Product</Link>
            <Link href="#pricing" className="hidden md:inline hover:text-primary transition-colors">Pricing</Link>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-1.5 hover:text-primary transition-colors"><Github className="w-4 h-4" /> GitHub</a>
            <Link href="/auth/login" className="hidden md:inline hover:text-primary transition-colors">Sign in</Link>
            <ThemeToggle />
            <Link href="/auth/register" className="inline-flex items-center h-8 px-3 rounded-md bg-accent text-accent-fg text-sm font-medium hover:bg-accent/90 transition-colors">Start free</Link>
          </nav>
        </div>
      </header>

      {/* Hero: the ASCII field drifts as a living texture behind a canvas scrim.
          Restrained type — the product window is the hero visual, not the words. */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0"><AsciiField baseAlpha={0.2} peakAlpha={0.75} /></div>
        <div className="absolute inset-x-0 top-0 h-[52%] bg-gradient-to-b from-canvas via-canvas/90 to-transparent pointer-events-none" />

        <div className="relative z-10 max-w-3xl mx-auto px-6 pt-20 pb-12 text-center">
          <h1 className="text-4xl md:text-5xl font-medium tracking-tight leading-[1.1] text-primary">
            Run your whole company<br />in one clean workspace
          </h1>
          <p className="mt-5 text-base text-secondary max-w-lg mx-auto leading-relaxed">
            Sales, finance, marketing, projects, and people in one relational workspace.
            Open source, fast, no AI token bill.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <CopyCommand command={`git clone ${REPO_URL}.git`} />
            <Link href="/auth/register" className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-md bg-accent text-accent-fg text-sm font-medium hover:bg-accent/90 transition-colors">
              Start free <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <p className="mt-4 text-xs text-tertiary">Free hosted plan, or self-host it yourself. MIT licensed.</p>
        </div>

        {/* the real product window breaks out of the hero into the page */}
        <div id="product" className="relative z-10 max-w-6xl mx-auto px-6 -mb-20 md:-mb-32">
          <Reveal><ProductPreview /></Reveal>
        </div>
      </section>

      {/* Works-with strip (top padding clears the overlapping window) */}
      <section className="pt-32 md:pt-44">
        <div className="max-w-5xl mx-auto px-6 pb-10">
          <p className="text-center text-xs text-tertiary mb-8">Click the tabs above. It is the real interface, on live sample data.</p>
          <p className="text-center text-sm text-secondary mb-5">Replaces a stack of tools. Works with the ones you keep.</p>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-tertiary">
            {['Stripe', 'Google Calendar', 'Resend', 'KSeF e-invoicing', 'CSV / Sheets', 'Zapier'].map((n) => (
              <span key={n} className="hover:text-secondary transition-colors">{n}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="border-t border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <h2 className="text-2xl md:text-3xl font-medium tracking-tight text-center">One workspace for the whole company</h2>
            <p className="text-center text-secondary mt-3 mb-12 max-w-xl mx-auto">Every record is relational and connected: a deal, a candidate, a campaign, an invoice, all in one place.</p>
          </Reveal>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {PILLARS.map((p, i) => (
              <Reveal key={p.name} delay={i * 60}>
                <div className="h-full rounded-lg bg-surface border border-subtle p-4 transition-colors hover:border-strong">
                  <p.icon className="w-4 h-4 text-accent mb-3" />
                  <h3 className="text-sm font-medium text-primary">{p.name}</h3>
                  <p className="text-xs text-secondary mt-1 leading-relaxed">{p.body}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={120}>
            <div className="mt-8 flex flex-wrap justify-center gap-1.5">
              {FEATURES.map((f) => (
                <span key={f} className="px-2 py-1 rounded border border-subtle text-xs text-secondary transition-colors hover:border-strong hover:text-primary">{f}</span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Feature deep-dives */}
      <Showcase />

      {/* Everything-else bento */}
      <section className="border-t border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <h2 className="text-2xl md:text-3xl font-medium tracking-tight text-center">Everything else, already in the box</h2>
            <p className="text-center text-secondary mt-3 mb-12 max-w-xl mx-auto">The tools that usually mean five more subscriptions, built in at no extra cost.</p>
          </Reveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {CAPS.map((c, i) => (
              <Reveal key={c.name} delay={i * 50}>
                <div className="h-full rounded-lg bg-surface border border-subtle p-4 transition-colors hover:border-strong">
                  <c.icon className="w-4 h-4 text-accent mb-3" />
                  <h3 className="text-sm font-medium text-primary">{c.name}</h3>
                  <p className="text-xs text-secondary mt-1 leading-relaxed">{c.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <h2 className="text-2xl md:text-3xl font-medium tracking-tight text-center">Simple, transparent pricing</h2>
            <p className="text-center text-secondary mt-3 mb-12 max-w-xl mx-auto">Start free with no credit card, upgrade as you grow. No per-token AI bill, ever.</p>
          </Reveal>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            {PLANS.map((pl, i) => (
              <Reveal key={pl.name} delay={i * 60} className="flex">
                <div className={`rounded-lg p-5 flex flex-col w-full bg-surface border transition-colors ${pl.highlight ? 'border-accent' : 'border-subtle hover:border-strong'}`}>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-primary">{pl.name}</h3>
                    {pl.highlight && <span className="text-2xs font-medium text-accent bg-accent/10 rounded px-1.5 py-0.5">Popular</span>}
                  </div>
                  <div className="mt-3 mb-1 font-mono text-2xl text-primary">{pl.price}</div>
                  <div className="text-xs text-tertiary mb-5">{pl.sub}</div>
                  <ul className="space-y-2 mb-6 flex-grow">
                    {pl.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-xs text-secondary">
                        <Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />{f}
                      </li>
                    ))}
                  </ul>
                  <Link href={pl.href} className={`h-8 rounded-md text-sm font-medium text-center inline-flex items-center justify-center transition-colors ${pl.highlight ? 'bg-accent text-accent-fg hover:bg-accent/90' : 'bg-surface border border-subtle text-primary hover:bg-surface-hover'}`}>{pl.cta}</Link>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-subtle">
        <div className="max-w-3xl mx-auto px-6 py-20">
          <Reveal>
            <h2 className="text-2xl md:text-3xl font-medium tracking-tight text-center">Questions, answered</h2>
            <p className="text-center text-secondary mt-3 mb-10">Everything you need to know before you start.</p>
            <div className="border-t border-subtle">
              {FAQ.map((f) => (
                <details key={f.q} className="group border-b border-subtle [&_summary]:cursor-pointer">
                  <summary className="flex items-center justify-between gap-4 list-none py-4 text-sm font-medium text-primary hover:text-accent transition-colors">
                    {f.q}
                    <span className="text-tertiary text-lg leading-none transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="pb-4 -mt-1 text-sm text-secondary leading-relaxed max-w-[65ch]">{f.a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <div className="relative overflow-hidden rounded-xl border border-subtle bg-surface px-8 py-16 text-center">
              <div className="absolute inset-0 opacity-70"><AsciiField baseAlpha={0.06} peakAlpha={0.5} /></div>
              <div className="relative pointer-events-none">
                <h2 className="text-2xl md:text-3xl font-medium tracking-tight text-primary">Your company, organized.</h2>
                <p className="mt-3 text-secondary max-w-lg mx-auto">One workspace for sales, finance, marketing, projects, and people. Set it up in minutes.</p>
                <div className="pointer-events-auto mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Link href="/auth/register" className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-accent text-accent-fg text-sm font-medium hover:bg-accent/90 transition-colors">
                    Start free <ArrowRight className="w-4 h-4" />
                  </Link>
                  <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md border border-subtle text-primary text-sm font-medium hover:bg-surface-hover transition-colors">
                    <Github className="w-4 h-4" /> Star on GitHub
                  </a>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-12 grid gap-10 sm:grid-cols-3">
          <div>
            <Logo />
            <p className="mt-3 text-xs text-tertiary leading-relaxed max-w-[32ch]">
              The open company OS: sales, finance, marketing, projects, and people in one workspace.
            </p>
          </div>
          <div>
            <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-3">Product</div>
            <ul className="space-y-2 text-xs text-secondary">
              <li><Link href="#product" className="hover:text-primary transition-colors">Features</Link></li>
              <li><Link href="#pricing" className="hover:text-primary transition-colors">Pricing</Link></li>
              <li><a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">GitHub</a></li>
              <li><Link href="/auth/register" className="hover:text-primary transition-colors">Start free</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-3">Company</div>
            <ul className="space-y-2 text-xs text-secondary">
              <li><Link href="/contact" className="hover:text-primary transition-colors">Contact</Link></li>
              <li><Link href="/privacy" className="hover:text-primary transition-colors">Privacy</Link></li>
              <li><Link href="/terms" className="hover:text-primary transition-colors">Terms</Link></li>
              <li><Link href="/cookies" className="hover:text-primary transition-colors">Cookies</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-subtle">
          <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-tertiary">
            <span>© 2026 hirebtr.com</span>
            <span>Built on Postgres · MIT licensed · no AI token bill</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
