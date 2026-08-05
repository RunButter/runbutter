'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2, Download, X, Loader2, Inbox, ChevronRight } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import type { ObjectDef, FieldDef } from '@/lib/crm/types';
import Badge, { toneFor, iconFor } from '@/components/ui/Badge';
import { useDialog } from '@/components/ui/Dialog';
import CompanyLogo from './CompanyLogo';

export function FieldValue({ field, row }: { field: FieldDef; row: any }) {
  const v = row[field.key];
  if (field.type === 'image') {
    return v
      ? <img src={String(v)} alt="" className="w-6 h-6 rounded object-cover border border-subtle" />
      : <div className="w-6 h-6 rounded bg-surface-hover border border-subtle" />;
  }
  if (v === null || v === undefined || v === '') return <span className="text-tertiary">—</span>;

  switch (field.type) {
    case 'avatar':
      // CompanyLogo falls back to initials on its own when there's no domain
      // to look up, so every object keeps the same avatar treatment.
      return (
        <div className="flex items-center gap-2 min-w-0">
          <CompanyLogo name={String(v)} domain={row.domain} size={20} />
          <span className="font-medium text-primary truncate">{v}</span>
        </div>
      );
    case 'tags':
      return <Badge tone={toneFor(String(v))} icon={iconFor(String(v))}>{String(v).replace(/_/g, ' ')}</Badge>;
    case 'relation':
      // A custom object stores the link as a uuid and SQL resolves the name
      // beside it (0089). Built-ins already send the name in this column, so
      // the fallback is the normal path for them, not a degraded one.
      return <span className="text-secondary truncate">{row[`${field.key}_label`] ?? v}</span>;
    case 'currency':
      return <span className="font-mono text-primary">${Number(v).toLocaleString()}</span>;
    case 'date':
      return <span className="text-secondary font-mono text-xs">{new Date(v).toLocaleDateString()}</span>;
    case 'number': {
      if (field.key === 'synergy') {
        const n = Number(v);
        const tone = n >= 80 ? 'text-success' : n >= 60 ? 'text-warning' : 'text-secondary';
        return <span className={`font-mono ${tone}`}>{n}%</span>;
      }
      return <span className="font-mono text-secondary">{Number(v).toLocaleString()}</span>;
    }
    default:
      return <span className="text-secondary truncate">{String(v)}</span>;
  }
}

export default function RecordTable({ object, rows, onRowClick, canDelete, onDeleteSelected, onExportSelected }: {
  object: ObjectDef; rows: any[]; onRowClick?: (row: any) => void;
  canDelete?: boolean;
  onDeleteSelected?: (ids: string[]) => Promise<void>;
  onExportSelected?: (rows: any[]) => void;
}) {
  const { confirm: confirmDialog } = useDialog();
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
    if (!await confirmDialog(`Delete ${selected.size} ${selected.size === 1 ? object.singular.toLowerCase() : object.plural.toLowerCase()}? This can’t be undone.`)) return;
    setBusy(true);
    await onDeleteSelected([...selected]);
    setBusy(false);
    clear();
  };

  return (
    <div className="h-full overflow-auto card-surface">
      <table className="w-full text-sm border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky top-0 z-10 bg-surface-sunken w-9 px-3 h-9 border-b border-subtle">
              <input ref={headRef} type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-strong accent-accent cursor-pointer" />
            </th>
            {object.fields.map((f) => (
              <th key={f.key} style={{ minWidth: f.width }}
                className={`sticky top-0 z-10 bg-surface-sunken px-3.5 h-11 text-2xs font-medium uppercase tracking-wide text-tertiary border-b border-subtle ${f.align === 'right' ? 'text-right' : 'text-left'}`}>
                {f.label}
              </th>
            ))}
            {/* Spacer for the row-open chevron below. */}
            {onRowClick && <th className="sticky top-0 z-10 bg-surface-sunken w-9 border-b border-subtle" aria-hidden />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const on = selected.has(r.id);
            return (
              <tr key={r.id} onClick={() => onRowClick?.(r)}
                className={`group transition-colors ${onRowClick ? 'cursor-pointer' : ''} ${on ? 'bg-accent/[0.06]' : 'hover:bg-surface-hover'}`}>
                <td className="px-3.5 h-12 border-b border-subtle" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={on} onChange={() => toggle(r.id)}
                    className={`rounded border-strong accent-accent cursor-pointer transition-opacity ${on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                </td>
                {object.fields.map((f) => (
                  <td key={f.key} className={`px-3.5 h-12 border-b border-subtle ${f.align === 'right' ? 'text-right' : ''}`}>
                    <FieldValue field={f} row={r} />
                  </td>
                ))}
                {/* Rows have been clickable all along with nothing to say so —
                    cursor:pointer is invisible until you are already hovering the
                    right place. A chevron that fades in on hover or keyboard
                    focus makes "this opens" discoverable without adding a column
                    of permanent visual noise. */}
                {onRowClick && (
                  <td className="px-2 h-12 border-b border-subtle text-right">
                    <ChevronRight className="w-4 h-4 text-tertiary opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity inline-block" />
                  </td>
                )}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={object.fields.length + (onRowClick ? 2 : 1)}>
                <EmptyState
                  icon={Inbox}
                  title={`No ${object.plural.toLowerCase()} yet`}
                  description={`Add your first ${object.singular.toLowerCase()} with the New button above — or import an existing list.`}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Floating bulk-action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 bg-surface border border-strong rounded-lg shadow-popover pl-3 pr-1.5 py-1.5 text-sm animate-in fade-in slide-in-from-bottom-2 duration-150">
          <span className="font-medium text-primary tabular-nums">{selected.size} selected</span>
          <button onClick={clear} className="text-tertiary hover:text-primary text-xs ml-1 mr-1">clear</button>
          <span className="w-px h-5 bg-subtle" />
          {onExportSelected && (
            <button onClick={() => onExportSelected(selectedRows)}
              className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md font-medium text-secondary hover:bg-surface-hover hover:text-primary transition-colors"><Download className="w-3.5 h-3.5" /> Export</button>
          )}
          {onDeleteSelected && canDelete && (
            <button onClick={doDelete} disabled={busy}
              className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md font-medium text-danger hover:bg-danger/10 transition-colors disabled:opacity-50">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Delete
            </button>
          )}
          <button onClick={clear} aria-label="Close" className="h-7 w-7 inline-flex items-center justify-center rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  );
}
