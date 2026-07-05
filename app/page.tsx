import Link from 'next/link';
import Script from 'next/script';
import { ArrowRight, Check, Target, Wallet, FolderKanban, Heart, Sparkles, Megaphone, ArrowLeftRight, FileText, Globe, Building2, CheckCheck } from 'lucide-react';

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

const FEATURES = [
  'Drag-and-drop boards', 'Spreadsheet-style tables', 'CSV / Google Sheets import',
  'One-click export', 'Bulk select & actions', 'Bank reconciliation',
  'Branded PDF invoices', 'First-party web analytics', 'Search anything',
  'Custom categories', 'Zero AI token cost',
];

// Five pillars over one relational core. Each accent is categorical (a module
// tag), not a competing brand accent — CTAs stay neutral slate throughout.
const PILLARS = [
  { icon: Target, name: 'Sales CRM', body: 'Companies, people, and a drag-and-drop deal pipeline.', tone: 'text-indigo-600 bg-indigo-50' },
  { icon: Wallet, name: 'Finance', body: 'Invoices, expenses, a bank ledger, and live revenue KPIs.', tone: 'text-emerald-600 bg-emerald-50' },
  { icon: Megaphone, name: 'Marketing', body: 'Campaigns, a social post studio, and web analytics.', tone: 'text-fuchsia-600 bg-fuchsia-50' },
  { icon: FolderKanban, name: 'Projects', body: 'Projects and issues on a clean Plane-style board.', tone: 'text-violet-600 bg-violet-50' },
  { icon: Heart, name: 'Recruiting & HR', body: 'Skills + personality hiring, onboarding, and your team.', tone: 'text-cyan-600 bg-cyan-50' },
];

// "Everything else in the box" — the newer modules that usually mean five more
// subscriptions. Rendered as a bento grid to break the deep-dive zigzag rhythm.
const CAPS = [
  { icon: Megaphone, name: 'Marketing suite', body: 'Campaigns, a pixel-faithful social post studio with client review, and first-party web analytics.', tone: 'text-fuchsia-600', bg: 'bg-fuchsia-50/70' },
  { icon: ArrowLeftRight, name: 'Bank transactions', body: 'A cash ledger that auto-matches payments to the right invoices and expenses.', tone: 'text-emerald-600', bg: 'bg-white' },
  { icon: FileText, name: 'Invoicing & e-invoicing', body: 'Branded PDF invoices and offers, plus KSeF FA(3) export for Poland.', tone: 'text-indigo-600', bg: 'bg-white' },
  { icon: Globe, name: 'Web analytics', body: 'Cookieless, first-party visitor stats — no third-party trackers, no cookie banner.', tone: 'text-sky-600', bg: 'bg-sky-50/70' },
  { icon: Building2, name: 'Company lookup', body: 'Autofill a client from its VAT / NIP — MF Biała lista and EU VIES.', tone: 'text-violet-600', bg: 'bg-white' },
  { icon: CheckCheck, name: 'Bulk everything', body: 'Select, export, and delete in bulk on every object list.', tone: 'text-amber-600', bg: 'bg-amber-50/70' },
];

const PLANS = [
  { name: 'Free', price: '$0', sub: 'for trying it out', features: ['1 workspace · 1 seat', 'Up to 25 records / object', 'Sales · Finance · Marketing · Projects · HR', 'CSV & Google Sheets import'], cta: 'Start free', href: '/auth/register?plan=free', highlight: false },
  { name: 'Starter', price: '$99', sub: 'per month', features: ['Everything in Free', '3 seats · 250 records / object', 'Custom branding & PDF invoices', 'Resume search & Talent Treasury'], cta: 'Start free', href: '/auth/register?plan=starter', highlight: true },
  { name: 'Professional', price: '$299', sub: 'per month', features: ['Everything in Starter', '10 seats · 2,500 records / object', 'Interviews & My Team', 'Advanced analytics & GDPR controls'], cta: 'Start free', href: '/auth/register?plan=professional', highlight: false },
  { name: 'Enterprise', price: 'Custom', sub: 'for organizations', features: ['Everything in Professional', 'Unlimited seats & records', 'HRIS export & SSO', 'Dedicated support & SLA'], cta: 'Contact sales', href: '/contact', highlight: false },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      {/* Dogfood our own web analytics (production only). */}
      {TRACK && <Script defer src="/t.js" data-site={ANALYTICS_SITE_ID} strategy="afterInteractive" />}

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/"><Logo /></Link>
          <nav className="hidden md:flex items-center gap-7 text-[13px] font-medium text-slate-500">
            <Link href="#product" className="hover:text-slate-900 transition">Product</Link>
            <Link href="#pricing" className="hover:text-slate-900 transition">Pricing</Link>
            <Link href="/auth/login" className="hover:text-slate-900 transition">Sign in</Link>
            <Link href="/auth/register" className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800 transition">Start free</Link>
          </nav>
          <Link href="/auth/register" className="md:hidden h-8 px-3 rounded-lg bg-slate-900 text-white text-[13px] font-semibold inline-flex items-center">Start free</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 z-0"><AsciiField baseAlpha={0.28} peakAlpha={1} /></div>
        {/* whiten only the headline area so the ASCII gradient stays clearly
            visible behind the product window below */}
        <div className="absolute inset-x-0 top-0 h-[38%] z-[1] bg-gradient-to-b from-white via-white/85 to-transparent" />

        <div className="relative z-10 max-w-3xl mx-auto px-6 pt-20 pb-10 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full bg-white ring-1 ring-slate-200 text-[11px] font-bold uppercase tracking-widest text-indigo-600 shadow-sm">
            <Sparkles className="w-3.5 h-3.5" /> The open company OS
          </div>
          <h1 className="text-5xl md:text-6xl font-black tracking-tight leading-[1.05] text-slate-900">
            Run your whole company<br />in one clean workspace
          </h1>
          <p className="mt-6 text-lg text-slate-600 max-w-xl mx-auto">
            Sales, finance, marketing, projects, and people — one relational core,
            fast and beautifully simple. No AI token bill.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/auth/register" className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-slate-900 text-white font-bold transition-all duration-200 hover:bg-slate-800 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/20">
              Start free <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/demo" className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-white ring-1 ring-slate-200 text-slate-700 font-semibold transition-all duration-200 hover:bg-slate-50 hover:-translate-y-0.5 hover:shadow-md">
              See a live demo
            </Link>
          </div>
          <p className="mt-4 text-[13px] text-slate-400 flex items-center gap-1.5 justify-center"><Check className="w-3.5 h-3.5 text-emerald-500" /> No credit card · live in minutes</p>
        </div>

        {/* interactive product window */}
        <div id="product" className="relative z-10 max-w-6xl mx-auto px-6 pt-2 pb-28">
          <Reveal>
            <ProductPreview />
            <p className="text-center text-[12px] text-slate-500 mt-5">Click the tabs — it&apos;s the real interface, on live sample data.</p>
          </Reveal>
        </div>
      </section>

      {/* Works-with strip */}
      <section className="border-t border-slate-100">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <p className="text-center text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-5">Replaces a stack of tools · works with the ones you keep</p>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm font-semibold text-slate-400">
            {['Stripe', 'Google Calendar', 'Resend', 'KSeF e-invoicing', 'CSV / Sheets', 'Zapier'].map((n) => (
              <span key={n} className="hover:text-slate-600 transition">{n}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="border-t border-slate-100 bg-slate-50/40">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <h2 className="text-3xl font-black tracking-tight text-center">One workspace for the whole company</h2>
            <p className="text-center text-slate-500 mt-2 mb-12">Every record relational and connected — a deal, a candidate, a campaign, an invoice, all in one place.</p>
          </Reveal>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {PILLARS.map((p, i) => (
              <Reveal key={p.name} delay={i * 70}>
                <div className="h-full rounded-2xl bg-white ring-1 ring-slate-200/60 p-5 transition-all duration-200 hover:ring-slate-300 hover:shadow-soft-md hover:-translate-y-1">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${p.tone}`}><p.icon className="w-5 h-5" /></div>
                  <h3 className="font-black text-slate-900">{p.name}</h3>
                  <p className="text-sm text-slate-500 mt-1 leading-relaxed">{p.body}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={120}>
            <div className="mt-10 flex flex-wrap justify-center gap-2">
              {FEATURES.map((f) => (
                <span key={f} className="px-3 py-1.5 rounded-full bg-white ring-1 ring-slate-200 text-[12px] font-medium text-slate-600 transition-colors hover:ring-slate-300 hover:text-slate-800">{f}</span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Feature deep-dives */}
      <Showcase />

      {/* Everything-else bento */}
      <section className="border-t border-slate-100 bg-slate-50/40">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <h2 className="text-3xl font-black tracking-tight text-center">Everything else, already in the box</h2>
            <p className="text-center text-slate-500 mt-2 mb-12">The tools that usually mean five more subscriptions — built in, at no extra token cost.</p>
          </Reveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CAPS.map((c, i) => (
              <Reveal key={c.name} delay={i * 70}>
                <div className={`h-full rounded-2xl ring-1 ring-slate-200/60 p-5 transition-all duration-200 hover:ring-slate-300 hover:shadow-soft-md hover:-translate-y-1 ${c.bg}`}>
                  <div className={`w-10 h-10 rounded-xl bg-white ring-1 ring-slate-200/60 flex items-center justify-center mb-4 ${c.tone}`}><c.icon className="w-5 h-5" /></div>
                  <h3 className="font-black text-slate-900">{c.name}</h3>
                  <p className="text-sm text-slate-500 mt-1 leading-relaxed">{c.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-20">
        <Reveal>
          <h2 className="text-3xl font-black tracking-tight text-center">Simple, transparent pricing</h2>
          <p className="text-center text-slate-500 mt-2 mb-12">Start free, upgrade as you grow. No per-token AI bill, ever.</p>
        </Reveal>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {PLANS.map((pl, i) => (
            <Reveal key={pl.name} delay={i * 80} className="flex">
            <div className={`rounded-2xl p-6 flex flex-col w-full bg-white transition-all duration-200 hover:-translate-y-1 ${pl.highlight ? 'ring-2 ring-indigo-600 shadow-lg hover:shadow-xl' : 'ring-1 ring-slate-200/70 hover:shadow-soft-md hover:ring-slate-300'}`}>
              {pl.highlight && <div className="self-start mb-2 text-[10px] font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 rounded-full px-2 py-0.5">Most popular</div>}
              <h3 className="font-black text-slate-900">{pl.name}</h3>
              <div className="mt-2 mb-1"><span className="text-3xl font-black">{pl.price}</span></div>
              <div className="text-[12px] text-slate-400 mb-5">{pl.sub}</div>
              <ul className="space-y-2.5 mb-6 flex-grow">
                {pl.features.map((f) => <li key={f} className="flex items-start gap-2 text-[13px] text-slate-600"><Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />{f}</li>)}
              </ul>
              <Link href={pl.href} className={`h-10 rounded-xl font-bold text-center inline-flex items-center justify-center transition ${pl.highlight ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-white ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50'}`}>{pl.cta}</Link>
            </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <Reveal>
        <h2 className="text-3xl font-black tracking-tight text-center">Questions, answered</h2>
        <p className="text-center text-slate-500 mt-2 mb-10">Everything you need to know before you start.</p>
        <div className="space-y-3">
          {[
            { q: 'Is it really one workspace for everything?', a: 'Yes. Sales, finance, marketing, projects, and recruiting share one relational core — a company, a person, a deal, a campaign, and an invoice are all connected records, not separate apps you have to glue together.' },
            { q: 'Do I pay per AI token?', a: 'Never. The core is built on native Postgres — search, matching, reconciliation, and reporting run in the database. There is no per-token AI bill, so your cost stays flat as you grow.' },
            { q: 'Does it handle invoicing and taxes?', a: 'Create branded PDF invoices and offers, convert an accepted quote to an invoice in one click, and export KSeF FA(3) e-invoices for Poland. A bank-transaction ledger then reconciles incoming payments to the right invoice automatically.' },
            { q: 'Can I bring my existing data?', a: 'Import from CSV or a published Google Sheet in seconds, with automatic column matching. Export any list back to CSV with one click — your data is always yours.' },
            { q: 'Is my data private and secure?', a: 'Every workspace is isolated, access runs through audited server-side functions, and GDPR controls (consent logging, anonymization) are built in on higher plans. Our web analytics are first-party and cookieless.' },
            { q: 'Can I start free and upgrade later?', a: 'Yes — start on the free plan with no credit card. Upgrade the moment you need more records, seats, or modules, and downgrade anytime.' },
          ].map((f) => (
            <details key={f.q} className="group rounded-xl bg-white ring-1 ring-slate-200/70 px-5 py-4 [&_summary]:cursor-pointer">
              <summary className="flex items-center justify-between gap-4 list-none font-semibold text-slate-800 text-[15px]">
                {f.q}
                <span className="text-slate-300 text-xl leading-none transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-[14px] text-slate-600 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
        </Reveal>
      </section>

      {/* ASCII wordmark — the signature motif, spelled in live glyphs */}
      <section className="max-w-6xl mx-auto px-6 pb-10">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-slate-950 ring-1 ring-slate-800 h-[220px] md:h-[300px]">
            <AsciiField text="HIREBTR" baseAlpha={0.05} peakAlpha={1} cell={11} />
            <div className="absolute inset-0 flex items-end justify-center pb-6 pointer-events-none">
              <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-white/45">hire better · run everything</p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <Reveal>
        <div className="relative overflow-hidden rounded-3xl bg-slate-900 px-8 py-16 text-center text-white">
          <div className="absolute inset-0 -z-0 opacity-60"><AsciiField colors={['129,140,248', '167,139,250', '217,70,239', '56,189,248']} baseAlpha={0.08} peakAlpha={0.7} /></div>
          <div className="relative pointer-events-none">
            <h2 className="text-4xl font-black tracking-tight">Your company, organized.</h2>
            <p className="mt-3 text-white/70 max-w-xl mx-auto">One workspace for sales, finance, marketing, projects, and people. Set it up in minutes.</p>
            <Link href="/auth/register" className="pointer-events-auto mt-7 inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-white text-slate-900 font-bold transition-all duration-200 hover:bg-slate-100 hover:-translate-y-0.5 hover:shadow-lg">
              Start free <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-[13px] text-slate-400">
          <Logo />
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="hover:text-slate-700">Privacy</Link>
            <Link href="/terms" className="hover:text-slate-700">Terms</Link>
            <Link href="/contact" className="hover:text-slate-700">Contact</Link>
          </div>
          <span>© 2026 hirebtr.com</span>
        </div>
      </footer>
    </div>
  );
}
