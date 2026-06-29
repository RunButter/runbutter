'use client';

import { useState } from 'react';
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

export default function RecordTable({ object, rows, onRowClick }: { object: ObjectDef; rows: any[]; onRowClick?: (row: any) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = rows.length > 0 && selected.size === rows.length;

  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky top-0 z-10 bg-white w-9 px-3 h-9 border-b border-slate-200/70">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-slate-300 accent-primary-600" />
            </th>
            {object.fields.map((f) => (
              <th key={f.key} style={{ minWidth: f.width }}
                className={`sticky top-0 z-10 bg-white px-3 h-9 font-semibold text-slate-500 border-b border-slate-200/70 ${f.align === 'right' ? 'text-right' : 'text-left'}`}>
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => onRowClick?.(r)}
              className={`group transition-colors ${onRowClick ? 'cursor-pointer' : ''} ${selected.has(r.id) ? 'bg-primary-50/40' : 'hover:bg-slate-50/70'}`}>
              <td className="px-3 h-[42px] border-b border-slate-100" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="rounded border-slate-300 accent-primary-600 opacity-0 group-hover:opacity-100 checked:opacity-100 transition-opacity" />
              </td>
              {object.fields.map((f) => (
                <td key={f.key} className={`px-3 h-[42px] border-b border-slate-100 ${f.align === 'right' ? 'text-right' : ''}`}>
                  <FieldValue field={f} row={r} />
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={object.fields.length + 1} className="px-3 py-12 text-center text-slate-400">No {object.plural.toLowerCase()} yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
