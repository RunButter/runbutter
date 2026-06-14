import Link from 'next/link';
import {
  CheckCircle, BarChart3, Search, Sparkles, Radio, Heart, LayoutDashboard,
  ArrowRight, Zap, Clock, Database, Brain, Target, Users, Star, ShieldCheck
} from 'lucide-react';
import Logo from '@/components/Logo';

const dottedGrid = {
  backgroundImage: 'radial-gradient(circle, rgba(79,70,229,0.10) 1px, transparent 1px)',
  backgroundSize: '22px 22px',
  WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 30%, black, transparent 75%)',
  maskImage: 'radial-gradient(ellipse 70% 60% at 50% 30%, black, transparent 75%)',
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex justify-between items-center">
          <Link href="/"><Logo /></Link>
          <nav className="hidden md:flex items-center gap-8">
            <Link href="#features" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition">Features</Link>
            <Link href="#how" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition">How it works</Link>
            <Link href="#pricing" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition">Pricing</Link>
            <Link href="/auth/login" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition">Sign in</Link>
            <Link href="/auth/register" className="btn-primary">Get started</Link>
          </nav>
          <Link href="/auth/register" className="btn-primary md:hidden text-sm">Get started</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={dottedGrid} />
        <div className="max-w-7xl mx-auto px-6 pt-16 pb-20 lg:pt-24 lg:pb-28 grid lg:grid-cols-2 gap-16 items-center">
          {/* Copy */}
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 bg-primary-50 border border-primary-100 rounded-full text-primary-700 text-xs font-bold uppercase tracking-widest">
              <Sparkles className="w-3.5 h-3.5" /> Skills + personality ATS
            </div>
            <h1 className="text-5xl md:text-6xl font-black tracking-tight leading-[1.05] mb-6">
              Hire better by{' '}
              <span className="bg-gradient-to-r from-primary-600 to-purple-600 bg-clip-text text-transparent">
                skills and personality
              </span>
            </h1>
            <p className="text-lg text-gray-600 leading-relaxed mb-8 max-w-xl mx-auto lg:mx-0">
              HireBTR fuses hard-skill resume search with a frictionless psychometric
              assessment — so you find the right human fast, without reading hundreds of
              identical CVs. Built on native Postgres, so it scales without the AI token bill.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <Link href="/auth/register" className="btn-primary px-7 py-3 text-base">
                Start free trial <ArrowRight className="w-4 h-4" />
              </Link>
              <Link href="/demo" className="btn-secondary px-7 py-3 text-base">
                View interactive demo
              </Link>
            </div>
            <p className="text-sm text-gray-500 mt-4 flex items-center gap-2 justify-center lg:justify-start">
              <CheckCircle className="w-4 h-4 text-green-500" /> No credit card required · 14-day free trial
            </p>
          </div>

          {/* Product mockup */}
          <div className="relative">
            <div className="absolute -inset-4 bg-gradient-to-tr from-primary-100/40 to-purple-100/40 rounded-[2rem] blur-2xl -z-10" />
            <div className="rounded-2xl border border-gray-200 bg-white shadow-soft-lg overflow-hidden">
              {/* window chrome */}
              <div className="flex items-center gap-1.5 px-4 py-3 border-b border-gray-100 bg-gray-50/60">
                <span className="w-2.5 h-2.5 rounded-full bg-gray-200" />
                <span className="w-2.5 h-2.5 rounded-full bg-gray-200" />
                <span className="w-2.5 h-2.5 rounded-full bg-gray-200" />
                <span className="ml-3 text-[11px] font-semibold text-gray-400">Candidate report · Senior Engineer</span>
              </div>
              <div className="p-5">
                {/* candidate header */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-purple-600 text-white font-black flex items-center justify-center text-sm">AK</div>
                    <div>
                      <div className="font-bold text-sm text-gray-900">Anna Kowalski</div>
                      <div className="text-[11px] text-gray-400 font-medium">React · Node · PostgreSQL</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-green-600 leading-none">92%</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Match</div>
                  </div>
                </div>

                {/* radar + scores */}
                <div className="grid grid-cols-5 gap-4 items-center">
                  <div className="col-span-3">
                    <svg viewBox="0 0 200 185" className="w-full">
                      <polygon points="100,20 176.1,75.3 147,164.7 53,164.7 23.9,75.3" fill="none" stroke="#e5e7eb" strokeWidth="1" />
                      <polygon points="100,60 138,87.6 123.5,132.4 76.5,132.4 62,87.6" fill="none" stroke="#eef2ff" strokeWidth="1" />
                      <line x1="100" y1="100" x2="100" y2="20" stroke="#f1f5f9" />
                      <line x1="100" y1="100" x2="176.1" y2="75.3" stroke="#f1f5f9" />
                      <line x1="100" y1="100" x2="147" y2="164.7" stroke="#f1f5f9" />
                      <line x1="100" y1="100" x2="53" y2="164.7" stroke="#f1f5f9" />
                      <line x1="100" y1="100" x2="23.9" y2="75.3" stroke="#f1f5f9" />
                      <polygon points="100,32 155.2,82.1 130.6,142.1 62.4,151.8 56.3,85.8" fill="rgba(79,70,229,0.18)" stroke="#4f46e5" strokeWidth="2" />
                      <circle cx="100" cy="32" r="3" fill="#4f46e5" />
                      <circle cx="155.2" cy="82.1" r="3" fill="#4f46e5" />
                      <circle cx="130.6" cy="142.1" r="3" fill="#4f46e5" />
                      <circle cx="62.4" cy="151.8" r="3" fill="#4f46e5" />
                      <circle cx="56.3" cy="85.8" r="3" fill="#4f46e5" />
                    </svg>
                  </div>
                  <div className="col-span-2 space-y-2">
                    {[
                      { label: 'Cognitive', value: 94 },
                      { label: 'Personality', value: 88 },
                      { label: 'Work style', value: 90 },
                    ].map((s) => (
                      <div key={s.label}>
                        <div className="flex justify-between text-[10px] font-bold text-gray-500 mb-1">
                          <span>{s.label}</span><span className="text-primary-600">{s.value}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-primary-500 rounded-full" style={{ width: `${s.value}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* mini pipeline */}
                <div className="mt-5 pt-4 border-t border-gray-100 flex items-center gap-2">
                  {['Applied', 'Screening', 'Interview', 'Offer'].map((st, i) => (
                    <div key={st} className={`flex-1 text-center text-[9px] font-bold uppercase tracking-wider py-1.5 rounded-lg ${i === 2 ? 'bg-primary-600 text-white' : 'bg-gray-50 text-gray-400'}`}>
                      {st}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-y border-gray-100 bg-gray-50/50">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-gray-400 mb-6">
            Trusted by modern hiring teams
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4 opacity-60">
            {['Northwind', 'Acme Co', 'Lumen', 'Pulse', 'Vertex', 'Cobalt'].map((name) => (
              <span key={name} className="text-lg font-black tracking-tight text-gray-400">{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Stats band */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { icon: Zap, value: 'Milliseconds', label: 'Resume search across 10k+ CVs' },
            { icon: Clock, value: '5 minutes', label: 'Gamified candidate assessment' },
            { icon: Database, value: '$0', label: 'AI token cost — native Postgres' },
            { icon: Brain, value: 'Big-5', label: 'Personality, work style & cognitive' },
          ].map((s) => (
            <div key={s.label} className="text-center lg:text-left">
              <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center mb-3 mx-auto lg:mx-0">
                <s.icon className="w-5 h-5" />
              </div>
              <div className="text-2xl font-black text-gray-900">{s.value}</div>
              <div className="text-sm text-gray-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features — bento */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-20">
        <div className="max-w-2xl mb-12">
          <h2 className="text-4xl font-black tracking-tight mb-3">Everything you need to hire better</h2>
          <p className="text-gray-600 text-lg">
            From first click to onboarded teammate — match on real skills and psychological fit at every step.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {/* Big tile */}
          <div className="md:col-span-2 md:row-span-2 card hover:shadow-soft-lg transition group flex flex-col">
            <div className="w-12 h-12 bg-primary-600 rounded-xl flex items-center justify-center mb-4 group-hover:scale-105 transition">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-2xl font-black mb-2">Talent Treasury</h3>
            <p className="text-gray-600 max-w-lg">
              An e-commerce-style faceted explorer for your talent pool. Drag psychometric
              sliders, filter by source and role, and watch the shortlist update instantly.
            </p>
            {/* mini facet visual */}
            <div className="mt-6 grid sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4 space-y-3">
                {['Conscientiousness', 'Openness', 'Extraversion'].map((t, i) => (
                  <div key={t}>
                    <div className="text-[10px] font-bold text-gray-500 mb-1">{t}</div>
                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full" style={{ width: `${[78, 64, 52][i]}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-gray-100 bg-white p-4 flex flex-col justify-center gap-2">
                {[{ n: 'Anna K.', m: 92 }, { n: 'David R.', m: 87 }, { n: 'Sara L.', m: 81 }].map((c) => (
                  <div key={c.n} className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-700">{c.n}</span>
                    <span className="font-black text-green-600">{c.m}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right column tiles */}
          <FeatureTile icon={Search} title="Zero-cost resume search">
            Boolean keyword search (<code className="text-xs bg-gray-100 px-1 rounded">React AND Node NOT Junior</code>) across
            tens of thousands of CVs in milliseconds — native Postgres, not pricey AI APIs.
          </FeatureTile>
          <FeatureTile icon={BarChart3} title="Psychometric match scoring">
            Big-5 personality, work style, and cognitive tests mapped to each role&apos;s ideal
            profile — visualised as radar charts with a live match score.
          </FeatureTile>

          {/* Bottom row */}
          <FeatureTile icon={LayoutDashboard} title="Visual pipeline">
            Drag-and-drop candidates through your stages, with automatic status emails so
            applicants always know where they stand.
          </FeatureTile>
          <FeatureTile icon={Radio} title="Source tracking">
            A tracking link per job board captures UTM &amp; referrer data automatically — see
            exactly which channels deliver your best hires.
          </FeatureTile>
          <FeatureTile icon={Heart} title="My Team &amp; onboarding">
            New hires flow into a post-hire workspace with auto-generated manager briefs,
            culture maps, and weekly pulse check-ins.
          </FeatureTile>
        </div>

        <p className="text-center text-sm text-gray-500 mt-8 flex items-center justify-center gap-2 flex-wrap">
          <ShieldCheck className="w-4 h-4 text-primary-600" /> Plus GDPR / RODO compliance, Google Calendar scheduling, and a branded candidate portal.
        </p>
      </section>

      {/* How it works */}
      <section id="how" className="bg-gray-50/60 border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-4xl font-black tracking-tight mb-3">From applicant to hire in three steps</h2>
            <p className="text-gray-600 text-lg">No spreadsheets, no guesswork, no token bills.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: Search, step: '01', title: 'Search & source', body: 'Post a role, generate tracking links, and let candidates apply with a CV. Resume text is indexed instantly for keyword search.' },
              { icon: Target, step: '02', title: 'Assess & match', body: 'Each applicant takes a 5-minute psychometric assessment, scored against the role’s ideal profile — no manual screening.' },
              { icon: Users, step: '03', title: 'Decide & hire', body: 'Compare candidates on a clean dashboard, schedule interviews in a click, and onboard your new teammate.' },
            ].map((s, i) => (
              <div key={s.step} className="relative">
                {i < 2 && <div className="hidden md:block absolute top-6 left-[calc(50%+2rem)] right-0 h-px bg-gray-200" />}
                <div className="relative flex flex-col items-center text-center md:items-start md:text-left">
                  <div className="w-12 h-12 rounded-xl bg-white border border-gray-200 shadow-soft flex items-center justify-center text-primary-600 mb-4">
                    <s.icon className="w-5 h-5" />
                  </div>
                  <div className="text-xs font-black text-primary-600 tracking-widest mb-1">{s.step}</div>
                  <h3 className="text-lg font-black mb-2">{s.title}</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-7xl mx-auto px-6 py-20">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-4xl font-black tracking-tight mb-3">Simple, transparent pricing</h2>
          <p className="text-gray-600 text-lg">Start free, upgrade as you grow.</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <PricingCard name="Free" price="$0" cta="Start free" href="/auth/register?plan=free"
            features={['Up to 25 candidates', '1 active position', 'Pipeline, assessments & status emails']} />
          <PricingCard name="Starter" price="$99" suffix="/mo" highlight cta="Get started" href="/auth/register?plan=starter"
            features={['Up to 250 candidates', '5 active positions', 'Talent Treasury & resume search', 'Source tracking & email templates', 'Custom branding']} />
          <PricingCard name="Professional" price="$299" suffix="/mo" cta="Get started" href="/auth/register?plan=professional"
            features={['Up to 2,500 candidates', '25 active positions', 'Google Calendar interviews', 'My Team & Team Fit', 'Advanced analytics & GDPR']} />
          <PricingCard name="Enterprise" price="Custom" cta="Contact sales" href="/contact"
            features={['Unlimited candidates & positions', 'HRIS export & SSO', 'Everything in Professional', 'Dedicated support & SLA']} />
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-6 pb-20">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-600 to-purple-700 px-8 py-16 text-center text-white">
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
          <div className="relative">
            <h2 className="text-4xl font-black tracking-tight mb-4">Ready to hire better?</h2>
            <p className="text-lg mb-8 text-white/90 max-w-2xl mx-auto">
              Stop scanning identical CVs. Start matching on real skills and psychological fit.
            </p>
            <Link href="/auth/register" className="inline-flex items-center gap-2 px-8 py-3.5 bg-white text-primary-700 rounded-xl font-bold hover:bg-gray-50 transition shadow-soft-lg">
              Start your free trial <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white py-12">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div className="max-w-xs">
              <Logo className="mb-4" iconOnly={false} />
              <p className="text-sm text-gray-600">
                Hire better by skills and personality — without the AI token bill.
              </p>
            </div>
            <div>
              <h4 className="font-bold mb-3 text-sm">Product</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li><Link href="#features" className="hover:text-primary-600 transition">Features</Link></li>
                <li><Link href="#pricing" className="hover:text-primary-600 transition">Pricing</Link></li>
                <li><Link href="/demo" className="hover:text-primary-600 transition">Live demo</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-3 text-sm">Company</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li><Link href="/contact" className="hover:text-primary-600 transition">Contact</Link></li>
                <li><Link href="/auth/login" className="hover:text-primary-600 transition">Sign in</Link></li>
                <li><Link href="/auth/register" className="hover:text-primary-600 transition">Get started</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-3 text-sm">Legal</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li><Link href="/privacy" className="hover:text-primary-600 transition">Privacy policy</Link></li>
                <li><Link href="/terms" className="hover:text-primary-600 transition">Terms of service</Link></li>
                <li><Link href="/cookies" className="hover:text-primary-600 transition">Cookie policy</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-100 pt-8 text-center text-sm text-gray-500">
            © 2026 hirebtr.com. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureTile({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="card hover:shadow-soft-md transition group">
      <div className="w-11 h-11 bg-primary-50 rounded-xl flex items-center justify-center mb-4 text-primary-600 group-hover:bg-primary-100 transition">
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="text-lg font-black mb-2">{title}</h3>
      <p className="text-gray-600 text-sm leading-relaxed">{children}</p>
    </div>
  );
}

function PricingCard({ name, price, suffix, features, cta, href, highlight }: {
  name: string; price: string; suffix?: string; features: string[]; cta: string; href: string; highlight?: boolean;
}) {
  return (
    <div className={`card flex flex-col ${highlight ? 'border-2 border-primary-600 shadow-soft-lg relative' : ''}`}>
      {highlight && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-3 py-1 bg-primary-600 text-white text-[10px] font-black uppercase tracking-widest rounded-full">
          <Star className="w-3 h-3 fill-current" /> Most popular
        </div>
      )}
      <h3 className="text-lg font-black mb-2">{name}</h3>
      <div className="mb-5">
        <span className="text-4xl font-black">{price}</span>
        {suffix && <span className="text-base text-gray-500 font-bold">{suffix}</span>}
      </div>
      <ul className="space-y-3 mb-6 flex-grow">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
            <CheckCircle className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />{f}
          </li>
        ))}
      </ul>
      <Link href={href} className={`w-full text-center ${highlight ? 'btn-primary' : 'btn-secondary'}`}>{cta}</Link>
    </div>
  );
}
