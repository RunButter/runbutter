'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import {
  LayoutDashboard, Users, Building2, TrendingUp, Briefcase, Sparkles, Heart, Laptop,
  Columns3, Calendar, Radio, Mail, BarChart3, Target, Receipt, Wallet, FolderKanban, ListTodo, Package, ShieldCheck,
  GanttChartSquare, CreditCard, Palette, FileText, Megaphone, Rocket, Globe, PenSquare, ArrowLeftRight, Landmark,
  Zap, Plug, Search, ChevronsUpDown, ChevronRight, LogOut, Bot, Loader2, FileBarChart, PenLine, FileInput, Link2, MessageCircle,
  FileStack, Globe2,
} from 'lucide-react';
import { NAV } from '@/lib/crm/registry';
import { getWorkspace, loadBranding, loadNavActivity, listMyWorkspaces, setActiveWorkspace, type WorkspaceContext, type WorkspaceOption } from '@/lib/crm/data';
import ThemeToggle from '@/components/ui/ThemeToggle';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuCheck,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

const ICONS: Record<string, any> = {
  LayoutDashboard, Users, Building2, TrendingUp, Briefcase, Sparkles, Heart, Laptop,
  Columns3, Calendar, Radio, Mail, BarChart3, Target, Receipt, Wallet, FolderKanban, ListTodo, Package, ShieldCheck,
  GanttChartSquare, CreditCard, Palette, FileText, Megaphone, Rocket, Globe, PenSquare, ArrowLeftRight, Landmark,
  Zap, Plug, Bot, FileBarChart, PenLine, FileInput, Link2, MessageCircle, FileStack, Globe2,
};

// Nav slugs the "new since you last looked" badge tracks (must match RPC keys).
const TRACKED = ['people', 'companies', 'invoices', 'offers', 'expenses', 'transactions', 'issues', 'docs', 'candidates'];
const SEEN_KEY = 'hb-nav-seen';
const readSeen = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; } };
const writeSeen = (m: Record<string, string>) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(m)); } catch {} };

function Item({ it, active, count, onNavigate }: { it: any; active: boolean; count?: number; onNavigate?: () => void }) {
  const Icon = ICONS[it.icon] || Users;
  const badge = !!count && count > 0;
  return (
    <Link
      href={it.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-sm transition-colors duration-100 ${
        active ? 'bg-surface-hover text-primary font-medium ring-1 ring-subtle'
          : badge ? 'text-primary font-medium hover:bg-surface-hover'
            : 'text-secondary hover:text-primary hover:bg-surface-hover'
      }`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-accent' : 'text-tertiary'}`} />
      <span className="truncate">{it.label}</span>
      {badge && (
        <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-md bg-accent text-accent-fg text-2xs font-medium tabular-nums leading-none">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

export default function NavRail({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, ready, authenticated, user } = usePrivy();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);
  const [ws, setWs] = useState<WorkspaceContext | null>(null);

  useEffect(() => {
    try { const s = localStorage.getItem('hb-nav-collapsed'); if (s) setCollapsed(JSON.parse(s)); } catch {}
    setHydrated(true);
  }, []);

  // Show the real workspace identity (name, role, uploaded logo) once signed in.
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    getWorkspace(user.id).then(async (w) => {
      if (!w) return;
      setWs(w);
      const b = await loadBranding(user.id, w.id).catch(() => null);
      if (b?.logo_url) setLogo(b.logo_url);
    }).catch(() => {});
  }, [ready, authenticated, user]);

  // Workspace switcher. Most people have exactly one, so the list is only
  // fetched when the menu is opened.
  const [wsOpen, setWsOpen] = useState(false);
  const [wsList, setWsList] = useState<WorkspaceOption[] | null>(null);
  const [switching, setSwitching] = useState('');

  // Lazy-load the workspace list the first time the menu opens.
  const onSwitcherOpenChange = (open: boolean) => {
    setWsOpen(open);
    if (open && !wsList && user) listMyWorkspaces(user.id).then(setWsList);
  };

  const switchTo = async (id: string) => {
    if (!user || id === ws?.id) { setWsOpen(false); return; }
    setSwitching(id);
    const res = await setActiveWorkspace(user.id, id);
    if (res.error) { setSwitching(''); return; }
    // Hard reload rather than a router refresh: every screen resolves its own
    // workspace-scoped data on mount, and much of it is already in client state.
    window.location.href = '/home';
  };

  // "New since you last looked" badges. Baseline every tab to now() on first
  // ever load (so no badge storm), then poll + refresh on window focus.
  const [counts, setCounts] = useState<Record<string, number>>({});
  const refreshCounts = useCallback(() => {
    if (!user) return;
    const seen = readSeen();
    let changed = false;
    const nowIso = new Date().toISOString();
    for (const s of TRACKED) if (!seen[s]) { seen[s] = nowIso; changed = true; }
    if (changed) writeSeen(seen);
    loadNavActivity(user.id, seen).then(setCounts);
  }, [user]);

  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    refreshCounts();
    const iv = setInterval(refreshCounts, 60000);
    const onFocus = () => refreshCounts();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus); };
  }, [ready, authenticated, user, refreshCounts]);

  // Opening a tab marks it seen and clears its badge immediately.
  const markSeen = (slug: string) => {
    const seen = readSeen(); seen[slug] = new Date().toISOString(); writeSeen(seen);
    setCounts((c) => (c[slug] ? { ...c, [slug]: 0 } : c));
  };

  const toggle = (g: string) =>
    setCollapsed((prev) => {
      const next = { ...prev, [g]: !prev[g] };
      try { localStorage.setItem('hb-nav-collapsed', JSON.stringify(next)); } catch {}
      return next;
    });

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <aside className="w-64 h-full shrink-0 bg-canvas flex flex-col">
      <DropdownMenu open={wsOpen} onOpenChange={onSwitcherOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            className="w-full h-14 flex items-center gap-2 px-3 outline-none hover:bg-surface-hover data-[state=open]:bg-surface-hover transition-colors">
            {logo ? (
              <img src={logo} alt="" className="w-5 h-5 rounded object-cover border border-subtle shrink-0" />
            ) : (
              <div className="w-5 h-5 rounded bg-accent shrink-0 flex items-center justify-center text-2xs font-semibold text-accent-fg">
                {(ws?.name || 'R')[0].toUpperCase()}
              </div>
            )}
            <span className="text-sm font-medium text-primary truncate">{ws?.name || 'RunButter'}</span>
            <ChevronsUpDown className="w-3.5 h-3.5 text-tertiary ml-auto shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={4} className="w-[15.5rem]">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {wsList === null ? (
            <div className="px-2 py-2 text-xs text-tertiary flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
          ) : wsList.length === 0 ? (
            <div className="px-2 py-2 text-xs text-tertiary">No workspaces.</div>
          ) : wsList.map((w) => (
            <DropdownMenuItem key={w.id} disabled={!!switching} onSelect={() => switchTo(w.id)} className="h-9">
              <div className="w-5 h-5 rounded bg-surface-hover text-secondary text-2xs font-semibold flex items-center justify-center shrink-0">
                {(w.name || 'R')[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-primary truncate">{w.name}</div>
                <div className="text-2xs text-tertiary capitalize">{w.role}</div>
              </div>
              {switching === w.id
                ? <Loader2 className="w-3.5 h-3.5 animate-spin text-tertiary shrink-0 ml-auto" />
                : <DropdownMenuCheck show={w.id === ws?.id} />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="px-2 pb-3">
        <button
          onClick={() => window.dispatchEvent(new Event('runbutter:command'))}
          className="w-full flex items-center gap-2 h-9 px-2.5 rounded-lg text-sm text-tertiary bg-surface-sunken ring-1 ring-subtle hover:bg-surface-hover hover:text-secondary transition-colors">
          <Search className="w-3.5 h-3.5 shrink-0" /> Search
          <kbd className="ml-auto shrink-0 rounded border border-subtle bg-surface px-1.5 py-0.5 text-2xs font-mono text-tertiary leading-none">⌘K</kbd>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {NAV.map((g: any) => {
          if (g.pinned) {
            return (
              <div key={g.group} className="px-2 mb-4 space-y-1">
                {g.items.map((it: any) => <Item key={it.slug} it={it} active={isActive(it.href)} count={counts[it.slug]} onNavigate={() => { markSeen(it.slug); onNavigate?.(); }} />)}
              </div>
            );
          }
          const open = !collapsed[g.group];
          return (
            <div key={g.group} className="px-2 mb-3">
              <button
                onClick={() => toggle(g.group)}
                className="w-full flex items-center gap-1 px-2.5 py-1.5 text-2xs font-semibold uppercase tracking-widest text-tertiary hover:text-secondary transition-colors"
              >
                <ChevronRight className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
                {g.group}
              </button>
              {(open || !hydrated) && (
                <div className="mt-1 space-y-1">
                  {g.items.map((it: any) => <Item key={it.slug} it={it} active={isActive(it.href)} count={counts[it.slug]} onNavigate={() => { markSeen(it.slug); onNavigate?.(); }} />)}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-subtle p-2 flex items-center gap-2">
        {logo ? (
          <img src={logo} alt="" className="w-6 h-6 rounded-full object-cover border border-subtle shrink-0" />
        ) : (
          <div className="w-6 h-6 rounded-full bg-surface-hover text-secondary text-2xs font-medium flex items-center justify-center shrink-0">{(ws?.name || 'R')[0].toUpperCase()}</div>
        )}
        <div className="text-xs leading-tight min-w-0 flex-1">
          <div className="font-medium text-primary truncate">{ws?.name || 'Workspace'}</div>
          <div className="text-tertiary capitalize">{ws?.role || 'Member'}</div>
        </div>
        <ThemeToggle />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Sign out"
              onClick={async () => { await logout(); router.push('/auth/login'); }}
              className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-surface-hover transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Sign out</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
