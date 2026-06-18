import Link from 'next/link';
import { Target, Building2, Users, Briefcase, Sparkles, TrendingUp, Receipt, Laptop, ArrowUpRight } from 'lucide-react';

const MODULES = [
  { group: 'Sales · CRM', tone: 'text-indigo-600', items: [
    { label: 'Deals pipeline', icon: Target, href: '/pipelines/sales/board' },
    { label: 'Companies', icon: Building2, href: '/objects/companies' },
    { label: 'People', icon: Users, href: '/objects/people' },
  ]},
  { group: 'HR · Recruitment', tone: 'text-cyan-600', items: [
    { label: 'Candidates', icon: Users, href: '/dashboard/candidates' },
    { label: 'Hiring pipeline', icon: Briefcase, href: '/dashboard/pipeline' },
    { label: 'Talent Treasury', icon: Sparkles, href: '/dashboard/treasury' },
  ]},
  { group: 'Finance', tone: 'text-emerald-600', items: [
    { label: 'Overview', icon: TrendingUp, href: '/finance/overview' },
    { label: 'Invoices', icon: Receipt, href: '/objects/invoices' },
    { label: 'Assets', icon: Laptop, href: '/objects/assets' },
  ]},
];

export default function WorkspaceHome() {
  return (
    <>
      <header className="h-12 shrink-0 flex items-center px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800">Home</h1>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl">
          <h2 className="text-xl font-black text-slate-900 mb-1">Your company OS</h2>
          <p className="text-sm text-slate-500 mb-8">Sales, recruiting, and finance — one connected workspace.</p>
          <div className="space-y-8">
            {MODULES.map((m) => (
              <section key={m.group}>
                <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">{m.group}</div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {m.items.map((it) => (
                    <Link key={it.label} href={it.href}
                      className="group flex items-center gap-3 rounded-xl bg-white ring-1 ring-slate-200/60 p-4 hover:ring-slate-300 hover:shadow-sm transition-all">
                      <div className="w-9 h-9 rounded-lg bg-slate-50 ring-1 ring-slate-200/60 flex items-center justify-center">
                        <it.icon className={`w-4 h-4 ${m.tone}`} />
                      </div>
                      <span className="text-sm font-semibold text-slate-800">{it.label}</span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 ml-auto transition-colors" />
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
