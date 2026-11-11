'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Sparkles, Loader2, Plus, X, Link2, Check } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import DataBadge from '@/components/ui/DataBadge';
import AppLoading from '@/components/ui/AppLoading';
import InsightChart from '@/components/crm/InsightChart';
import { OBJECTS } from '@/lib/crm/registry';
import { getWorkspace, loadRecords } from '@/lib/crm/data';
import { loadCustomObjects, customObjectMap } from '@/lib/crm/custom';
import {
  normalizeSpec, describeSpec, isNumeric, isDate, METRIC_FNS, CHART_KINDS, SORTS, FILTER_OPS,
  type InsightSpec, type SchemaObject, type FilterOp,
} from '@/lib/insights/spec';
import { runSpec } from '@/lib/insights/run';
import { publishInsight } from '@/lib/insights/publish';

/**
 * Ask a question, get a chart.
 *
 * The query is ALWAYS on screen and every part of it is a dropdown, so this
 * works with no AI key at all — the model is a shortcut to filling the
 * dropdowns, never the only way in. It sees column NAMES and returns a spec;
 * the rows are read here through `list_records` and counted in the browser
 * (`lib/insights/run.ts`), so it can only ever chart what this person can
 * already open.
 */

const OP_LABEL: Record<FilterOp, string> = {
  eq: 'is', neq: 'is not', contains: 'contains', gt: '>', gte: '≥', lt: '<', lte: '≤',
  is_empty: 'is empty', not_empty: 'is set', before: 'before', after: 'after', in_last_days: 'in last N days',
};
const FN_LABEL: Record<string, string> = { count: 'Count', sum: 'Sum of', avg: 'Average of', min: 'Lowest', max: 'Highest' };
const CHART_LABEL: Record<string, string> = { bar: 'Bars', line: 'Line', pie: 'Pie', number: 'Single number', table: 'Table' };
const SORT_LABEL: Record<string, string> = { value_desc: 'Biggest first', value_asc: 'Smallest first', label_asc: 'A → Z' };

const SKIP_TYPES = new Set(['image', 'avatar_url']);
const blank = (object: string, title = 'New chart'): InsightSpec =>
  ({ object, filters: [], groupBy: null, metric: { fn: 'count', field: null }, chart: 'number', sort: 'value_desc', limit: 12, title });

export default function InsightsPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<string | null>(null);
  const [custom, setCustom] = useState<Record<string, any>>({});
  const [spec, setSpec] = useState<InsightSpec>(blank('invoices'));
  const [rows, setRows] = useState<any[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!privy) return;
    getWorkspace(privy).then(async (w) => {
      if (!w?.id) return;
      setWs(w.id);
      const r = await loadCustomObjects(privy, w.id);
      setCustom(customObjectMap(r.rows));
    });
  }, [privy]);

  // Every object this workspace has, as the validator sees it: names and types.
  const schemas: SchemaObject[] = useMemo(() => {
    const defs = { ...OBJECTS, ...custom } as Record<string, any>;
    return Object.values(defs).map((d: any) => ({
      slug: d.slug, plural: d.plural,
      fields: (d.fields || []).filter((f: any) => !SKIP_TYPES.has(f.type)).map((f: any) => ({ key: f.key, label: f.label, type: f.type })),
    })).filter((o) => o.fields.length);
  }, [custom]);
  const schema = schemas.find((s) => s.slug === spec.object);
  const fieldsOf = (pred: (t: string) => boolean) => (schema?.fields || []).filter((f) => pred(f.type));

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    loadRecords(privy, spec.object).then((r) => {
      if (cancelled) return;
      setRows(r.rows); setLive(r.live); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [ready, privy, spec.object]);

  const result = useMemo(() => runSpec(spec, rows), [spec, rows]);
  const currency = !!spec.metric.field && schema?.fields.find((f) => f.key === spec.metric.field)?.type === 'currency';

  // Every edit goes back through the validator, so the screen can never hold a
  // spec the executor would refuse.
  const edit = (patch: Partial<InsightSpec>) => {
    setLink('');
    setSpec((s) => normalizeSpec({ ...s, ...patch }, schemas.find((o) => o.slug === (patch.object ?? s.object))) ?? s);
  };

  const ask = async () => {
    if (!question.trim()) return;
    if (!privy || !ws) { setError('Sign in to ask in plain words — or build the chart with the dropdowns below.'); return; }
    setAsking(true); setError('');
    try {
      const res = await fetch('/api/insights/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privyUserId: privy, workspaceId: ws, question, objects: schemas }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'That did not work.'); return; }
      const s = schemas.find((o) => o.slug === data.spec?.object);
      const next = normalizeSpec(data.spec, s);
      if (next) { setLink(''); setSpec(next); }
    } finally { setAsking(false); }
  };

  const share = async () => {
    if (!privy || !ws || !schema) return;
    setSharing(true); setError('');
    const r = await publishInsight(privy, ws, {
      title: spec.title, result, chart: spec.chart, currency, query: describeSpec(spec, schema), days: 30,
    });
    setSharing(false);
    if (r.error) { setError(r.error); return; }
    const url = `${window.location.origin}/i/${r.token}`;
    setLink(url);
    try { await navigator.clipboard?.writeText(url); } catch {}
  };

  const sel = 'h-8 px-2 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm outline-none focus:ring-2 focus:ring-accent/30';

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Insights" subtitle="Ask a question about your data, get a chart." badge={<DataBadge live={live} />} />

      <div className="flex-1 overflow-auto page-pad space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="card-surface p-2 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-tertiary ml-2 shrink-0" />
          <input value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Question"
            placeholder="e.g. unpaid invoices by client, deals won this quarter, candidates per position"
            className="flex-1 min-w-0 h-9 bg-transparent text-sm outline-none placeholder:text-tertiary" />
          <button type="submit" disabled={asking || !question.trim()}
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
            {asking && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Ask
          </button>
        </form>
        {error && <p className="text-sm text-danger">{error}</p>}

        {/* The query, always visible and always editable. */}
        <div className="card-surface p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Measure" className={sel} value={spec.metric.fn}
              onChange={(e) => edit({ metric: { fn: e.target.value as any, field: spec.metric.field || fieldsOf(isNumeric)[0]?.key || null } })}>
              {METRIC_FNS.map((f) => <option key={f} value={f} disabled={f !== 'count' && !fieldsOf(isNumeric).length}>{FN_LABEL[f]}</option>)}
            </select>
            {spec.metric.fn !== 'count' && (
              <select aria-label="Field to measure" className={sel} value={spec.metric.field || ''}
                onChange={(e) => edit({ metric: { fn: spec.metric.fn, field: e.target.value } })}>
                {fieldsOf(isNumeric).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            )}
            <select aria-label="Record type" className={sel} value={spec.object}
              onChange={(e) => edit({ ...blank(e.target.value, spec.title) })}>
              {schemas.map((o) => <option key={o.slug} value={o.slug}>{o.plural}</option>)}
            </select>
            <span className="text-sm text-tertiary">by</span>
            <select aria-label="Group by" className={sel} value={spec.groupBy || ''}
              onChange={(e) => edit({ groupBy: e.target.value || null, chart: e.target.value ? (spec.chart === 'number' ? 'bar' : spec.chart) : 'number' })}>
              <option value="">Nothing — one total</option>
              {(schema?.fields || []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <span className="ml-auto" />
            <select aria-label="Chart" className={sel} value={spec.chart} onChange={(e) => edit({ chart: e.target.value as any })}>
              {CHART_KINDS.map((k) => <option key={k} value={k}>{CHART_LABEL[k]}</option>)}
            </select>
            {spec.groupBy && (
              <select aria-label="Sort" className={sel} value={spec.sort} onChange={(e) => edit({ sort: e.target.value as any })}>
                {SORTS.map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
              </select>
            )}
          </div>

          {spec.filters.map((f, i) => {
            const t = schema?.fields.find((x) => x.key === f.field)?.type;
            const ops = FILTER_OPS.filter((op) =>
              ['gt', 'gte', 'lt', 'lte'].includes(op) ? isNumeric(t) || isDate(t)
                : ['before', 'after', 'in_last_days'].includes(op) ? isDate(t) : true);
            const set = (patch: any) => edit({ filters: spec.filters.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-tertiary w-10">{i === 0 ? 'where' : 'and'}</span>
                <select aria-label="Filter field" className={sel} value={f.field} onChange={(e) => set({ field: e.target.value, op: 'eq', value: '' })}>
                  {(schema?.fields || []).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
                <select aria-label="Filter operator" className={sel} value={f.op} onChange={(e) => set({ op: e.target.value })}>
                  {ops.map((op) => <option key={op} value={op}>{OP_LABEL[op]}</option>)}
                </select>
                {!['is_empty', 'not_empty'].includes(f.op) && (
                  <input aria-label="Filter value" className={`${sel} w-40`} value={f.value}
                    type={isDate(t) && f.op !== 'in_last_days' ? 'date' : 'text'}
                    onChange={(e) => set({ value: e.target.value })} />
                )}
                <button onClick={() => edit({ filters: spec.filters.filter((_, j) => j !== i) })} aria-label="Remove filter"
                  className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10"><X className="w-3.5 h-3.5" /></button>
              </div>
            );
          })}
          <button onClick={() => schema && edit({ filters: [...spec.filters, { field: schema.fields[0].key, op: 'not_empty', value: '' }] })}
            className="h-7 px-2 inline-flex items-center gap-1 text-xs font-medium text-secondary rounded-md hover:bg-surface-hover">
            <Plus className="w-3.5 h-3.5" /> Filter
          </button>
          {schema && <p className="text-xs text-tertiary">{describeSpec(spec, schema)}</p>}
        </div>

        <div className="card-surface p-5">
          <div className="flex items-center gap-3 mb-3">
            <input aria-label="Chart title" value={spec.title} onChange={(e) => { setLink(''); setSpec((s) => ({ ...s, title: e.target.value.slice(0, 120) })); }}
              className="flex-1 min-w-0 bg-transparent text-base font-medium text-primary outline-none" />
            {live && (link
              ? <button onClick={() => navigator.clipboard?.writeText(link)} className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md ring-1 ring-subtle text-success" title={link}>
                  <Check className="w-3.5 h-3.5" /> Link copied — 30 days
                </button>
              : <button onClick={share} disabled={sharing} className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-hover disabled:opacity-40"
                  title="Publishes this chart's numbers — not the records behind it — at a private link.">
                  {sharing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />} Share
                </button>)}
          </div>
          {loading ? <AppLoading /> : <InsightChart buckets={result.buckets} kind={spec.chart} currency={currency} total={result.total} />}
          {result.truncated && <p className="mt-2 text-xs text-tertiary">Showing the top {spec.limit}.</p>}
        </div>
      </div>
    </div>
  );
}
