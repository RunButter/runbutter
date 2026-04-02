'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle, Users, BarChart3, Calendar, Zap, Shield, ArrowRight, LayoutDashboard, Rocket } from 'lucide-react';
import Logo from '@/components/Logo';

export default function HomePage() {
  const [isAnnual, setIsAnnual] = useState(true);

  const getPrice = (monthly: number) => {
    return isAnnual ? Math.floor(monthly * 0.8) : monthly;
  };
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
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
            Hire Smarter with
            <span className="text-primary-600"> AI-Powered</span> Assessments
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Evaluate candidates holistically with personality tests, work style analysis,
            and cognitive assessments. Integrated scheduling with Google Calendar & Meet.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/auth/register" className="btn-primary px-8 py-3 text-lg">
              Start Free Trial
            </Link>
            <Link href="#demo" className="btn-secondary px-8 py-3 text-lg">
              Watch Demo
            </Link>
          </div>
          <p className="text-sm text-gray-500 mt-4">No credit card required • 14-day free trial</p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-20">
        <h2 className="text-4xl font-bold text-center mb-12">Everything You Need to Hire Better</h2>
        <div className="grid md:grid-cols-3 gap-8">
          <div className="card hover:shadow-lg transition group border-2 border-primary-50">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mb-4 group-hover:rotate-6 transition">
              <LayoutDashboard className="w-6 h-6 text-primary-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Visual Recruitment Pipeline</h3>
            <p className="text-gray-600">
              Drag-and-drop candidates between custom stages (Applied, Screening, Interview, Hired). 
              See your entire funnel in one glance.
            </p>
          </div>

          <div className="card hover:shadow-lg transition">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
              <BarChart3 className="w-6 h-6 text-purple-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Neuro-Match Scoring</h3>
            <p className="text-gray-600">
              Big 5 personality traits, work style preferences, and cognitive problem-solving tests
              mapped to 4 unique professional profiles.
            </p>
          </div>

          <div className="card hover:shadow-lg transition">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
              <Calendar className="w-6 h-6 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Integrated Scheduling</h3>
            <p className="text-gray-600">
              Schedule interviews with Google Calendar and auto-generate Google Meet links.
              All in one click.
            </p>
          </div>

          <div className="card hover:shadow-lg transition">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
              <Zap className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Multi-Tenant SaaS</h3>
            <p className="text-gray-600">
              Each company gets their own subdomain and branded assessment portal.
              Scale effortlessly.
            </p>
          </div>

          <div className="card hover:shadow-lg transition">
            <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-4">
              <Users className="w-6 h-6 text-orange-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Candidate Portal</h3>
            <p className="text-gray-600">
              Beautiful application experience with CV upload, assessment flow, and real-time status updates.
            </p>
          </div>

          <div className="card hover:shadow-lg transition">
            <div className="w-12 h-12 bg-pink-100 rounded-lg flex items-center justify-center mb-4">
              <Shield className="w-6 h-6 text-pink-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Insights & Analytics</h3>
            <p className="text-gray-600">
              Visual dashboards with personality radar charts, scoring breakdowns, and hiring recommendations.
            </p>
          </div>

          <div className="card hover:shadow-lg transition">
            <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4">
              <CheckCircle className="w-6 h-6 text-indigo-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Role-Based Access</h3>
            <p className="text-gray-600">
              Secure multi-user access with owner, admin, recruiter, and viewer roles.
              Full audit trail.
            </p>
          </div>
        </div>
      </section>

      {/* Showcase Section */}
      <section id="demo" className="bg-gray-900 py-24 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4 italic uppercase tracking-tighter">Designed for High-Performance Teams</h2>
            <p className="text-xl text-gray-400">Transform your recruitment from a list of names into a visual, data-driven pipeline.</p>
          </div>
          
          <div className="relative">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary-600 to-purple-600 rounded-[2rem] blur-xl opacity-20" />
            <img 
              src="/hirebtr_pipeline_showcase_1775151947434.png" 
              alt="HireBtr Pipeline Showcase" 
              className="relative w-full rounded-[2rem] shadow-2xl border border-white/10"
            />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-7xl mx-auto px-6 py-20">
        <h2 className="text-4xl font-bold text-center mb-4">Simple, Transparent Pricing</h2>
        <div className="flex items-center justify-center gap-4 mb-12">
          <span className={`text-sm ${!isAnnual ? 'text-gray-900 font-bold' : 'text-gray-500'}`}>Monthly</span>
          <button 
            onClick={() => setIsAnnual(!isAnnual)}
            className="w-14 h-7 bg-gray-200 rounded-full p-1 relative transition shadow-inner"
          >
            <div className={`w-5 h-5 bg-primary-600 rounded-full transition-transform ${isAnnual ? 'translate-x-7' : 'translate-x-0'}`} />
          </button>
          <div className="flex items-center gap-2">
            <span className={`text-sm ${isAnnual ? 'text-gray-900 font-bold' : 'text-gray-500'}`}>Annually</span>
            <span className="bg-green-100 text-green-700 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">Save 20%</span>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-6">
          {/* Free */}
          <div className="card">
            <h3 className="text-lg font-bold mb-2">Free</h3>
            <div className="text-4xl font-bold mb-4">$0</div>
            <ul className="space-y-3 mb-6">
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Up to 10 candidates/month
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                1 active position
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Basic assessments
              </li>
            </ul>
            <Link href="/auth/register?plan=free" className="btn-secondary w-full text-center">
              Start Free
            </Link>
          </div>

          {/* Starter */}
          <div className="card border-2 border-primary-600">
            <div className="inline-block px-3 py-1 bg-primary-100 text-primary-700 text-xs font-semibold rounded-full mb-2">
              Most Popular
            </div>
            <h3 className="text-lg font-bold mb-2">Starter</h3>
            <div className="text-4xl font-bold mb-4">${getPrice(99)}<span className="text-lg text-gray-600">/mo</span></div>
            <ul className="space-y-3 mb-6">
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Up to 50 candidates/month
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                5 active positions
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Google Calendar integration
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Custom branding
              </li>
            </ul>
            <Link href="/auth/register?plan=starter" className="btn-primary w-full text-center">
              Get Started
            </Link>
          </div>

          {/* Professional */}
          <div className="card">
            <h3 className="text-lg font-bold mb-2">Professional</h3>
            <div className="text-4xl font-bold mb-4">${getPrice(299)}<span className="text-lg text-gray-600">/mo</span></div>
            <ul className="space-y-3 mb-6">
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Up to 200 candidates/month
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Unlimited positions
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Advanced analytics
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                ATS integrations
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Priority support
              </li>
            </ul>
            <Link href="/auth/register?plan=professional" className="btn-secondary w-full text-center">
              Get Started
            </Link>
          </div>

          {/* Enterprise */}
          <div className="card">
            <h3 className="text-lg font-bold mb-2">Enterprise</h3>
            <div className="text-4xl font-bold mb-4">Custom</div>
            <ul className="space-y-3 mb-6">
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Unlimited everything
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Custom assessments
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                API access
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Dedicated support
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                SLA guarantee
              </li>
            </ul>
            <Link href="/contact" className="btn-secondary w-full text-center">
              Contact Sales
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary-600 text-white py-20">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold mb-4">Ready to Transform Your Hiring?</h2>
          <p className="text-xl mb-8 opacity-90">
            Join hundreds of companies making better hiring decisions with data-driven assessments.
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
                AI-powered recruitment assessments for modern hiring teams.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-3">Product</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li><Link href="#features">Features</Link></li>
                <li><Link href="#pricing">Pricing</Link></li>
                <li><Link href="/demo">Demo</Link></li>
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
