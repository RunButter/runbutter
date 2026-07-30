'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Check, ChevronDown, X } from 'lucide-react';

export interface SearchOption { id: string; name: string; hint?: string; image?: string | null }

// Searchable combobox for relation pickers (client on an invoice, product on a
// position, …). Type to filter thousands of options; arrows + enter to pick.
// `value=''` + `clearOnPick` turns it into an "add" trigger (product picker).
export default function SearchSelect({
  options, value, onChange, placeholder = 'Search…', emptyLabel = '— none —',
  allowClear = false, clearOnPick = false, buttonClassName = '',
}: {
  options: SearchOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  allowClear?: boolean;
  clearOnPick?: boolean;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 100);
    return options
      .filter((o) => o.name.toLowerCase().includes(q) || (o.hint || '').toLowerCase().includes(q))
      .slice(0, 100);
  }, [options, query]);

  useEffect(() => { setHi(0); }, [query, open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  useEffect(() => { if (open) { setQuery(''); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    if (clearOnPick) setQuery('');
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, filtered.length - 1)); scrollTo(hi + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); scrollTo(hi - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[hi]) pick(filtered[hi].id); }
    else if (e.key === 'Escape') { setOpen(false); }
  };
  const scrollTo = (i: number) => {
    const el = listRef.current?.children[i] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={`w-full h-9 px-2.5 inline-flex items-center gap-2 text-sm rounded-md bg-surface ring-1 ring-subtle hover:ring-strong shadow-sm focus:ring-2 focus:ring-accent/30 outline-none text-left ${buttonClassName}`}>
        {selected?.image && <img src={selected.image} alt="" className="w-5 h-5 rounded object-cover shrink-0" />}
        <span className={`flex-1 truncate ${selected ? 'text-primary font-medium' : 'text-tertiary'}`}>
          {selected ? selected.name : placeholder}
        </span>
        {allowClear && selected ? (
          <span role="button" aria-label="Clear" onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="p-0.5 rounded text-tertiary hover:text-danger"><X className="w-3.5 h-3.5" /></span>
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-tertiary shrink-0" />
        )}
      </button>

      {open && (
        <div className="absolute z-[80] mt-1 w-full min-w-[220px] rounded-lg bg-surface ring-1 ring-subtle shadow-popover overflow-hidden">
          <div className="flex items-center gap-1.5 px-2.5 h-9 border-b border-subtle">
            <Search className="w-3.5 h-3.5 text-tertiary shrink-0" />
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey}
              placeholder="Type to search…" className="flex-1 text-sm outline-none placeholder:text-tertiary" />
          </div>
          <div ref={listRef} className="max-h-56 overflow-y-auto py-1">
            {allowClear && !query && (
              <button type="button" onClick={() => pick('')}
                className="w-full px-2.5 py-1.5 text-left text-sm text-tertiary hover:bg-surface-sunken">{emptyLabel}</button>
            )}
            {filtered.length === 0 && <div className="px-2.5 py-3 text-center text-xs text-tertiary">No matches for “{query}”.</div>}
            {filtered.map((o, i) => (
              <button key={o.id} type="button" onClick={() => pick(o.id)} onMouseEnter={() => setHi(i)}
                className={`w-full px-2.5 py-1.5 flex items-center gap-2 text-left text-sm ${i === hi ? 'bg-accent/10' : ''}`}>
                {o.image && <img src={o.image} alt="" className="w-6 h-6 rounded object-cover shrink-0 ring-1 ring-subtle" />}
                <span className="flex-1 truncate text-secondary">{o.name}</span>
                {o.hint && <span className="text-2xs text-tertiary tabular-nums shrink-0">{o.hint}</span>}
                {o.id === value && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
              </button>
            ))}
            {options.length > 100 && filtered.length === 100 && (
              <div className="px-2.5 py-1.5 text-2xs text-tertiary border-t border-subtle">Showing first 100 — keep typing to narrow.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
