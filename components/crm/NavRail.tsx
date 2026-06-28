'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import {
  LayoutDashboard, Users, Building2, TrendingUp, Briefcase, Sparkles, Heart, Laptop,
  Columns3, Calendar, Radio, Mail, BarChart3, Target, Receipt, Wallet, FolderKanban, ListTodo, Package, ShieldCheck,
  GanttChartSquare, CreditCard, Palette,
  Search, ChevronsUpDown, ChevronRight, LogOut,
} from 'lucide-react';
import { NAV } from '@/lib/crm/registry';

const ICONS: Record<string, any> = {
  LayoutDashboard, Users, Building2, TrendingUp, Briefcase, Sparkles, Heart, Laptop,
  Columns3, Calendar, Radio, Mail, BarChart3, Target, Receipt, Wallet, FolderKanban, ListTodo, Package, ShieldCheck,
  GanttChartSquare, CreditCard, Palette,
};

function Item({ it, active, onNavigate }: { it: any; active: boolean; onNavigate?: () => void }) {
  const Icon = ICONS[it.icon] || Users;
  return (
    <Link
      href={it.href}
      onClick={onNavigate}
      className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] font-medium transition-all duration-150 ${
        active ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/70' : 'text-slate-500 hover:text-slate-900 hover:bg-white/70'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {it.label}
    </Link>
  );
}

export default function NavRail({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = usePrivy();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try { const s = localStorage.getItem('hb-nav-collapsed'); if (s) setCollapsed(JSON.parse(s)); } catch {}
    setHydrated(true);
  }, []);

  const toggle = (g: string) =>
    setCollapsed((prev) => {
      const next = { ...prev, [g]: !prev[g] };
      try { localStorage.setItem('hb-nav-collapsed', JSON.stringify(next)); } catch {}
      return next;
    });

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <aside className="w-60 h-full shrink-0 border-r border-slate-200/70 bg-slate-50/40 flex flex-col">
      <button className="h-12 flex items-center gap-2 px-3 border-b border-slate-200/70 hover:bg-white/70 transition-colors">
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary-600 to-purple-600 shrink-0" />
        <span className="text-sm font-bold tracking-tight text-slate-800">HireBTR</span>
        <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400 ml-auto" />
      </button>

      <div className="px-2 pt-2">
        <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-slate-400 bg-white ring-1 ring-slate-200/70 hover:ring-slate-300 transition-all">
          <Search className="w-3.5 h-3.5" /> Search
          <span className="ml-auto text-[10px] font-semibold border border-slate-200 rounded px-1 py-0.5">⌘K</span>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {NAV.map((g: any) => {
          if (g.pinned) {
            return (
              <div key={g.group} className="px-2 mb-2">
                {g.items.map((it: any) => <Item key={it.slug} it={it} active={isActive(it.href)} onNavigate={onNavigate} />)}
              </div>
            );
          }
          const open = !collapsed[g.group];
          return (
            <div key={g.group} className="px-2 mb-1">
              <button
                onClick={() => toggle(g.group)}
                className="w-full flex items-center gap-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
              >
                <ChevronRight className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
                {g.group}
              </button>
              {(open || !hydrated) && (
                <div className="mt-0.5 space-y-0.5">
                  {g.items.map((it: any) => <Item key={it.slug} it={it} active={isActive(it.href)} onNavigate={onNavigate} />)}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-slate-200/70 p-2 flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500 to-purple-600 text-white text-[11px] font-bold flex items-center justify-center">H</div>
        <div className="text-[12px] leading-tight min-w-0">
          <div className="font-semibold text-slate-700 truncate">Workspace</div>
          <div className="text-slate-400">Free plan</div>
        </div>
        <button
          aria-label="Sign out"
          onClick={async () => { await logout(); router.push('/auth/login'); }}
          className="ml-auto p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
