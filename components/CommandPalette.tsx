'use client';

// ⌘K command palette for the workspace shell. Opens on ⌘K / Ctrl+K, or when the
// sidebar "Search" button dispatches the `runbutter:command` window event, and
// jumps to any screen in NAV. Purely additive — it wires up the affordance that
// was already stubbed in NavRail but did nothing.
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, KeyRound } from 'lucide-react';
import PasswordGenerator from '@/components/crm/PasswordGenerator';
import { iconFor } from '@/lib/crm/object-icons';
import { usePrivy } from '@privy-io/react-auth';
import { useNav } from '@/lib/crm/nav';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from '@/components/ui/command';


export const COMMAND_EVENT = 'runbutter:command';

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { ready, authenticated, user } = usePrivy();
  // Loaded the first time the palette is opened, not on every page — the
  // palette is mounted on every screen and most of them never open it.
  const nav = useNav(ready && authenticated && user ? user.id : null, open);
  // ACTIONS, not just destinations. The palette only ever jumped to a page,
  // which meant the generator was reachable only from inside the vault — and
  // you have to create a vault before you can see it. Generating a password is
  // the most common reason to want one and has nothing to do with storing it.
  const [genOpen, setGenOpen] = useState(false);

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
    <>
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to…  (type a page name)" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem value="Generate a password passphrase random secure"
            onSelect={() => { setOpen(false); setGenOpen(true); }}>
            <KeyRound className="h-4 w-4 shrink-0 text-tertiary" />
            <span className="truncate">Generate a password</span>
            <span className="ml-auto text-2xs text-tertiary/70">Actions</span>
          </CommandItem>
        </CommandGroup>
        {nav.map((group: any) => (
          <CommandGroup key={group.group} heading={group.group}>
            {group.items.map((it: any) => {
              const Icon = iconFor(it.icon, ArrowRight);
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
    {genOpen && <PasswordGenerator onClose={() => setGenOpen(false)} />}
    </>
  );
}
