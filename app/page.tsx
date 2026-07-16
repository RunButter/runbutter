import Link from 'next/link';
import Script from 'next/script';
import { ArrowRight, Check, Target, Wallet, FolderKanban, Heart, Sparkles, Megaphone, FileText, Building2, Table, CheckCheck, ShieldCheck, Zap, Plug, Github } from 'lucide-react';

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

// Five pillars over one relational core. Each accent is categorical (a module
// tag), not a competing brand accent — CTAs stay neutral slate throughout.
const PILLARS = [
  { icon: Target, name: 'Sales CRM', body: 'Companies, people, and a drag-and-drop deal pipeline.', tone: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-500/10' },
  { icon: Wallet, name: 'Finance', body: 'Invoices, expenses, a bank ledger, and live revenue KPIs.', tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' },
  { icon: Megaphone, name: 'Marketing', body: 'Campaigns, a social post studio, and web analytics.', tone: 'text-fuchsia-600 bg-fuchsia-50 dark:bg-fuchsia-500/10' },
  { icon: FolderKanban, name: 'Projects', body: 'Projects and issues on a clean Plane-style board.', tone: 'text-violet-600 bg-violet-50 dark:bg-violet-500/10' },
  { icon: Heart, name: 'Recruiting & HR', body: 'Skills + personality hiring, onboarding, and your team.', tone: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-500/10' },
];

// "Everything else in the box" — the cross-cutting modules and utilities that
// the deep-dives don't cover. Bento with one locked accent (indigo) and quiet
// tinted cells for rhythm; the 5 pillar cards above stay the only place with
// categorical module colors.
const CAPS = [
  { icon: Zap, name: 'Automations', body: 'When something happens, do something: fire webhooks, send emails, create records. Templates included.', bg: 'bg-indigo-50/60 dark:bg-indigo-500/[0.07]' },
  { icon: Plug, name: 'Open integrations', body: 'REST API, signed webhooks, Zapier and Make, plus MCP so AI agents can work inside your workspace.', bg: 'bg-white dark:bg-slate-900' },
  { icon: Sparkles, name: 'AI docs with your key', body: 'Draft and edit documents with Claude, GPT, or Gemini using your own API key. No token markup.', bg: 'bg-slate-50 dark:bg-slate-800/40' },
  { icon: FolderKanban, name: 'Projects & roadmap', body: 'A Plane-style issue board plus a Gantt-lite roadmap across every project.', bg: 'bg-white dark:bg-slate-900' },
  { icon: FileText, name: 'e-Invoicing (KSeF)', body: 'Export compliant FA(3) e-invoices for Poland, straight from your documents.', bg: 'bg-indigo-50/60 dark:bg-indigo-500/[0.07]' },
  { icon: Building2, name: 'Company lookup', body: 'Autofill a client from its VAT or NIP number, via MF Biała lista and EU VIES.', bg: 'bg-white dark:bg-slate-900' },
  { icon: Table, name: 'Import & export', body: 'Bring data in from CSV or a Google Sheet; export any list back with one click.', bg: 'bg-slate-50 dark:bg-slate-800/40' },
  { icon: CheckCheck, name: 'Bulk actions', body: 'Select, categorize, export, and delete in bulk on every object list.', bg: 'bg-white dark:bg-slate-900' },
  { icon: ShieldCheck, name: 'GDPR & privacy', body: 'Consent logging, data anonymization, and cookieless first-party analytics.', bg: 'bg-indigo-50/60 dark:bg-indigo-500/[0.07]' },
];

const PLANS = [
  { name: 'Free', price: '$0', sub: 'for trying it out', features: ['1 workspace · 1 seat', 'Up to 25 records / object', 'Sales · Finance · Marketing · Projects · HR', 'CSV & Google Sheets import'], cta: 'Start free', href: '/auth/register?plan=free', highlight: false },
  { name: 'Starter', price: '$99', sub: 'per month', features: ['Everything in Free', '3 seats · 250 records / object', 'Custom branding & PDF invoices', 'Resume search & Talent Treasury'], cta: 'Start free', href: '/auth/register?plan=starter', highlight: true },
  { name: 'Professional', price: '$299', sub: 'per month', features: ['Everything in Starter', '10 seats · 2,500 records / object', 'Interviews & My Team', 'Advanced analytics & GDPR controls'], cta: 'Start free', href: '/auth/register?plan=professional', highlight: false },
  { name: 'Enterprise', price: 'Custom', sub: 'for organizations', features: ['Everything in Professional', 'Unlimited seats & records', 'HRIS export & SSO', 'Dedicated support & SLA'], cta: 'Contact sales', href: '/contact', highlight: false },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
      {/* Dogfood our own web analytics (production only). */}
      {TRACK && <Script defer src="/t.js" data-site={ANALYTICS_SITE_ID} strategy="afterInteractive" />}

      {/* Header: light, clean brand bar */}
      <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/80">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/"><Logo /></Link>
          <nav className="flex items-center gap-2 md:gap-6 text-[13px] font-medium text-slate-500 dark:text-slate-400">
            <Link href="#product" className="hidden md:inline hover:text-slate-900 dark:hover:text-white transition">Product</Link>
            <Link href="#pricing" className="hidden md:inline hover:text-slate-900 dark:hover:text-white transition">Pricing</Link>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-white transition"><Github className="w-4 h-4" /> GitHub</a>
            <Link href="/auth/login" className="hidden md:inline hover:text-slate-900 dark:hover:text-white transition">Sign in</Link>
            <ThemeToggle />
            <Link href="/auth/register" className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800 transition dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">Start free</Link>
          </nav>
        </div>
      </header>

      {/* Hero: the interactive ASCII field drifts as a soft living texture,
          lifted by a faint indigo aura. Copy sits on a theme scrim so it stays
          crisp; the product window breaks into the page. */}
      <section className="relative overflow-hidden bg-white dark:bg-slate-950">
        <div className="absolute inset-0 bg-[radial-gradient(70%_55%_at_50%_-5%,rgba(99,102,241,0.10),transparent_70%)] dark:bg-[radial-gradient(70%_55%_at_50%_-5%,rgba(99,102,241,0.22),transparent_70%)] pointer-events-none" />
        <div className="absolute inset-0"><AsciiField baseAlpha={0.24} peakAlpha={0.85} /></div>
        {/* theme veil behind the headline; the field stays visible lower + at the edges */}
        <div className="absolute inset-x-0 top-0 h-[46%] bg-gradient-to-b from-white via-white/85 to-transparent dark:from-slate-950 dark:via-slate-950/85 pointer-events-none" />

        <div className="relative z-10 max-w-3xl mx-auto px-6 pt-20 pb-10 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full bg-white ring-1 ring-slate-200 text-[11px] font-bold uppercase tracking-widest text-indigo-600 shadow-sm dark:bg-slate-900 dark:ring-slate-800 dark:text-indigo-400">
            <Sparkles className="w-3.5 h-3.5" /> The open company OS
          </div>
          <h1 className="text-5xl md:text-6xl font-black tracking-tight leading-[1.05] text-slate-900 dark:text-white">
            Run your whole company<br />in one clean workspace
          </h1>
          <p className="mt-6 text-lg text-slate-600 max-w-xl mx-auto dark:text-slate-300">
            Sales, finance, marketing, projects, and people in one relational
            workspace. Open source, fast, and no AI token bill.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/auth/register" className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-slate-900 text-white font-bold transition-all duration-200 hover:bg-slate-800 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/20 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">
              Start free <ArrowRight className="w-4 h-4" />
            </Link>
            <CopyCommand command={`git clone ${REPO_URL}.git`} />
          </div>
          <p className="mt-4 text-[12px] text-slate-400 dark:text-slate-500">Free hosted plan, or self-host it yourself. MIT licensed.</p>
        </div>

        {/* the real product window breaks out of the hero into the page */}
        <div id="product" className="relative z-10 max-w-6xl mx-auto px-6 -mb-24 md:-mb-36">
          <Reveal><ProductPreview /></Reveal>
        </div>
      </section>

      {/* Works-with strip (top padding clears the overlapping window) */}
      <section className="bg-white dark:bg-slate-950 pt-36 md:pt-52">
        <div className="max-w-5xl mx-auto px-6 pb-8">
          <p className="text-center text-[12px] text-slate-400 dark:text-slate-500 mb-10">Click the tabs above. It is the real interface, on live sample data.</p>
          <p className="text-center text-[13px] text-slate-500 dark:text-slate-400 mb-5">Replaces a stack of tools. Works with the ones you keep.</p>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm font-semibold text-slate-400 dark:text-slate-500">
            {['Stripe', 'Google Calendar', 'Resend', 'KSeF e-invoicing', 'CSV / Sheets', 'Zapier'].map((n) => (
              <span key={n} className="hover:text-slate-600 dark:hover:text-slate-300 transition">{n}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="border-t border-slate-100 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <h2 className="text-3xl font-black tracking-tight text-center dark:text-white">One workspace for the whole company</h2>
            <p className="text-center text-slate-500 dark:text-slate-400 mt-2 mb-12">Every record is relational and connected: a deal, a candidate, a campaign, an invoice, all in one place.</p>
          </Reveal>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {PILLARS.map((p, i) => (
              <Reveal key={p.name} delay={i * 70}>
                <div className="h-full rounded-2xl bg-white ring-1 ring-slate-200/60 p-5 transition-all duration-200 hover:ring-slate-300 hover:shadow-soft-md hover:-translate-y-1 dark:bg-slate-900 dark:ring-slate-800 dark:hover:ring-slate-700">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${p.tone}`}><p.icon className="w-5 h-5" /></div>
                  <h3 className="font-black text-slate-900 dark:text-white">{p.name}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{p.body}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={120}>
            <div className="mt-10 flex flex-wrap justify-center gap-2">
              {FEATURES.map((f) => (
                <span key={f} className="px-3 py-1.5 rounded-full bg-white ring-1 ring-slate-200 text-[12px] font-medium text-slate-600 transition-colors hover:ring-slate-300 hover:text-slate-800 dark:bg-slate-900 dark:ring-slate-800 dark:text-slate-300 dark:hover:ring-slate-700 dark:hover:text-white">{f}</span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Feature deep-dives */}
      <Showcase />

      {/* Everything-else bento */}
      <section className="border-t border-slate-100 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <h2 className="text-3xl font-black tracking-tight text-center dark:text-white">Everything else, already in the box</h2>
            <p className="text-center text-slate-500 dark:text-slate-400 mt-2 mb-12">The tools that usually mean five more subscriptions, built in at no extra cost.</p>
          </Reveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CAPS.map((c, i) => (
              <Reveal key={c.name} delay={i * 70}>
                <div className={`h-full rounded-2xl ring-1 ring-slate-200/60 p-5 transition-all duration-200 hover:ring-slate-300 hover:shadow-soft-md hover:-translate-y-1 dark:ring-slate-800 dark:hover:ring-slate-700 ${c.bg}`}>
                  <div className="w-10 h-10 rounded-xl bg-white ring-1 ring-slate-200/60 flex items-center justify-center mb-4 text-primary-600 dark:bg-slate-800 dark:ring-slate-700 dark:text-indigo-400"><c.icon className="w-5 h-5" /></div>
                  <h3 className="font-black text-slate-900 dark:text-white">{c.name}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{c.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-20">
        <Reveal>
          <h2 className="text-3xl font-black tracking-tight text-center dark:text-white">Simple, transparent pricing</h2>
          <p className="text-center text-slate-500 dark:text-slate-400 mt-2 mb-12">Start free with no credit card, upgrade as you grow. No per-token AI bill, ever.</p>
        </Reveal>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {PLANS.map((pl, i) => (
            <Reveal key={pl.name} delay={i * 80} className="flex">
            <div className={`rounded-2xl p-6 flex flex-col w-full bg-white transition-all duration-200 hover:-translate-y-1 dark:bg-slate-900 ${pl.highlight ? 'ring-2 ring-indigo-600 shadow-lg hover:shadow-xl dark:ring-indigo-500' : 'ring-1 ring-slate-200/70 hover:shadow-soft-md hover:ring-slate-300 dark:ring-slate-800 dark:hover:ring-slate-700'}`}>
              {pl.highlight && <div className="self-start mb-2 text-[10px] font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 rounded-full px-2 py-0.5 dark:text-indigo-400 dark:bg-indigo-500/10">Most popular</div>}
              <h3 className="font-black text-slate-900 dark:text-white">{pl.name}</h3>
              <div className="mt-2 mb-1"><span className="text-3xl font-black dark:text-white">{pl.price}</span></div>
              <div className="text-[12px] text-slate-400 dark:text-slate-500 mb-5">{pl.sub}</div>
              <ul className="space-y-2.5 mb-6 flex-grow">
                {pl.features.map((f) => <li key={f} className="flex items-start gap-2 text-[13px] text-slate-600 dark:text-slate-300"><Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />{f}</li>)}
              </ul>
              <Link href={pl.href} className={`h-10 rounded-xl font-bold text-center inline-flex items-center justify-center transition ${pl.highlight ? 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200' : 'bg-white ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:ring-slate-700 dark:text-slate-200 dark:hover:bg-slate-700'}`}>{pl.cta}</Link>
            </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <Reveal>
        <h2 className="text-3xl font-black tracking-tight text-center dark:text-white">Questions, answered</h2>
        <p className="text-center text-slate-500 dark:text-slate-400 mt-2 mb-10">Everything you need to know before you start.</p>
        <div className="space-y-3">
          {[
            { q: 'Is it really one workspace for everything?', a: 'Yes. Sales, finance, marketing, projects, and recruiting share one relational core. A company, a person, a deal, a campaign, and an invoice are all connected records, not separate apps you have to glue together.' },
            { q: 'Is it open source?', a: 'Yes, MIT licensed. Clone the repo, run it against your own Supabase and Privy, and self-host for free. Or use the hosted version at hirebtr.com and skip the setup.' },
            { q: 'Do I pay per AI token?', a: 'Never. The core is built on native Postgres: search, matching, reconciliation, and reporting run in the database. AI writing assist runs on your own API key, so there is no per-token markup from us.' },
            { q: 'Does it handle invoicing and taxes?', a: 'Create branded PDF invoices and offers, convert an accepted quote to an invoice in one click, and export KSeF FA(3) e-invoices for Poland. A bank-transaction ledger then reconciles incoming payments to the right invoice automatically.' },
            { q: 'Can I bring my existing data?', a: 'Import from CSV or a published Google Sheet in seconds, with automatic column matching. Export any list back to CSV with one click. Your data is always yours.' },
            { q: 'Is my data private and secure?', a: 'Every workspace is isolated, access runs through audited server-side functions that verify your session token, and GDPR controls (consent logging, anonymization) are built in on higher plans. Our web analytics are first-party and cookieless.' },
          ].map((f) => (
            <details key={f.q} className="group rounded-xl bg-white ring-1 ring-slate-200/70 px-5 py-4 [&_summary]:cursor-pointer dark:bg-slate-900 dark:ring-slate-800">
              <summary className="flex items-center justify-between gap-4 list-none font-semibold text-slate-800 text-[15px] dark:text-slate-100">
                {f.q}
                <span className="text-slate-300 text-xl leading-none transition-transform group-open:rotate-45 dark:text-slate-600">+</span>
              </summary>
              <p className="mt-3 text-[14px] text-slate-600 leading-relaxed dark:text-slate-400">{f.a}</p>
            </details>
          ))}
        </div>
        </Reveal>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <Reveal>
        <div className="relative overflow-hidden rounded-3xl bg-slate-900 px-8 py-16 text-center text-white dark:ring-1 dark:ring-slate-800">
          <div className="absolute inset-0 -z-0 opacity-60"><AsciiField colors={['129,140,248', '167,139,250', '217,70,239', '56,189,248']} baseAlpha={0.08} peakAlpha={0.7} /></div>
          <div className="relative pointer-events-none">
            <h2 className="text-4xl font-black tracking-tight">Your company, organized.</h2>
            <p className="mt-3 text-white/70 max-w-xl mx-auto">One workspace for sales, finance, marketing, projects, and people. Set it up in minutes.</p>
            <div className="pointer-events-auto mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/auth/register" className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-white text-slate-900 font-bold transition-all duration-200 hover:bg-slate-100 hover:-translate-y-0.5 hover:shadow-lg">
                Start free <ArrowRight className="w-4 h-4" />
              </Link>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 h-11 px-6 rounded-xl ring-1 ring-white/25 text-white font-bold transition hover:bg-white/10">
                <Github className="w-4 h-4" /> Star on GitHub
              </a>
            </div>
          </div>
        </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-6 py-12 grid gap-10 sm:grid-cols-3">
          <div>
            <Logo />
            <p className="mt-3 text-[13px] text-slate-400 dark:text-slate-500 leading-relaxed max-w-[30ch]">
              The open company OS: sales, finance, marketing, projects, and people in one workspace.
            </p>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">Product</div>
            <ul className="space-y-2 text-[13px] text-slate-500 dark:text-slate-400">
              <li><Link href="#product" className="hover:text-slate-800 dark:hover:text-white transition">Features</Link></li>
              <li><Link href="#pricing" className="hover:text-slate-800 dark:hover:text-white transition">Pricing</Link></li>
              <li><a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hover:text-slate-800 dark:hover:text-white transition">GitHub</a></li>
              <li><Link href="/auth/register" className="hover:text-slate-800 dark:hover:text-white transition">Start free</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">Company</div>
            <ul className="space-y-2 text-[13px] text-slate-500 dark:text-slate-400">
              <li><Link href="/contact" className="hover:text-slate-800 dark:hover:text-white transition">Contact</Link></li>
              <li><Link href="/privacy" className="hover:text-slate-800 dark:hover:text-white transition">Privacy</Link></li>
              <li><Link href="/terms" className="hover:text-slate-800 dark:hover:text-white transition">Terms</Link></li>
              <li><Link href="/cookies" className="hover:text-slate-800 dark:hover:text-white transition">Cookies</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-100 dark:border-slate-800">
          <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-[12px] text-slate-400 dark:text-slate-500">
            <span>© 2026 hirebtr.com</span>
            <span>Built on Postgres · MIT licensed · no AI token bill</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
