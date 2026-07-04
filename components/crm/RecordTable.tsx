'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2, Download, X, Loader2 } from 'lucide-react';
import type { ObjectDef, FieldDef } from '@/lib/crm/types';

function initials(s: string) {
  return (s || '?').split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

const TAG_STYLE: Record<string, string> = {
  // status
  assigned: 'bg-blue-50 text-blue-700 ring-blue-200/60',
  available: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60',
  repair: 'bg-amber-50 text-amber-700 ring-amber-200/60',
  retired: 'bg-slate-100 text-slate-500 ring-slate-200/60',
  // categories / sources
  laptop: 'bg-violet-50 text-violet-700 ring-violet-200/60',
  monitor: 'bg-cyan-50 text-cyan-700 ring-cyan-200/60',
  phone: 'bg-pink-50 text-pink-700 ring-pink-200/60',
  license: 'bg-indigo-50 text-indigo-700 ring-indigo-200/60',
  // invoice direction
  income: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60',
  cost: 'bg-rose-50 text-rose-700 ring-rose-200/60',
  // document kind
  invoice: 'bg-slate-100 text-slate-600 ring-slate-200/60',
  offer: 'bg-violet-50 text-violet-700 ring-violet-200/60',
  // finance statuses
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60',
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60',
  sent: 'bg-blue-50 text-blue-700 ring-blue-200/60',
  accepted: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60',
  declined: 'bg-rose-50 text-rose-700 ring-rose-200/60',
  draft: 'bg-slate-100 text-slate-500 ring-slate-200/60',
  pending: 'bg-amber-50 text-amber-700 ring-amber-200/60',
  overdue: 'bg-rose-50 text-rose-700 ring-rose-200/60',
  // expense categories
  software: 'bg-indigo-50 text-indigo-700 ring-indigo-200/60',
  office: 'bg-cyan-50 text-cyan-700 ring-cyan-200/60',
  payroll: 'bg-violet-50 text-violet-700 ring-violet-200/60',
  travel: 'bg-amber-50 text-amber-700 ring-amber-200/60',
  // marketing channels + states
  email: 'bg-sky-50 text-sky-700 ring-sky-200/60',
  social: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200/60',
  ads: 'bg-amber-50 text-amber-700 ring-amber-200/60',
  event: 'bg-violet-50 text-violet-700 ring-violet-200/60',
  content: 'bg-teal-50 text-teal-700 ring-teal-200/60',
  planned: 'bg-slate-100 text-slate-500 ring-slate-200/60',
  // project / issue states + priority
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60',
  paused: 'bg-amber-50 text-amber-700 ring-amber-200/60',
  completed: 'bg-slate-100 text-slate-500 ring-slate-200/60',
  backlog: 'bg-slate-100 text-slate-500 ring-slate-200/60',
  todo: 'bg-blue-50 text-blue-700 ring-blue-200/60',
  in_progress: 'bg-violet-50 text-violet-700 ring-violet-200/60',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60',
  cancelled: 'bg-rose-50 text-rose-700 ring-rose-200/60',
  urgent: 'bg-rose-50 text-rose-700 ring-rose-200/60',
  high: 'bg-amber-50 text-amber-700 ring-amber-200/60',
  medium: 'bg-blue-50 text-blue-700 ring-blue-200/60',
  low: 'bg-slate-50 text-slate-500 ring-slate-200/60',
};

function Tag({ value }: { value: string }) {
  const style = TAG_STYLE[value?.toLowerCase()] || 'bg-slate-50 text-slate-600 ring-slate-200/60';
  const label = String(value).replace(/_/g, ' ');
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ring-1 capitalize ${style}`}>{label}</span>;
}

export function FieldValue({ field, row }: { field: FieldDef; row: any }) {
  const v = row[field.key];
  if (field.type === 'image') {
    return v
      ? <img src={String(v)} alt="" className="w-8 h-8 rounded-md object-cover ring-1 ring-slate-200/60" />
      : <div className="w-8 h-8 rounded-md bg-slate-100 ring-1 ring-slate-200/60" />;
  }
  if (v === null || v === undefined || v === '') return <span className="text-slate-300">—</span>;

  switch (field.type) {
    case 'avatar':
      return (
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 text-slate-600 text-[10px] font-bold flex items-center justify-center shrink-0">{initials(String(v))}</div>
          <span className="font-semibold text-slate-800 truncate hover:text-primary-700 cursor-pointer">{v}</span>
        </div>
      );
    case 'tags':
      return <Tag value={String(v)} />;
    case 'relation':
      return <span className="text-slate-600 truncate">{v}</span>;
    case 'currency':
      return <span className="tabular-nums font-semibold text-slate-800">${Number(v).toLocaleString()}</span>;
    case 'date':
      return <span className="text-slate-500 tabular-nums">{new Date(v).toLocaleDateString()}</span>;
    case 'number': {
      if (field.key === 'synergy') {
        const n = Number(v);
        const tone = n >= 80 ? 'text-emerald-600' : n >= 60 ? 'text-amber-600' : 'text-slate-500';
        return <span className={`font-bold tabular-nums ${tone}`}>{n}%</span>;
      }
      return <span className="tabular-nums text-slate-700">{Number(v).toLocaleString()}</span>;
    }
    default:
      return <span className="text-slate-600 truncate">{String(v)}</span>;
  }
}

export default function RecordTable({ object, rows, onRowClick, canDelete, onDeleteSelected, onExportSelected }: {
  object: ObjectDef; rows: any[]; onRowClick?: (row: any) => void;
  canDelete?: boolean;
  onDeleteSelected?: (ids: string[]) => Promise<void>;
  onExportSelected?: (rows: any[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const headRef = useRef<HTMLInputElement>(null);

  // Prune selection to ids still present (after filtering/reload).
  useEffect(() => {
    setSelected((s) => {
      if (s.size === 0) return s;
      const valid = new Set(rows.map((r) => r.id));
      const next = new Set([...s].filter((id) => valid.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [rows]);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  useEffect(() => { if (headRef.current) headRef.current.indeterminate = selected.size > 0 && !allSelected; }, [selected, allSelected]);

  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const clear = () => setSelected(new Set());

  const selectedRows = rows.filter((r) => selected.has(r.id));

  const doDelete = async () => {
    if (!onDeleteSelected) return;
    if (!confirm(`Delete ${selected.size} ${selected.size === 1 ? object.singular.toLowerCase() : object.plural.toLowerCase()}? This can’t be undone.`)) return;
    setBusy(true);
    await onDeleteSelected([...selected]);
    setBusy(false);
    clear();
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky top-0 z-10 bg-white w-9 px-3 h-9 border-b border-slate-200/70">
              <input ref={headRef} type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-slate-300 accent-primary-600 cursor-pointer" />
            </th>
            {object.fields.map((f) => (
              <th key={f.key} style={{ minWidth: f.width }}
                className={`sticky top-0 z-10 bg-white px-3 h-9 text-[11px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-200/70 ${f.align === 'right' ? 'text-right' : 'text-left'}`}>
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const on = selected.has(r.id);
            return (
              <tr key={r.id} onClick={() => onRowClick?.(r)}
                className={`group transition-colors ${onRowClick ? 'cursor-pointer' : ''} ${on ? 'bg-primary-50/40' : 'hover:bg-slate-50/70'}`}>
                <td className="px-3 h-[42px] border-b border-slate-100" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={on} onChange={() => toggle(r.id)}
                    className={`rounded border-slate-300 accent-primary-600 cursor-pointer transition-opacity ${on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                </td>
                {object.fields.map((f) => (
                  <td key={f.key} className={`px-3 h-[42px] border-b border-slate-100 ${f.align === 'right' ? 'text-right' : ''}`}>
                    <FieldValue field={f} row={r} />
                  </td>
                ))}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={object.fields.length + 1} className="px-3 py-12 text-center text-slate-400">No {object.plural.toLowerCase()} yet.</td></tr>
          )}
        </tbody>
      </table>

      {/* Floating bulk-action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 bg-slate-900 text-white rounded-xl shadow-2xl shadow-slate-900/30 pl-3 pr-1.5 py-1.5 text-[13px] animate-in fade-in slide-in-from-bottom-2 duration-150">
          <span className="font-semibold tabular-nums">{selected.size} selected</span>
          <button onClick={clear} className="text-white/50 hover:text-white text-[12px] font-medium ml-1 mr-1">clear</button>
          <span className="w-px h-5 bg-white/15" />
          {onExportSelected && (
            <button onClick={() => onExportSelected(selectedRows)}
              className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md font-semibold hover:bg-white/10 transition-colors"><Download className="w-3.5 h-3.5" /> Export</button>
          )}
          {onDeleteSelected && canDelete && (
            <button onClick={doDelete} disabled={busy}
              className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors disabled:opacity-50">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Delete
            </button>
          )}
          <button onClick={clear} aria-label="Close" className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-white/10"><X className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  );
}
