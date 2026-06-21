import Link from 'next/link';
import { ArrowRight, Check, Target, Wallet, FolderKanban, Heart, Sparkles } from 'lucide-react';
import Logo from '@/components/Logo';
import AsciiField from '@/components/landing/AsciiField';
import ProductPreview from '@/components/landing/ProductPreview';

const FEATURES = [
  'Drag-and-drop boards', 'Spreadsheet-style tables', 'Create, edit & delete',
  'CSV / Google Sheets import', 'One-click export', 'Search anything',
  'Custom categories', 'Products & invoices', 'Multi-pipeline records', 'Zero AI token cost',
];

const PILLARS = [
  { icon: Target, name: 'Sales CRM', body: 'Companies, people, and a drag-and-drop deal pipeline.', tone: 'text-indigo-600 bg-indigo-50' },
  { icon: Wallet, name: 'Finance', body: 'Invoices, expenses, products, and live revenue KPIs.', tone: 'text-emerald-600 bg-emerald-50' },
  { icon: FolderKanban, name: 'Projects', body: 'Projects and issues on a clean Plane-style board.', tone: 'text-violet-600 bg-violet-50' },
  { icon: Heart, name: 'Recruiting & HR', body: 'Skills + personality hiring, onboarding, and your team.', tone: 'text-fuchsia-600 bg-fuchsia-50' },
];

const PLANS = [
  { name: 'Free', price: '$0', sub: 'for trying it out', features: ['1 workspace', 'Up to 25 records / object', 'Sales, Projects & HR core'], cta: 'Start free', href: '/auth/register?plan=free', highlight: false },
  { name: 'Starter', price: '$99', sub: 'per month', features: ['Everything in Free', 'Up to 250 candidates', 'Talent Treasury & resume search', 'Custom branding'], cta: 'Get started', href: '/auth/register?plan=starter', highlight: true },
  { name: 'Professional', price: '$299', sub: 'per month', features: ['Up to 2,500 candidates', 'Interviews & My Team', 'Advanced analytics & GDPR', 'Data import & export'], cta: 'Get started', href: '/auth/register?plan=professional', highlight: false },
  { name: 'Enterprise', price: 'Custom', sub: 'for organizations', features: ['Unlimited everything', 'HRIS export & SSO', 'Dedicated support & SLA'], cta: 'Contact sales', href: '/contact', highlight: false },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/"><Logo /></Link>
          <nav className="hidden md:flex items-center gap-7 text-[13px] font-medium text-slate-500">
            <Link href="#product" className="hover:text-slate-900 transition">Product</Link>
            <Link href="#pricing" className="hover:text-slate-900 transition">Pricing</Link>
            <Link href="/auth/login" className="hover:text-slate-900 transition">Sign in</Link>
            <Link href="/auth/register" className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800 transition">Get started</Link>
          </nav>
          <Link href="/auth/register" className="md:hidden h-8 px-3 rounded-lg bg-slate-900 text-white text-[13px] font-semibold inline-flex items-center">Get started</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10"><AsciiField baseAlpha={0.22} peakAlpha={1} /></div>
        {/* whiten only the headline area so the ASCII gradient stays clearly
            visible behind the product window below */}
        <div className="absolute inset-x-0 top-0 h-[38%] -z-10 bg-gradient-to-b from-white via-white/85 to-transparent" />

        <div className="max-w-3xl mx-auto px-6 pt-20 pb-10 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full bg-white ring-1 ring-slate-200 text-[11px] font-bold uppercase tracking-widest text-indigo-600 shadow-sm">
            <Sparkles className="w-3.5 h-3.5" /> The open company OS
          </div>
          <h1 className="text-5xl md:text-6xl font-black tracking-tight leading-[1.05] text-slate-900">
            Run your whole company<br />in one clean workspace
          </h1>
          <p className="mt-6 text-lg text-slate-600 max-w-xl mx-auto">
            Sales, finance, projects, and recruiting — relational, fast, and beautifully simple.
            One source of truth for every team. No AI token bill.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/auth/register" className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition">
              Start free <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/home" className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-white ring-1 ring-slate-200 text-slate-700 font-semibold hover:bg-slate-50 transition">
              See the workspace
            </Link>
          </div>
          <p className="mt-4 text-[13px] text-slate-400 flex items-center gap-1.5 justify-center"><Check className="w-3.5 h-3.5 text-emerald-500" /> No credit card · live in minutes</p>
        </div>

        {/* interactive product window */}
        <div id="product" className="max-w-6xl mx-auto px-6 pt-2 pb-28">
          <ProductPreview />
          <p className="text-center text-[12px] text-slate-500 mt-5">Click the tabs — Sales, Finance, Projects — it&apos;s the real interface.</p>
        </div>
      </section>

      {/* Pillars */}
      <section className="border-t border-slate-100 bg-slate-50/40">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="text-3xl font-black tracking-tight text-center">One workspace for the whole company</h2>
          <p className="text-center text-slate-500 mt-2 mb-12">Every record relational and connected — a deal, a candidate, an invoice, all in one place.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PILLARS.map((p) => (
              <div key={p.name} className="rounded-2xl bg-white ring-1 ring-slate-200/60 p-5 hover:shadow-sm hover:ring-slate-300 transition">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${p.tone}`}><p.icon className="w-5 h-5" /></div>
                <h3 className="font-black text-slate-900">{p.name}</h3>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap justify-center gap-2">
            {FEATURES.map((f) => (
              <span key={f} className="px-3 py-1.5 rounded-full bg-white ring-1 ring-slate-200 text-[12px] font-medium text-slate-600">{f}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-black tracking-tight text-center">Simple, transparent pricing</h2>
        <p className="text-center text-slate-500 mt-2 mb-12">Start free, upgrade as you grow.</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {PLANS.map((pl) => (
            <div key={pl.name} className={`rounded-2xl p-6 flex flex-col bg-white ${pl.highlight ? 'ring-2 ring-indigo-600 shadow-lg' : 'ring-1 ring-slate-200/70'}`}>
              {pl.highlight && <div className="self-start mb-2 text-[10px] font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 rounded-full px-2 py-0.5">Most popular</div>}
              <h3 className="font-black text-slate-900">{pl.name}</h3>
              <div className="mt-2 mb-1"><span className="text-3xl font-black">{pl.price}</span></div>
              <div className="text-[12px] text-slate-400 mb-5">{pl.sub}</div>
              <ul className="space-y-2.5 mb-6 flex-grow">
                {pl.features.map((f) => <li key={f} className="flex items-start gap-2 text-[13px] text-slate-600"><Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />{f}</li>)}
              </ul>
              <Link href={pl.href} className={`h-10 rounded-xl font-bold text-center inline-flex items-center justify-center transition ${pl.highlight ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-white ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50'}`}>{pl.cta}</Link>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="relative overflow-hidden rounded-3xl bg-slate-900 px-8 py-16 text-center text-white">
          <div className="absolute inset-0 -z-0 opacity-40"><AsciiField color="129,140,248" /></div>
          <div className="relative">
            <h2 className="text-4xl font-black tracking-tight">Your company, organized.</h2>
            <p className="mt-3 text-white/70 max-w-xl mx-auto">One workspace for sales, finance, projects, and people. Set it up in minutes.</p>
            <Link href="/auth/register" className="mt-7 inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-white text-slate-900 font-bold hover:bg-slate-100 transition">
              Start free <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
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
