/**
 * Execute a validated spec against rows already loaded through `list_records`.
 *
 * WHY IN THE CLIENT RATHER THAN IN SQL. Every alternative means building a
 * query from a field name, and the whole point of `spec.ts` is that no model
 * output ever reaches a query builder. `list_records` is the tenancy-safe read
 * this product already trusts everywhere else; filtering and grouping its
 * result is arithmetic over an array nobody can escape from.
 *
 * The cost is that this aggregates what the object page has already fetched, so
 * it is bounded by whatever `list_records` returns rather than by the table. For
 * the question this feature answers — "how much, grouped by what, right now" —
 * that is the same data the table in front of you is showing, which is the
 * honest scope. A workspace large enough for that to matter needs a real
 * server-side aggregate, and that should be a dedicated RPC with a whitelisted
 * column set, not dynamic SQL.
 *
 * Pure. No imports beyond the spec's types, so it runs identically in a test,
 * a component and a route.
 */

import type { InsightSpec, InsightFilter } from './spec';

export interface Bucket { label: string; value: number; n: number }
export interface InsightResult {
  buckets: Bucket[];
  /** Rows that survived the filters — what the chart is actually made of. */
  rows: any[];
  /** The single figure, for a `number` chart or a headline above a bar chart. */
  total: number;
  truncated: boolean;
}

const EMPTY_LABEL = 'No value';

const asNumber = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** ISO prefix, never `new Date()` — see RecordCalendar for why that matters. */
const day = (v: any): string | null => {
  if (!v) return null;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

const daysAgoKey = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function matches(row: any, f: InsightFilter): boolean {
  const raw = row[f.field];
  const s = raw === null || raw === undefined ? '' : String(raw);

  switch (f.op) {
    case 'is_empty': return s.trim() === '';
    case 'not_empty': return s.trim() !== '';
    case 'eq': return s.toLowerCase() === f.value.toLowerCase();
    case 'neq': return s.toLowerCase() !== f.value.toLowerCase();
    case 'contains': return s.toLowerCase().includes(f.value.toLowerCase());
    case 'gt': case 'gte': case 'lt': case 'lte': {
      // Works for numbers and for dates: an ISO date compares correctly as a
      // string, so one branch covers both without parsing either.
      const a = asNumber(raw);
      const b = asNumber(f.value);
      const [x, y]: [any, any] = a !== null && b !== null ? [a, b] : [day(raw) ?? s, day(f.value) ?? f.value];
      if (x === '' || y === '') return false;
      return f.op === 'gt' ? x > y : f.op === 'gte' ? x >= y : f.op === 'lt' ? x < y : x <= y;
    }
    case 'before': { const d = day(raw); return !!d && !!f.value && d < (day(f.value) || f.value); }
    case 'after': { const d = day(raw); return !!d && !!f.value && d > (day(f.value) || f.value); }
    case 'in_last_days': {
      const d = day(raw);
      const n = asNumber(f.value);
      return !!d && n !== null && d >= daysAgoKey(n);
    }
    default: return true;
  }
}

function aggregate(rows: any[], spec: InsightSpec): number {
  if (spec.metric.fn === 'count' || !spec.metric.field) return rows.length;
  const nums = rows.map((r) => asNumber(r[spec.metric.field!])).filter((n): n is number => n !== null);
  if (nums.length === 0) return 0;
  switch (spec.metric.fn) {
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    default: return rows.length;
  }
}

export function runSpec(spec: InsightSpec, allRows: any[]): InsightResult {
  const rows = allRows.filter((r) => spec.filters.every((f) => matches(r, f)));
  const total = aggregate(rows, spec);

  if (!spec.groupBy) {
    return { buckets: [{ label: 'Total', value: total, n: rows.length }], rows, total, truncated: false };
  }

  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const v = r[spec.groupBy];
    // A date groups by DAY, not by timestamp — otherwise every row is its own
    // bucket and the chart is a barcode.
    const key = (isDateLike(v) ? day(v) : null)
      ?? (v === null || v === undefined || String(v).trim() === '' ? EMPTY_LABEL : String(v));
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }

  let buckets: Bucket[] = [...groups.entries()].map(([label, rs]) => ({
    label, value: aggregate(rs, spec), n: rs.length,
  }));

  buckets.sort(
    spec.sort === 'label_asc' ? (a, b) => a.label.localeCompare(b.label)
      : spec.sort === 'value_asc' ? (a, b) => a.value - b.value
        : (a, b) => b.value - a.value,
  );

  const truncated = buckets.length > spec.limit;
  if (truncated) buckets = buckets.slice(0, spec.limit);
  return { buckets, rows, total, truncated };
}

/** Looks like a date we should collapse to a day. */
const isDateLike = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
