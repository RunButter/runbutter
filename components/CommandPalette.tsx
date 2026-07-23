'use client';

// ⌘K command palette for the workspace shell. Opens on ⌘K / Ctrl+K, or when the
// sidebar "Search" button dispatches the `runbutter:command` window event, and
// jumps to any screen in NAV. Purely additive — it wires up the affordance that
// was already stubbed in NavRail but did nothing.
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard, Users, Building2, TrendingUp, Briefcase, Sparkles, Heart, Laptop,
  Columns3, Calendar, Radio, Mail, BarChart3, Target, Receipt, Wallet, FolderKanban, ListTodo, Package, ShieldCheck,
  GanttChartSquare, CreditCard, Palette, FileText, Megaphone, Rocket, Globe, PenSquare, ArrowLeftRight,
  Zap, Plug, Bot, FileBarChart, PenLine, FileInput, Link2, MessageCircle, ArrowRight,
} from 'lucide-react';
import { NAV } from '@/lib/crm/registry';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from '@/components/ui/command';

const ICONS: Record<string, any> = {
  LayoutDashboard, Users, Building2, TrendingUp, Briefcase, Sparkles, Heart, Laptop,
  Columns3, Calendar, Radio, Mail, BarChart3, Target, Receipt, Wallet, FolderKanban, ListTodo, Package, ShieldCheck,
  GanttChartSquare, CreditCard, Palette, FileText, Megaphone, Rocket, Globe, PenSquare, ArrowLeftRight,
  Zap, Plug, Bot, FileBarChart, PenLine, FileInput, Link2, MessageCircle,
};

export const COMMAND_EVENT = 'runbutter:command';

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onEvent = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener(COMMAND_EVENT, onEvent);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener(COMMAND_EVENT, onEvent);
    };
  }, []);

  const go = useCallback((href: string) => {
    setOpen(false);
    router.push(href);
  }, [router]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to…  (type a page name)" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        {NAV.map((group: any) => (
          <CommandGroup key={group.group} heading={group.group}>
            {group.items.map((it: any) => {
              const Icon = ICONS[it.icon] || ArrowRight;
              return (
                <CommandItem
                  key={it.slug}
                  value={`${group.group} ${it.label}`}
                  onSelect={() => go(it.href)}
                >
                  <Icon className="h-4 w-4 shrink-0 text-tertiary" />
                  <span className="truncate">{it.label}</span>
                  <span className="ml-auto text-2xs text-tertiary/70">{group.group}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
      <div className="flex items-center gap-3 border-t border-subtle px-3 py-2 text-2xs text-tertiary">
        <span className="flex items-center gap-1"><kbd className="font-mono">↑↓</kbd> navigate</span>
        <span className="flex items-center gap-1"><kbd className="font-mono">↵</kbd> open</span>
        <span className="flex items-center gap-1"><kbd className="font-mono">esc</kbd> close</span>
        <CommandShortcut className="ml-auto">⌘K</CommandShortcut>
      </div>
    </CommandDialog>
  );
}
