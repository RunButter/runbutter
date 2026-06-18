import Link from 'next/link';
import { Users, Building2, TrendingUp, Briefcase, ArrowUpRight } from 'lucide-react';

const STATS = [
  { label: 'People', value: '1,284', icon: Users, href: '/objects/people' },
  { label: 'Companies', value: '317', icon: Building2, href: '/objects/companies' },
  { label: 'Open deals', value: '$182k', icon: TrendingUp, href: '/pipelines/sales/board' },
  { label: 'In hiring', value: '24', icon: Briefcase, href: '/pipelines/recruitment/board' },
];

export default function WorkspaceHome() {
  return (
    <>
      <header className="h-12 shrink-0 flex items-center px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800">Home</h1>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 max-w-4xl">
          {STATS.map((s) => (
            <Link key={s.label} href={s.href}
              className="group rounded-xl bg-white ring-1 ring-slate-200/60 p-4 hover:ring-slate-300 hover:shadow-sm transition-all">
              <div className="flex items-center justify-between">
                <s.icon className="w-4 h-4 text-slate-400" />
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors" />
              </div>
              <div className="mt-3 text-2xl font-black text-slate-900 tabular-nums">{s.value}</div>
              <div className="text-[12px] font-medium text-slate-400">{s.label}</div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
