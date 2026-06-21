'use client';

import { X, Pencil } from 'lucide-react';
import type { ObjectDef } from '@/lib/crm/types';
import { FieldValue } from './RecordTable';

interface Props {
  object: ObjectDef;
  row: any;
  canEdit?: boolean;
  onEdit: () => void;
  onClose: () => void;
}

export default function RecordDetail({ object, row, canEdit, onEdit, onClose }: Props) {
  const primary = object.fields.find((f) => f.primary) || object.fields[0];
  const rest = object.fields.filter((f) => f !== primary);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="w-full max-w-md max-h-[85vh] flex flex-col bg-white rounded-xl ring-1 ring-slate-200/70 shadow-2xl animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-slate-200/70">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{object.singular}</h2>
          <div className="flex items-center gap-1">
            {canEdit && (
              <button onClick={onEdit} className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-[12px] font-semibold text-slate-600 hover:bg-slate-100"><Pencil className="w-3.5 h-3.5" /> Edit</button>
            )}
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="text-lg font-black text-slate-900 mb-5">{row[primary.key] ?? '—'}</div>
          <dl className="divide-y divide-slate-100">
            {rest.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-[12px] font-semibold text-slate-500">{f.label}</dt>
                <dd className="text-[13px] text-right"><FieldValue field={f} row={row} /></dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
