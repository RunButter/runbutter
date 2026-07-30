'use client';

import { useMemo } from 'react';
import { X } from 'lucide-react';
import type { ObjectDef } from '@/lib/crm/types';

// Generic faceted filter row for any object list. Builds a dropdown for each
// tags/relation column (status, direction, category, company, …) from the values
// actually present, plus a date range over the first date column. Pure client.
export interface FilterState { facets: Record<string, string>; from: string; to: string }
export const EMPTY_FILTERS: FilterState = { facets: {}, from: '', to: '' };
export const hasActiveFilters = (f: FilterState) => Object.values(f.facets).some(Boolean) || !!f.from || !!f.to;

export default function FilterBar({ object, rows, value, onChange }: {
  object: ObjectDef; rows: any[]; value: FilterState; onChange: (v: FilterState) => void;
}) {
  const facetFields = useMemo(() => object.fields.filter((f) => f.type === 'tags' || f.type === 'relation'), [object]);
  const dateField = useMemo(() => object.fields.find((f) => f.type === 'date'), [object]);

  const distinct = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of facetFields) {
      out[f.key] = Array.from(new Set(rows.map((r) => r[f.key]).filter((v) => v !== null && v !== undefined && v !== '')))
        .map(String).sort();
    }
    return out;
  }, [facetFields, rows]);

  const usableFacets = facetFields.filter((f) => (distinct[f.key]?.length || 0) > 1);
  if (usableFacets.length === 0 && !dateField) return null;

  const setFacet = (k: string, v: string) => onChange({ ...value, facets: { ...value.facets, [k]: v } });

  return (
    <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-subtle bg-surface-sunken/40">
      {usableFacets.map((f) => (
        <select key={f.key} value={value.facets[f.key] || ''} onChange={(e) => setFacet(f.key, e.target.value)}
          className={`h-7 px-2 text-xs rounded-md bg-surface ring-1 outline-none focus:ring-2 focus:ring-accent/30 capitalize ${value.facets[f.key] ? 'ring-accent/30 text-accent font-semibold' : 'ring-subtle text-secondary'}`}>
          <option value="">{f.label}: all</option>
          {distinct[f.key].map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
        </select>
      ))}
      {dateField && (
        <div className="flex items-center gap-1 text-xs text-secondary ml-0.5">
          <span>{dateField.label}</span>
          <input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })}
            className="h-7 px-1.5 text-xs rounded-md bg-surface ring-1 ring-subtle outline-none focus:ring-2 focus:ring-accent/30" />
          <span className="text-tertiary">→</span>
          <input type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })}
            className="h-7 px-1.5 text-xs rounded-md bg-surface ring-1 ring-subtle outline-none focus:ring-2 focus:ring-accent/30" />
        </div>
      )}
      {hasActiveFilters(value) && (
        <button onClick={() => onChange(EMPTY_FILTERS)}
          className="h-7 px-2 inline-flex items-center gap-1 text-xs font-medium text-secondary hover:text-danger">
          <X className="w-3.5 h-3.5" /> Clear
        </button>
      )}
    </div>
  );
}
