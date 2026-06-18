'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Building2, TrendingUp, Briefcase, UserPlus, Sparkles, Heart, Laptop, Search, ChevronsUpDown,
} from 'lucide-react';
import { NAV } from '@/lib/crm/registry';

const ICONS: Record<string, any> = {
  LayoutDashboard, Users, Building2, TrendingUp, Briefcase, UserPlus, Sparkles, Heart, Laptop,
};

export default function NavRail() {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r border-slate-200/70 bg-slate-50/40 flex flex-col">
      {/* Workspace switcher */}
      <button className="h-12 flex items-center gap-2 px-3 border-b border-slate-200/70 hover:bg-white/70 transition-colors">
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary-600 to-purple-600 shrink-0" />
        <span className="text-sm font-bold tracking-tight text-slate-800">HireBTR</span>
        <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400 ml-auto" />
      </button>

      {/* Search / command */}
      <div className="px-2 pt-2">
        <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-slate-400 bg-white ring-1 ring-slate-200/70 hover:ring-slate-300 transition-all">
          <Search className="w-3.5 h-3.5" /> Search
          <span className="ml-auto text-[10px] font-semibold border border-slate-200 rounded px-1 py-0.5">⌘K</span>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {NAV.map((g) => (
          <div key={g.group} className="mb-1 px-2">
            <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">{g.group}</div>
            {g.items.map((it) => {
              const Icon = ICONS[it.icon] || Users;
              const active = pathname === it.href || pathname.startsWith(it.href + '/');
              return (
                <Link
                  key={it.slug}
                  href={it.href}
                  className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] font-medium transition-all duration-150 ${
                    active
                      ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/70'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-white/70'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {it.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200/70 p-2 flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500 to-purple-600 text-white text-[11px] font-bold flex items-center justify-center">H</div>
        <div className="text-[12px] leading-tight">
          <div className="font-semibold text-slate-700">Workspace</div>
          <div className="text-slate-400">Free plan</div>
        </div>
      </div>
    </aside>
  );
}
