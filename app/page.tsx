import Link from 'next/link';
import {
  CheckCircle, Users, BarChart3, Calendar, Search, Sparkles,
  Radio, ShieldCheck, Heart, LayoutDashboard
} from 'lucide-react';
import Logo from '@/components/Logo';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <Link href="/">
            <Logo />
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="#features" className="text-gray-600 hover:text-gray-900">Features</Link>
            <Link href="#pricing" className="text-gray-600 hover:text-gray-900">Pricing</Link>
            <Link href="/auth/login" className="text-gray-600 hover:text-gray-900">Sign In</Link>
            <Link href="/auth/register" className="btn-primary">Get Started</Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 py-20 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 bg-primary-50 border border-primary-100 rounded-full text-primary-700 text-xs font-bold uppercase tracking-widest">
            <Sparkles className="w-3.5 h-3.5" /> Skills + Personality ATS
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
            Hire better by
            <span className="text-primary-600"> skills and personality</span>
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            HireBTR fuses hard-skill search with a frictionless psychometric assessment —
            so you find the right human fast, without reading hundreds of identical CVs.
            Built on native Postgres search, so it scales without the AI token bill.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/auth/register" className="btn-primary px-8 py-3 text-lg">
              Start Free Trial
            </Link>
            <Link href="/demo" className="btn-secondary px-8 py-3 text-lg">
              View Interactive Demo
            </Link>
          </div>
          <p className="text-sm text-gray-500 mt-4">No credit card required • 14-day free trial</p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-20">
        <h2 className="text-4xl font-bold text-center mb-3">Everything you need to hire better</h2>
        <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
          From first click to onboarded teammate — match on real skills and psychological fit at every step.
        </p>
        <div className="grid md:grid-cols-3 gap-8">
          <div className="card hover:shadow-lg transition group border-2 border-primary-50">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mb-4 group-hover:rotate-6 transition">
              <Sparkles className="w-6 h-6 text-primary-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Talent Treasury</h3>
            <p className="text-gray-600">
              An e-commerce-style faceted explorer for your talent pool. Drag psychometric
              sliders, filter by source and role, and watch the shortlist update instantly.
            </p>
          </div>

          <div className="card hover:shadow-lg transition">
            <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center mb-4">
              <Search className="w-6 h-6 text-emerald-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Zero-Cost Resume Search</h3>
            <p className="text-gray-600">
              Boolean keyword search (<code>React AND Node NOT Junior</code>) across tens of
              thousands of CVs in milliseconds — powered by native Postgres, not pricey AI APIs.
            </p>
          </div>

          <div className="card hover:shadow-lg transition">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
              <BarChart3 className="w-6 h-6 text-purple-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Psychometric Match Scoring</h3>
            <p className="text-gray-600">
              Big-5 personality, work style, and cognitive tests mapped to each role&apos;s ideal
              profile — visualised as radar charts with a live match score.
            </p>
          </div>

          <div className="card hover:shadow-lg transition">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
              <LayoutDashboard className="w-6 h-6 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Visual Pipeline</h3>
            <p className="text-gray-600">
              Drag-and-drop candidates through your stages, with automatic status emails so
              applicants always know where they stand.
            </p>
          </div>

          <div className="card hover:shadow-lg transition">
            <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-4">
              <Radio className="w-6 h-6 text-orange-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Source Tracking</h3>
            <p className="text-gray-600">
              Generate a tracking link per job board, capture UTM &amp; referrer data automatically,
              and see exactly which channels deliver your best hires.
            </p>
          </div>

          <div className="card hover:shadow-lg transition">
            <div className="w-12 h-12 bg-pink-100 rounded-lg flex items-center justify-center mb-4">
              <Heart className="w-6 h-6 text-pink-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">My Team &amp; Onboarding</h3>
            <p className="text-gray-600">
              When you hire, candidates flow into a post-hire workspace with auto-generated
              manager briefs, culture maps, and weekly pulse check-ins.
            </p>
          </div>

          <div className="card hover:shadow-lg transition">
            <div className="w-12 h-12 bg-cyan-100 rounded-lg flex items-center justify-center mb-4">
              <Calendar className="w-6 h-6 text-cyan-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Integrated Scheduling</h3>
            <p className="text-gray-600">
              Book interviews with Google Calendar and auto-generate Google Meet links — in one click.
            </p>
          </div>

          <div className="card hover:shadow-lg transition">
            <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4">
              <ShieldCheck className="w-6 h-6 text-indigo-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">GDPR / RODO Ready</h3>
            <p className="text-gray-600">
              Built-in consent ledger and automated anonymization of candidate data past your
              retention window — compliance handled by default.
            </p>
          </div>

          <div className="card hover:shadow-lg transition">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
              <Users className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Branded Candidate Portal</h3>
            <p className="text-gray-600">
              Each company gets a branded application flow with CV upload and a short, gamified
              5-minute assessment — a candidate experience people actually finish.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-7xl mx-auto px-6 py-20">
        <h2 className="text-4xl font-bold text-center mb-4">Simple, Transparent Pricing</h2>
        <p className="text-center text-gray-600 mb-12">Start free, upgrade as you grow</p>

        <div className="grid md:grid-cols-4 gap-6">
          {/* Free */}
          <div className="card">
            <h3 className="text-lg font-bold mb-2">Free</h3>
            <div className="text-4xl font-bold mb-4">$0</div>
            <ul className="space-y-3 mb-6">
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />Up to 10 candidates/month</li>
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />1 active position</li>
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />Basic assessments</li>
            </ul>
            <Link href="/auth/register?plan=free" className="btn-secondary w-full text-center">Start Free</Link>
          </div>

          {/* Starter */}
          <div className="card border-2 border-primary-600">
            <div className="inline-block px-3 py-1 bg-primary-100 text-primary-700 text-xs font-semibold rounded-full mb-2">Most Popular</div>
            <h3 className="text-lg font-bold mb-2">Starter</h3>
            <div className="text-4xl font-bold mb-4">$99<span className="text-lg text-gray-600">/mo</span></div>
            <ul className="space-y-3 mb-6">
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />Up to 50 candidates/month</li>
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />5 active positions</li>
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />Google Calendar integration</li>
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />Custom branding</li>
            </ul>
            <Link href="/auth/register?plan=starter" className="btn-primary w-full text-center">Get Started</Link>
          </div>

          {/* Professional */}
          <div className="card">
            <h3 className="text-lg font-bold mb-2">Professional</h3>
            <div className="text-4xl font-bold mb-4">$299<span className="text-lg text-gray-600">/mo</span></div>
            <ul className="space-y-3 mb-6">
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />Up to 200 candidates/month</li>
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />Unlimited positions</li>
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />Advanced analytics</li>
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />ATS integrations</li>
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />Priority support</li>
            </ul>
            <Link href="/auth/register?plan=professional" className="btn-secondary w-full text-center">Get Started</Link>
          </div>

          {/* Enterprise */}
          <div className="card">
            <h3 className="text-lg font-bold mb-2">Enterprise</h3>
            <div className="text-4xl font-bold mb-4">Custom</div>
            <ul className="space-y-3 mb-6">
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />Unlimited everything</li>
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />Custom assessments</li>
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />API access</li>
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />Dedicated support</li>
              <li className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-green-600" />SLA guarantee</li>
            </ul>
            <Link href="/contact" className="btn-secondary w-full text-center">Contact Sales</Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary-600 text-white py-20">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold mb-4">Ready to hire better?</h2>
          <p className="text-xl mb-8 opacity-90">
            Stop scanning identical CVs. Start matching on real skills and psychological fit.
          </p>
          <Link href="/auth/register" className="inline-block px-8 py-3 bg-white text-primary-600 rounded-lg font-semibold hover:bg-gray-100 transition">
            Start Your Free Trial
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-white py-12">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <Logo className="mb-4" iconOnly={false} />
              <p className="text-sm text-gray-600">
                Hire better by skills and personality — without the AI token bill.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-3">Product</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li><Link href="#features">Features</Link></li>
                <li><Link href="#pricing">Pricing</Link></li>
                <li><Link href="/demo">Live Demo</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3">Company</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li><Link href="/about">About</Link></li>
                <li><Link href="/contact">Contact</Link></li>
                <li><Link href="/blog">Blog</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3">Legal</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li><Link href="/privacy" className="hover:text-primary-600">Privacy Policy</Link></li>
                <li><Link href="/terms" className="hover:text-primary-600">Terms of Service</Link></li>
                <li><Link href="/cookies" className="hover:text-primary-600">Cookie Policy</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t pt-8 text-center text-sm text-gray-600">
            © 2026 hirebtr.com. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}