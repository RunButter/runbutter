/**
 * The question spec: what "show me overdue invoices by client" MEANS, as data.
 *
 * ZERO IMPORTS, ON PURPOSE — the same rule `lib/workspace/blueprint.ts` carries
 * and for the same reason. This is assembled inside a route handler, and
 * importing anything from `lib/crm/*` drags in a `use client` module and the
 * browser Supabase client, which breaks the build at page-data collection with
 * a message that names neither the file nor the cause.
 *
 * ── THE MODEL NEVER WRITES A QUERY ──────────────────────────────────────────
 * It returns one of these, and nothing else. Every field is then re-validated
 * against the object's REAL columns before a single row is read: an unknown
 * object is refused, an unknown field is dropped, an unknown operator is
 * dropped, a non-numeric metric field falls back to counting.
 *
 * This is the same decision made three times already in this codebase, and it
 * is the correct one every time: `segment_match` is a whitelist CASE rather
 * than dynamic SQL, custom objects are JSONB rather than generated DDL, and
 * `/api/workspace/build` returns a plan a human applies. A SECURITY DEFINER
 * function assembling SQL from model output is one escaping mistake away from
 * arbitrary reads across every tenant. Here the model cannot reach SQL at all —
 * it picks from a vocabulary, and the executor does the rest through
 * `list_records`, which is already tenancy-safe.
 *
 * The worst a prompt injection achieves is a chart of the wrong column, which
 * is visible, and which is why the spec is shown and editable rather than
 * hidden behind the answer.
 */

export const FILTER_OPS = [
  'eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte',
  'is_empty', 'not_empty', 'before', 'after', 'in_last_days',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const METRIC_FNS = ['count', 'sum', 'avg', 'min', 'max'] as const;
export type MetricFn = (typeof METRIC_FNS)[number];

export const CHART_KINDS = ['bar', 'line', 'pie', 'number', 'table'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export const SORTS = ['value_desc', 'value_asc', 'label_asc'] as const;
export type SortKind = (typeof SORTS)[number];

/** Operators that only make sense on a number or a date. */
const NUMERIC_OPS: FilterOp[] = ['gt', 'gte', 'lt', 'lte'];
const DATE_OPS: FilterOp[] = ['before', 'after', 'in_last_days'];

export interface InsightFilter { field: string; op: FilterOp; value: string }

export interface InsightSpec {
  /** Object slug — a built-in or one this workspace defined. */
  object: string;
  /** ANDed. An OR would need a grouping syntax nobody would read in a URL. */
  filters: InsightFilter[];
  /** null = one bar for everything, which is how a plain total is expressed. */
  groupBy: string | null;
  metric: { fn: MetricFn; field: string | null };
  chart: ChartKind;
  sort: SortKind;
  limit: number;
  title: string;
}

/** The minimum a validator needs to know about an object: its real columns. */
export interface SchemaField { key: string; label: string; type: string }
export interface SchemaObject { slug: string; plural: string; fields: SchemaField[] }

export const NUMERIC_TYPES = ['number', 'currency'];
export const isNumeric = (t?: string) => !!t && NUMERIC_TYPES.includes(t);
export const isDate = (t?: string) => t === 'date';

const MAX_FILTERS = 8;
const MAX_LIMIT = 50;

const oneOf = <T extends string>(v: any, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback);

/**
 * Validate a model's reply into something safe to execute, or null if it does
 * not name a real object.
 *
 * FAILS CLOSED IN PIECES rather than all at once: a spec with one bad filter
 * loses that filter and still answers, because the alternative — refusing the
 * whole question over one hallucinated column name — is a worse product and
 * pushes people back to exporting CSVs. What it must never do is pass an
 * unchecked field name through to the executor.
 */
export function normalizeSpec(raw: any, schema: SchemaObject | undefined): InsightSpec | null {
  if (!schema || !raw || typeof raw !== 'object') return null;

  const byKey = new Map(schema.fields.map((f) => [f.key, f]));
  const typeOf = (k: string) => byKey.get(k)?.type;

  const filters: InsightFilter[] = Array.isArray(raw.filters) ? raw.filters
    .filter((f: any) => f && typeof f.field === 'string' && byKey.has(f.field))
    .map((f: any) => ({
      field: String(f.field),
      op: oneOf<FilterOp>(f.op, FILTER_OPS, 'eq'),
      value: f.value === null || f.value === undefined ? '' : String(f.value),
    }))
    // An operator the column cannot answer is dropped, not coerced. Comparing a
    // company name with `>` returns something, and that something is nonsense
    // presented as an answer.
    .filter((f: InsightFilter) => {
      const t = typeOf(f.field);
      if (NUMERIC_OPS.includes(f.op)) return isNumeric(t) || isDate(t);
      if (DATE_OPS.includes(f.op)) return isDate(t);
      return true;
    })
    .slice(0, MAX_FILTERS) : [];

  const groupBy = typeof raw.groupBy === 'string' && byKey.has(raw.groupBy) ? raw.groupBy : null;

  const fn = oneOf<MetricFn>(raw?.metric?.fn, METRIC_FNS, 'count');
  const rawField = typeof raw?.metric?.field === 'string' ? raw.metric.field : null;
  const metricField = rawField && byKey.has(rawField) ? rawField : null;
  // sum/avg/min/max need a number. Without one the honest answer is a count —
  // summing a text column silently produces 0 and looks like a real figure.
  const usableMetric: { fn: MetricFn; field: string | null } =
    fn === 'count' || (metricField && isNumeric(typeOf(metricField)))
      ? { fn, field: fn === 'count' ? null : metricField }
      : { fn: 'count', field: null };

  const limitRaw = Number(raw.limit);
  return {
    object: schema.slug,
    filters,
    groupBy,
    metric: usableMetric,
    chart: oneOf<ChartKind>(raw.chart, CHART_KINDS, groupBy ? 'bar' : 'number'),
    sort: oneOf<SortKind>(raw.sort, SORTS, 'value_desc'),
    limit: Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_LIMIT) : 12,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 120) : 'Untitled',
  };
}

/** A one-line plain-English rendering of a spec, so the query is readable. */
export function describeSpec(spec: InsightSpec, schema: SchemaObject): string {
  const label = (k: string) => schema.fields.find((f) => f.key === k)?.label || k;
  const metric = spec.metric.fn === 'count' ? 'Count' : `${spec.metric.fn} of ${label(spec.metric.field || '')}`;
  const where = spec.filters.length
    ? ` where ${spec.filters.map((f) => `${label(f.field)} ${f.op.replace(/_/g, ' ')} ${f.value}`.trim()).join(' and ')}`
    : '';
  const by = spec.groupBy ? ` by ${label(spec.groupBy)}` : '';
  return `${metric} of ${schema.plural}${where}${by}`;
}
